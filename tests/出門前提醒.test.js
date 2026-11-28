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
  // 11/28 團隊設計稿：往東吳、往捷運站分兩組
  assert.match(card.altText, /往東吳方向\n捷運士林站（中正）\n5 分鐘後到站\n士林國中\n即將進站\n往捷運站方向\n東吳大學（錢穆故居）\n10 分鐘後到站/);
  assert.doesNotMatch(card.altText, /15 分鐘/);
  assert.doesNotMatch(card.altText, /今天已經收班/);
  const b = buttonsOf(card);
  assert.deepEqual(b, [['比較所有路線', '比較所有路線'], ['回報我在哪裡排隊', '回報我在哪裡排隊'], ['查看 557 站牌資訊', '查看 557 站牌資訊']]);
  const chips = card.contents.footer.contents;
  assert.equal(chips[0].backgroundColor, '#A63A2B', '比較所有路線：紅色主要按鈕');
  assert.equal(chips[1].backgroundColor, '#EEF2F7', '回報我在哪裡排隊：灰色次要按鈕');
  assert.equal(chips[2].borderWidth, '1px', '557 站牌資訊：紅字外框');
  assert.equal(chips[2].contents[0].color, '#A63A2B');
  // 末班車已過：琥珀色狀態標籤，並提醒改搭其他路線
  env.respond['EstimatedTimeOfArrival'] = ['捷運士林站(中正)', '士林國中', '東吳大學(錢穆故居)'].map((n, i) => ({ Direction: i < 2 ? 0 : 1, StopName: { Zh_tw: n }, StopStatus: 3 }));
  const ended = env.call('route_', '557 即時動態');
  assert.match(ended.altText, /捷運士林站（中正）\n末班車已過/);
  assert.match(ended.altText, /557 今天已經收班\n可以按「比較所有路線」改搭其他公車/);
  assert.match(JSON.stringify(ended.contents), /"backgroundColor":"#FEF3E2","cornerRadius":"12px"[^}]*"contents":\[\{"type":"text","text":"末班車已過"/);
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
  assert.match(saidOf(card), /提醒條件\n🌧️ 隔天降雨機率達 60% 以上\n提醒隔天可能下雨，提早準備雨具。\n📖 遇到考試週/);
  assert.match(saidOf(card), /🕘 提醒時間\n每晚 9:00\n符合提醒條件時，於前一晚推播通知。\n📅 週末及放假日不會推播提醒。/);
  assert.deepEqual(buttonsOf(card), [['開啟提醒', '開啟提醒'], ['關閉提醒', '關閉提醒']], '按鈕傳出的字跟按鈕一樣');
  // 按了開啟：訂閱成功卡片；再看設定是「已開啟」；關閉：已取消卡片
  const send = text => { env.call('handleEvent_', { type: 'message', replyToken: 'r', source: { userId: 'A' }, message: { type: 'text', text } }); return env.fetches.filter(f => f.url.endsWith('/message/reply')).pop().body.messages[0]; };
  assert.match(send('開啟提醒').altText, /✅ 訂閱成功！\n已成功開啟雨天與考試週提醒。\n提醒時間\n每晚 9:00[\s\S]*不想再收到提醒？可隨時選擇「取消提醒」。/);
  assert.match(send('雨天與考試週訂閱提醒').altText, /雨天與考試週提醒\n已開啟/);
  assert.match(send('關閉提醒').altText, /✅ 已取消提醒！\n已關閉雨天與考試週提醒，之後不會再收到相關推播。\n想重新開啟提醒嗎？\n隨時傳送「訂閱提醒」，即可重新開啟通知。/);
  assert.match(send('訂閱提醒設定').altText, /雨天與考試週提醒\n未開啟/);
  assert.match(send('訂閱提醒').altText, /訂閱成功/, '舊的「訂閱提醒」也認得');
});

test('比較所有公車路線：最快的車開進學校就說「抵達學校」，到錢穆故居站才說「步行進校」', () => {
  const env = loadBot(ALL);
  const eta = (route, dir, sec) => ({ RouteName: { Zh_tw: route }, Direction: dir, EstimateTime: sec });
  env.context.__etas = [eta('557', 0, 60), eta('紅30', 1, 600)];
  env.run('etaAtStop_ = () => __etas; isPeak_ = () => false;');
  assert.match(env.call('liveReply_', '士林站', '', null).altText, /今日推薦路線\n557\n公車最快\n\d\d:\d\d\n預計抵達東吳大學\n📍 直接進入校園/);
  env.context.__etas = [eta('557', 0, 900), eta('紅30', 1, 60)];
  const alt = env.call('liveReply_', '士林站', '', null).altText;
  assert.match(alt, /今日推薦路線\n紅30\n公車最快\n\d\d:\d\d\n預計抵達錢穆故居站\n📍 下車後步行進入校園/);
  assert.match(alt, /💡 通勤建議\n想搭公車，推薦選擇 紅30，預計 \d\d:\d\d 抵達錢穆故居站。/);
  assert.match(alt, /其他公車路線\n557\n直接進校園\n\d\d:\d\d 到\n15 分鐘後/);
  assert.doesNotMatch(alt, /公車首選/);
  assert.doesNotMatch(alt, /走一樣的路/);
});

