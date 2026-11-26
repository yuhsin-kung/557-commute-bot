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

test('回報現場：一步一步點，選站 → 排隊人數 → 有沒有擠上', () => {
  const env = start();
  assert.deepEqual(buttonsOf(say(env, 'A', '回報現場')).map(b => b[1]), ['回報現場 士林站', '回報現場 士林國中', '回報現場 校內站']);
  assert.match(JSON.stringify(say(env, 'A', '回報現場')), /不會記錄你的位置/);
  assert.deepEqual(buttonsOf(say(env, 'A', '回報現場 士林站')).map(b => b[1]),
    ['回報現場 士林站 0-10', '回報現場 士林站 10-30', '回報現場 士林站 30-60', '回報現場 士林站 60+']);
  assert.deepEqual(buttonsOf(say(env, 'A', '回報現場 士林站 30-60')).map(b => b[0]), ['擠上了', '沒擠上，等下一班', '還沒有車來']);
  assert.equal(rows(env).length, 0, '還沒選完不記');
});

test('選完三步就記一筆，只記站牌、人數、結果，不記定位', () => {
  const env = start();
  const done = say(env, 'A', '回報現場 士林站 30-60 沒擠上');
  assert.match(JSON.stringify(done), /謝謝回報/);
  assert.match(JSON.stringify(done), /09:40｜捷運士林站｜排隊 30–60 人｜沒擠上，等下一班/);
  assert.deepEqual(buttonsOf(done).map(b => b[1]), ['557 即時動態', '比較所有路線'], '沒擠上給下一步');
  const r = rows(env);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0][1], r[0][2], r[0][3], r[0][4]], ['A', '捷運士林站', '30–60 人', '沒擠上，等下一班']);
  assert.equal(JSON.stringify(r).includes('25.0'), false);
});

test('同一個人 3 分鐘內再回報蓋掉前一筆，超過 3 分鐘才算新的一筆', () => {
  const env = start();
  say(env, 'A', '回報現場 士林站 10-30 還沒來');
  env.addMinutes(2);
  say(env, 'A', '回報現場 士林站 10-30 擠上了');
  assert.equal(rows(env).length, 1);
  assert.equal(rows(env)[0][4], '擠上了');
  say(env, 'B', '回報現場 士林國中 0-10 擠上了');
  env.addMinutes(4);
  say(env, 'A', '回報現場 校內站 60+ 沒擠上');
  assert.equal(rows(env).length, 3);
});

test('亂打的選項不會記，回到那一步重選', () => {
  const env = start();
  assert.match(JSON.stringify(say(env, 'A', '回報現場 火星')), /你現在在哪一站等 557/);
  assert.match(JSON.stringify(say(env, 'A', '回報現場 士林站 999')), /現在排隊大概幾個人/);
  assert.match(JSON.stringify(say(env, 'A', '回報現場 士林站 0-10 飛走了')), /有沒有擠上/);
  assert.equal(rows(env).length, 0);
});

test('「出門前提醒」選單有回報現場按鈕', () => {
  const env = start();
  assert.ok(buttonsOf(env.call('menuCategory_', '出門前提醒')).some(b => b[1] === '回報現場'));
});
