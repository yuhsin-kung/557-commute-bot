// 557 現場回報（bot/現場回報.gs）的測試。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');
const { buttonsOf } = require('./helpers');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));

function start(now = '2026-10-12T09:40:00+08:00') {
  const env = loadBot(ALL);
  env.setNow(now);
  return env;
}
const say = (env, uid, text) => env.call('memberReply_', uid, text);
const rows = env => (env.sheets['現場回報'] ? env.sheets['現場回報'].rows.slice(1) : []);

test('回報現場：先選在哪一站排隊，四個站', () => {
  const env = start();
  const pick = say(env, 'A', '回報現場');
  assert.deepEqual(buttonsOf(pick), [['捷運士林站', '回報現場 士林站'], ['士林國中', '回報現場 士林國中'], ['校內 557 站', '回報現場 校內站'], ['錢穆故居站', '回報現場 錢穆故居站']]);
  assert.match(pick.altText, /^557 搭車資訊與排隊回報\n回報排隊狀況\n你目前在哪一站等車？/);
  assert.match(pick.altText, /ⓘ 回報方式\n點選下方站點即可完成回報，不需要 GPS 定位。/);
  assert.ok(pick.contents.footer.contents.slice(0, 4).every(c => c.backgroundColor === '#EEF2F7'), '四個站都是灰色按鈕，不設主要按鈕');
  assert.equal(rows(env).length, 0, '還沒選站不記');
});

test('按一下站就記一筆，只記時間、誰、哪一站', () => {
  const env = start();
  const done = say(env, 'A', '回報現場 士林站');
  assert.match(done.altText, /回報排隊成功\n✅ 感謝你的回報！\n捷運士林站\n回報時間｜09:40\n1 人\n最近 10 分鐘內有 1 位同學回報在此排隊（僅統計有主動回報的人數）。/);
  assert.deepEqual(buttonsOf(done), [['557 即時動態', '557 即時動態'], ['比較所有路線', '比較所有路線']]);
  const r = rows(env);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0][1], r[0][2]], ['A', '捷運士林站']);
  assert.equal(r[0].length, 3, '不記其他東西');
});

test('告訴學生最近 10 分鐘這一站有幾人回報；超過 10 分鐘、別站的不算', () => {
  const env = start();
  say(env, 'A', '回報現場 士林站');
  env.addMinutes(11);
  say(env, 'B', '回報現場 士林站');
  say(env, 'C', '回報現場 士林國中');
  env.addMinutes(1);
  assert.match(JSON.stringify(say(env, 'D', '回報現場 士林站')), /最近 10 分鐘內有 2 位同學/);
});

test('同一個人 15 分鐘內再按算同一次排隊，只留最後一筆（按錯站可以重按）', () => {
  const env = start();
  say(env, 'A', '回報現場 士林國中');
  env.addMinutes(1);
  say(env, 'A', '回報現場 士林站');
  assert.equal(rows(env).length, 1);
  assert.equal(rows(env)[0][2], '捷運士林站');
  env.addMinutes(16);
  say(env, 'A', '回報現場 士林站');
  assert.equal(rows(env).length, 2, '超過 15 分鐘算新的一次');
});

test('亂打的站名不會記', () => {
  const env = start();
  assert.match(JSON.stringify(say(env, 'A', '回報現場 火星')), /你目前在哪一站等車/);
  assert.equal(rows(env).length, 0);
});

test('「557 搭車資訊與排隊回報」選單有回報排隊按鈕', () => {
  const env = start();
  assert.ok(buttonsOf(env.call('menuCategory_', '557 搭車資訊與排隊回報')).some(b => b[1] === '回報排隊狀況'));
});