test('比較所有路線：公車下面接著列 YouBike 和計程車共乘；舊說法「比較所有公車路線」也認得', () => {
  const env = loadBot(ALL);
  const eta = (route, dir, sec) => ({ RouteName: { Zh_tw: route }, Direction: dir, EstimateTime: sec });
  env.context.__etas = [eta('557', 0, 60), eta('紅30', 1, 600)];
  env.run('etaAtStop_ = () => __etas; isPeak_ = () => false;');
  env.respond.youbike = [{ sna: 'YouBike2.0_捷運士林站(1號出口)', available_rent_bikes: 12, available_return_bikes: 20, latitude: 25.0955, longitude: 121.527 }];
  const alt = env.call('liveReply_', '士林站', '', null).altText;
  assert.match(alt, /其他通勤方式\n🚲 YouBike\n約 \d\d:\d\d 到\n士林站附近可借 12 台，騎約 18 分鐘/);
  assert.match(alt, /🚕 計程車共乘\n約 \d\d:\d\d 到\n最多等 5 分鐘湊人，4 人每人約 40 元/);
  assert.match(alt, /💡 通勤建議\n想搭公車，推薦選擇 557/);
  const card = env.call('liveReply_', '士林站', '', null);
  assert.deepEqual(buttonsOf(card), [['找人共乘計程車', '計程車共乘'], ['查看 YouBike 車數', '查看 YouBike 車數']]);
  assert.match(env.call('memberReply_', 'A', '查看 YouBike 車數').altText, /YouBike 通勤資訊/, '「查看 YouBike 車數」Bot 認得');
  assert.equal(env.call('route_', '比較所有公車路線').altText.split('\n')[0], env.call('route_', '比較所有路線').altText.split('\n')[0]);
});

test('557 發車前提醒：出門建議按一下就設好，時間到推播 557 下一班多久到士林站', () => {
  const env = loadBot(ALL);
  env.setNow('2026-10-12T21:00:00+08:00');
  const plan = env.call('planReply_', '士林站', 'D', new Date('2026-10-13T08:10:00+08:00'), true);
  const button = buttonsOf(plan).find(b => b[0] === '557 發車前提醒我');
  assert.ok(button, '士林站出發的出門建議有提醒按鈕');
  assert.match(button[1], /^出門提醒 明天 \d\d:\d\d$/);
  assert.equal(buttonsOf(env.call('planReply_', '劍南路站', 'D', new Date('2026-10-13T08:10:00+08:00'), true)).some(b => b[0] === '557 發車前提醒我'), false, '不搭 557 就沒有');

  const set = env.call('memberReply_', 'A', '出門提醒 明天 07:40');
  assert.match(saidOf(set), /已設定出門提醒/);
  assert.match(saidOf(set), /明天 07:25，我會告訴你 557 下一班多久到士林站/);
  env.call('memberReply_', 'A', '出門提醒 明天 07:45'); // 再設一次會蓋掉舊的
  assert.deepEqual(env.sheets['發車提醒'].rows.slice(1).map(r => r[4]), ['取消', '等待中']);

  env.props.TDX_CLIENT_ID = 'id';
  env.respond['openid-connect/token'] = { access_token: 't' };
  env.respond['EstimatedTimeOfArrival'] = [{ RouteName: { Zh_tw: '557' }, Direction: 0, EstimateTime: 240 }, { RouteName: { Zh_tw: '557' }, Direction: 1, EstimateTime: 60 }];
  env.setNow('2026-10-13T07:29:00+08:00');
  env.call('lvTick_', env.call('cpNow_'));
  assert.equal(env.fetches.filter(f => f.url.endsWith('/message/push')).length, 0, '還沒到 07:30 不推');
  env.setNow('2026-10-13T07:30:00+08:00');
  env.call('lvTick_', env.call('cpNow_'));
  const pushed = env.fetches.filter(f => f.url.endsWith('/message/push'));
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].body.to, 'A');
  const said = JSON.stringify(pushed[0].body.messages);
  assert.match(said, /建議 07:45 前到士林站/);
  assert.match(said, /557 下一班約 4 分鐘後到士林站/, '只看往東吳的方向');
  env.call('lvTick_', env.call('cpNow_'));
  assert.equal(env.fetches.filter(f => f.url.endsWith('/message/push')).length, 1, '一個提醒只推一次');

  assert.match(env.call('memberReply_', 'A', '取消出門提醒'), /目前沒有設定出門提醒/);
  assert.match(saidOf(env.call('memberReply_', 'A', '出門提醒 今天 07:40')), /快到出門時間了/);
});

test('站位變更：站牌真的改了才推播給所有好友（不用訂閱）；只改排版或沒變就不推', () => {
  const env = loadBot(ALL);
  env.context.__page = '557 在中正路 205 號前上車';
  env.context.__diff = '';
  env.run('fetchStationPage_ = () => __page; diffSummary_ = () => __diff; summarizeStation_ = () => "摘要";');
  const sent = () => env.fetches.filter(f => /\/message\/(broadcast|multicast)$/.test(f.url));
  env.call('檢查站位變更'); // 第一次只記比對基準
  assert.equal(sent().length, 0);
  env.call('檢查站位變更');
  assert.equal(sent().length, 0, '頁面沒變就不推');
  env.context.__page = '557 在中正路 205 號前上車。';
  env.call('檢查站位變更');
  assert.equal(sent().length, 0, '只改排版（Gemini 說無實質變更）也不推');
  env.context.__page = '557 改到中正路 221 號前上車';
  env.context.__diff = '557 士林站上車處搬到中正路 221 號前。';
  env.call('檢查站位變更');
  assert.equal(sent().length, 1);
  assert.match(sent()[0].url, /\/message\/broadcast$/, '發給所有好友，不是只發給訂閱的人');
  assert.match(JSON.stringify(sent()[0].body.messages), /搬到中正路 221 號前/);
  assert.doesNotMatch(saidOf(env.call('remindSettings_')), /上車地點/, '訂閱提醒只講雨天和考試週');
});
