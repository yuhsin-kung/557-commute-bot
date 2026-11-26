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

test('回報現場：兩步，選站 → 等到第幾班才上車', () => {
  const env = start();
  assert.deepEqual(buttonsOf(say(env, 'A', '回報現場')).map(b => b[1]), ['回報現場 士林站', '回報現場 士林國中', '回報現場 校內站']);
  assert.match(JSON.stringify(say(env, 'A', '回報現場')), /不會記錄你的位置/);
  assert.deepEqual(buttonsOf(say(env, 'A', '回報現場 士林站')),
    [['第一班就上了', '回報現場 士林站 1'], ['等到第 2 班才上', '回報現場 士林站 2'], ['等到第 3 班以上才上', '回報現場 士林站 3+'], ['放棄了，改搭別的', '回報現場 士林站 放棄']]);
  assert.equal(rows(env).length, 0, '還沒選完不記');
});

test('選完就記一筆，只記站牌和第幾班，不記定位', () => {
  const env = start();
  const done = say(env, 'A', '回報現場 士林站 2');
  assert.match(JSON.stringify(done), /謝謝回報/);
  assert.match(JSON.stringify(done), /09:40｜捷運士林站｜等到第 2 班才上/);
  assert.deepEqual(buttonsOf(done).map(b => b[1]), ['557 即時動態', '比較所有路線'], '沒擠上第一班給下一步');
  const r = rows(env);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0][1], r[0][2], r[0][3]], ['A', '捷運士林站', '等到第 2 班才上']);
  assert.equal(JSON.stringify(r).includes('25.0'), false);
  assert.deepEqual(buttonsOf(say(env, 'B', '回報現場 士林國中 1')), [], '第一班就上了不用給按鈕');
});

test('同一個人 3 分鐘內再回報蓋掉前一筆，超過 3 分鐘才算新的一筆', () => {
  const env = start();
  say(env, 'A', '回報現場 士林站 1');
  env.addMinutes(2);
  say(env, 'A', '回報現場 士林站 3+');
  assert.equal(rows(env).length, 1);
  assert.equal(rows(env)[0][3], '等到第 3 班以上才上');
  say(env, 'B', '回報現場 士林國中 1');
  env.addMinutes(4);
  say(env, 'A', '回報現場 校內站 放棄');
  assert.equal(rows(env).length, 3);
});

test('亂打的選項不會記，回到那一步重選', () => {
  const env = start();
  assert.match(JSON.stringify(say(env, 'A', '回報現場 火星')), /你在哪一站搭 557/);
  assert.match(JSON.stringify(say(env, 'A', '回報現場 士林站 999')), /等到第幾班才擠上車/);
  assert.equal(rows(env).length, 0);
});

test('「出門前提醒」選單有回報現場按鈕', () => {
  const env = start();
  assert.ok(buttonsOf(env.call('menuCategory_', '出門前提醒')).some(b => b[1] === '回報現場'));
});
