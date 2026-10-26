// 出門前提醒的新規則：557 即時動態一次看兩個方向、降雨查詢看哪一段、下雨或考試週多留 20 分鐘。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');
const { saidOf, buttonsOf } = require('./helpers');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));
const plain = v => JSON.parse(JSON.stringify(v));

test('557 即時動態：往東吳（士林站、士林國中）和往捷運站（東吳大學）一起列出來', () => {
  const env = loadBot(ALL);
  env.props.TDX_CLIENT_ID = 'id';
  env.respond['openid-connect/token'] = { access_token: 't' };
  env.respond['EstimatedTimeOfArrival'] = [
    { Direction: 0, StopName: { Zh_tw: '捷運士林站(中正)' }, EstimateTime: 300 },
    { Direction: 0, StopName: { Zh_tw: '士林國中' }, EstimateTime: 60 },
    { Direction: 1, StopName: { Zh_tw: '東吳大學(錢穆故居)' }, EstimateTime: 600 },
    { Direction: 1, StopName: { Zh_tw: '捷運士林站(中正)' }, EstimateTime: 900 }, // 回程經過士林站，不能混進「往東吳」
  ];
  const card = env.call('route_', '557 即時動態');
  assert.match(card.altText, /往東吳｜捷運士林站\(中正\)：5 分鐘後到站/);
  assert.match(card.altText, /往東吳｜士林國中：即將進站/);
  assert.match(card.altText, /往捷運站｜東吳大學\(錢穆故居\)：10 分鐘後到站/);
  assert.doesNotMatch(card.altText, /15 分鐘/);
  ['557', '557 到站', '557 去學校', '557 回家'].forEach(old => assert.equal(env.call('route_', old).altText.split('\n')[0], card.altText.split('\n')[0], old + ' 也是同一張'));
});

test('降雨查詢：晚上 7 點以後看明天早上，早上 9 點前看今天早上，白天看現在這 3 小時', () => {
  const env = loadBot(ALL);
  const at = iso => plain(env.call('rainTarget_', new Date(iso)));
  assert.deepEqual(at('2026-10-12T19:00:00+08:00'), { day: '2026-10-13', hour: '06', morning: true, title: '明天早上 6–9 點' });
  assert.deepEqual(at('2026-10-12T18:59:00+08:00'), { day: '2026-10-12', hour: '18', morning: false, title: '今天 18–21 點' });
  assert.deepEqual(at('2026-10-12T07:30:00+08:00'), { day: '2026-10-12', hour: '06', morning: true, title: '今天早上 6–9 點' });
  assert.deepEqual(at('2026-10-12T13:10:00+08:00'), { day: '2026-10-12', hour: '12', morning: false, title: '今天 12–15 點' });
});

test('出門時間建議：隔天降雨機率 60% 以上或考試週，多留 20 分鐘；兩個都成立也是 20 分鐘', () => {
  const env = loadBot(ALL);
  const when = new Date('2026-11-10T08:10:00+08:00'); // 期中考週
  env.run('calendarEvent_ = () => null; rainPop_ = () => 80');
  assert.equal(env.call('crowdExtra_', when).min, 20, '只有下雨');
  env.run("calendarEvent_ = () => [null, null, '考試', '期中考試']; rainPop_ = () => 10");
  assert.equal(env.call('crowdExtra_', when).min, 20, '只有考試週');
  env.run('rainPop_ = () => 90');
  assert.equal(env.call('crowdExtra_', when).min, 20, '兩個都成立');
  env.run('calendarEvent_ = () => null; rainPop_ = () => 30');
  assert.equal(env.call('crowdExtra_', when).min, 0);
});

test('雨天與考試週訂閱提醒：說明會提醒什麼，給開啟、關閉兩顆按鈕', () => {
  const env = loadBot(ALL);
  const card = env.call('remindSettings_');
  assert.match(saidOf(card), /降雨機率 60% 以上或遇到考試週，每晚 9 點提醒你提早出門/);
  assert.deepEqual(buttonsOf(card), [['開啟提醒', '訂閱提醒'], ['關閉提醒', '取消提醒']]);
});

test('比較所有公車路線：最快的車開進學校就說「抵達學校」，到錢穆故居站才說「步行進校」', () => {
  const env = loadBot(ALL);
  const eta = (route, dir, sec) => ({ RouteName: { Zh_tw: route }, Direction: dir, EstimateTime: sec });
  env.context.__etas = [eta('557', 0, 60), eta('紅30', 1, 600)];
  env.run('etaAtStop_ = () => __etas; isPeak_ = () => false;');
  assert.match(env.call('liveReply_', '士林站', '', null).altText, /目前只要搭乘 557，便能最快速地抵達學校。/);
  env.context.__etas = [eta('557', 0, 900), eta('紅30', 1, 60)];
  const alt = env.call('liveReply_', '士林站', '', null).altText;
  assert.match(alt, /目前只要搭乘 紅30，便能最快速地抵達錢穆故居站，再步行進校。/);
  assert.doesNotMatch(alt, /走一樣的路/);
});
