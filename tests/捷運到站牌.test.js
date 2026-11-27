// 捷運到站牌：定位 → 最近的捷運站 → Google 地圖走路時間（查不到用距離估）→ 捷運時刻表 → 到士林站 → 加 5 分鐘到 557 站牌。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));
const plain = v => JSON.parse(JSON.stringify(v));
const ms = iso => new Date(iso).getTime();
const SHIPAI = [25.11440, 121.51540];   // 石牌站附近
const TAIPEI_MAIN = [25.04640, 121.51700]; // 台北車站附近

test('最近的捷運站：石牌附近 → 石牌站；到士林站 5 分鐘', () => {
  const env = loadBot(ALL);
  const st = plain(env.call('mrtNearest_', SHIPAI));
  assert.equal(st.name, '石牌');
  assert.equal(st.toShilin, 5);
});

test('走路時間：有 Google 地圖就用它，查不到就用距離 × 1.3 ÷ 每分鐘 75 公尺', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 6 * 60 + 10;
  let w = plain(env.call('mrtWalk_', SHIPAI, [25.11425, 121.51530]));
  assert.deepEqual(w, { min: 7, source: 'Google 地圖' });
  assert.equal(env.mapsCalls[0].mode, 'walking');
  env.walkSeconds = null; // 模擬額度用完
  w = plain(env.call('mrtWalk_', [25.0, 121.5], [25.0, 121.5 + 0.009]));
  assert.equal(w.source, '用距離估');
  assert.ok(w.min >= 15 && w.min <= 16, '約 900 公尺 × 1.3 ÷ 75 ≈ 16 分');
});

test('石牌 09:05 出發：走 6 分、進站 2 分 → 09:13 在月台 → 往南的車 09:18 前後到士林 → 加 5 分到站牌', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 6 * 60;
  const r = plain(env.call('mrtPlanFromHere', SHIPAI[0], SHIPAI[1], ms('2026-11-25T09:05:00+08:00')));
  assert.equal(r.ok, true);
  assert.equal(r.station, '石牌');
  // 需要 09:13 + 5 分 = 09:18 以後的往南班次：時刻表 09:20
  assert.equal(r.trainAtShilin, '09:20');
  assert.equal(r.atStop, '09:25');
  assert.match(r.lines.join('\n'), /走到石牌站約 6 分鐘（Google 地圖）/);
});

test('台北車站：搭往北的車（12 分）', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 3 * 60;
  const r = plain(env.call('mrtPlanFromHere', TAIPEI_MAIN[0], TAIPEI_MAIN[1], ms('2026-11-25T07:30:00+08:00')));
  // 07:35 在月台 + 12 分 = 07:47 以後的往北班次：時刻表 07:49
  assert.equal(r.station, '台北車站');
  assert.equal(r.trainAtShilin, '07:49');
  assert.equal(r.atStop, '07:54');
});

test('就在士林站附近：直接走去站牌；假日、晚上查不到班次', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 4 * 60;
  let r = plain(env.call('mrtPlanFromHere', 25.0955, 121.5270, ms('2026-11-25T08:00:00+08:00')));
  assert.equal(r.station, '士林');
  assert.equal(r.atStop, '08:04');
  r = plain(env.call('mrtPlanFromHere', SHIPAI[0], SHIPAI[1], ms('2026-11-28T09:05:00+08:00')));
  assert.equal(r.ok, false, '星期六');
  assert.match(r.lines.join('\n'), /平常日/);
  r = plain(env.call('mrtPlanFromHere', 'abc', 121.5));
  assert.equal(r.ok, false);
});

test('被亂按：Google 地圖每分鐘最多 30 次，超過改用距離估（不會擋掉學生）', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 300;
  const sources = Array.from({ length: 32 }, () => env.call('mrtWalk_', SHIPAI, [25.11425, 121.51530]).source);
  assert.equal(sources.filter(s => s === 'Google 地圖').length, 30);
  assert.equal(sources[31], '用距離估');
  assert.equal(env.mapsCalls.length, 30);
});
