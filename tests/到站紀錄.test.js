// 557 到站紀錄：每分鐘把公車動態網站的資料存進試算表，給到校時間預測用。執行：npm test
// 測試資料 fixtures/557動態.json 是 2026/11/24 16:17 從 pda5284.gov.taipei 抓的真實回應
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));
const SAMPLE = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', '557動態.json'), 'utf8'));

function setup(iso = '2026-11-24T16:17:30+08:00') {
  const env = loadBot(ALL);
  env.setNow(iso);
  env.respond['RouteDyna'] = SAMPLE;
  return env;
}
const rowsOf = (env, name) => env.sheets[name].rows.slice(1);

test('記錄 557 動態：每台車的位置、方向、擁擠程度、車上人數都記下來', () => {
  const env = setup();
  env.call('記錄557動態');
  assert.ok(env.fetches.some(f => f.url.includes('pda5284.gov.taipei/MQS/RouteDyna?routeid=17333')));
  const rows = rowsOf(env, '557動態紀錄');
  // 範例裡有 7 台車
  assert.equal(rows.length, 7);
  const byBus = Object.fromEntries(rows.map(r => [r[1], r]));
  assert.deepEqual(byBus['EAA-057'].slice(2, 6).concat(byBus['EAA-057'].slice(7)), ['往東吳', '171188', '士林國中', '到站', '擁擠', 56]);
  assert.deepEqual(byBus['EAA-068'].slice(2, 6), ['往東吳', '171196', '東吳大學', '離站']);
  assert.deepEqual(byBus['EAA-078'].slice(2, 6), ['往天文館', '171170', '捷運士林站(中正)', '到站']);
  assert.equal(byBus['EAA-057'][6].toISOString(), new Date('2026-11-24T16:16:26+08:00').toISOString());
  assert.deepEqual(byBus['EAA-075'].slice(7), ['舒適', 4]);
});

test('網站預估：士林站（往東吳）、錢穆故居（往捷運站）各記一筆', () => {
  const env = setup();
  env.call('記錄557動態');
  const etas = rowsOf(env, '557預估紀錄').map(r => r.slice(1));
  assert.deepEqual(etas, [
    ['往東吳｜捷運士林站(中正)', 214, 'EAA-057', '2026-11-24 16:17:12'],
    ['往捷運站｜東吳大學(錢穆故居)', 104, 'EAA-068', '2026-11-24 16:17:12'],
  ]);
});

test('同一台車停在同一站、狀態沒變，下一分鐘不重複記；換站了才記', () => {
  const env = setup();
  env.call('記錄557動態');
  env.addMinutes(1);
  env.call('記錄557動態');
  env.addMinutes(0.5);
  env.call('記錄557動態'); // 30 秒內又被呼叫：直接跳過
  assert.equal(rowsOf(env, '557動態紀錄').length, 7);
  assert.equal(rowsOf(env, '557預估紀錄').length, 4);
  const moved = JSON.parse(JSON.stringify(SAMPLE));
  const bus = moved.Bus.find(b => b.num === 'EAA-057');
  bus.a2 = bus.a2.split(',').map((v, i) => (i === 7 ? '171189' : i === 11 ? '261124161805' : v)).join(',');
  env.respond['RouteDyna'] = moved;
  env.addMinutes(1);
  env.call('記錄557動態');
  const rows = rowsOf(env, '557動態紀錄');
  assert.equal(rows.length, 8);
  assert.deepEqual(rows[7].slice(1, 6), ['EAA-057', '往東吳', '171189', '捷運士林站(中正)', '到站']);
  assert.equal(rowsOf(env, '557預估紀錄').length, 6, '預估每分鐘都記');
});

test('超過 20 分鐘沒更新的車不記（停在場站或 GPS 斷線）', () => {
  const env = setup('2026-11-24T16:40:00+08:00');
  env.call('記錄557動態');
  // 範例裡最新的車是 16:17 的，到 16:40 全部都太舊
  assert.equal(env.sheets['557動態紀錄'], undefined);
  assert.equal(rowsOf(env, '557預估紀錄').length, 2, '網站預估還是照記');
});

test('凌晨、深夜不抓；網站掛掉不會出錯也不寫東西', () => {
  const env = setup('2026-11-24T05:30:00+08:00');
  env.call('記錄557動態');
  assert.equal(env.fetches.length, 0);
  const down = setup();
  down.onFetch = () => ({ code: 503, body: 'busy' });
  down.call('記錄557動態');
  assert.equal(down.sheets['557動態紀錄'], undefined);
});

test('設定排程：每分鐘一次，重複執行不會疊兩個', () => {
  const env = setup();
  env.call('設定557紀錄排程');
  assert.equal(env.triggers.filter(t => t.getHandlerFunction() === '記錄557動態').length, 1);
  assert.ok(env.sheets['557動態紀錄'] && env.sheets['557預估紀錄']);
});
