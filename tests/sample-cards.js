// 用假資料做出每一種回覆的卡片。測試、送 LINE 驗證格式、電腦上預覽都用這一份。
const { loadBot } = require('./gas-env');

const fs = require('fs');
const path = require('path');
// 全部的 .gs 都載入（Code.gs 要排第一個）
const FILES = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));

function sampleCards() {
  const env = loadBot(FILES);
  const cards = {};
  const keep = (name, card) => { cards[name] = JSON.parse(JSON.stringify(card)); };
  const eta = (route, direction, seconds) => ({ RouteName: { Zh_tw: route }, Direction: direction, EstimateTime: seconds });

  env.context.__etas = [eta('557', 0, 540), eta('255', 1, 120), eta('304重慶', 1, 300), eta('紅30', 1, 60), eta('683', 0, 780), eta('111', 1, 30)];
  env.run('etaAtStop_ = () => __etas; rainPop_ = () => 20;');
  keep('即時比較', env.call('liveReply_', '士林站', 'B', null));
  keep('即時比較不指定大樓', env.call('liveReply_', '士林站', '', null));
  env.context.__etas = [];
  keep('即時比較沒車', env.call('liveReply_', '士林站', '', null));

  const tuesdayFirstPeriod = new Date('2026-10-13T08:10:00+08:00');
  keep('出門建議', env.call('planReply_', '士林站', 'H', tuesdayFirstPeriod, true));
  keep('出門建議劍南路', env.call('planReply_', '劍南路站', 'B', tuesdayFirstPeriod, true));

  env.context.__bus = [
    { StopName: { Zh_tw: '捷運士林站(中正)' }, EstimateTime: 240 },
    { StopName: { Zh_tw: '士林國中' }, StopStatus: 1 },
  ];
  env.run('tdx_ = () => __bus;');
  keep('557 到站', env.call('busReply_', 0, ['捷運士林站(中正)', '士林國中'], '557 士林 → 東吳'));
  keep('557 回家', env.call('busReply_', 1, ['東吳大學(錢穆故居)'], '557 東吳 → 士林'));

  const weather = pop => {
    env.onFetch = url => (url.includes('opendata.cwa.gov.tw') ? { body: { records: { Locations: [{ Location: [{ WeatherElement: [{ Time: [
      { StartTime: '2026-10-13T06:00:00+08:00', EndTime: '2026-10-13T09:00:00+08:00', ElementValue: [{ ProbabilityOfPrecipitation: String(pop) }] },
    ] }] }] }] } } } : undefined);
    return env.call('rainReply_');
  };
  keep('天氣會下雨', weather(80));
  keep('天氣不會下雨', weather(10));
  env.onFetch = null;

  keep('上車地點', env.call('stationReply_'));
  env.props.STATION_SUMMARY = '這是德育中心公告的摘要：\n📍士林站：大成安心購（中正路 205 號）前\n📍士林國中站：富邦銀行（中正路 341 號）前，尖峰建議來這裡排\n📍校內：操場側站牌後，依藍線排隊';
  env.props.STATION_CHECKED_AT = '10/13 09:00';
  keep('上車地點有摘要', env.call('stationReply_'));

  // 訊息裡的按鈕（choices_）：選單、分類、一步一步點的流程
  keep('選單', env.call('menuCard_'));
  keep('分類：出門前提醒', env.call('menuCategory_', '出門前提醒'));
  keep('分類：557 以外的選擇', env.call('menuCategory_', '557 以外的選擇'));
  keep('出門時間：選哪一天', env.call('menuFlow_', '出門時間'));
  keep('出門時間：選節次', env.call('menuFlow_', '出門時間 明天'));
  keep('出門時間：選大樓', env.call('menuFlow_', '出門時間 明天 08:10'));
  keep('共乘：選方向', env.call('cpText_', 'A', '共乘'));
  keep('共乘：現在走', env.call('cpText_', 'A', '共乘 去學校 現在走'));
  keep('共乘：選時間', env.call('cpText_', 'A', '共乘 去學校 預約'));
  keep('共乘：打開等車室', env.call('cpText_', 'A', '共乘 去學校 加入'));
  keep('打卡', env.call('ptCheckinButton_', 'A'));
  keep('新生測驗', env.call('nbQuiz_', 'A', '新生測驗'));
  keep('新生教學', env.call('nbIntro_'));
  keep('排隊禮儀短片', env.call('nbEtiquette_'));
  keep('公車站牌與排隊禮儀', env.call('nbStopQueue_'));
  keep('共享雨傘（Raingo）', env.call('umText_'));
  keep('出門提醒設好了', env.call('lvText_', 'A', '出門提醒 明天 07:40'));
  env.respond.youbike = [{ sna: 'YouBike2.0_捷運士林站(1號出口)', available_rent_bikes: 38, available_return_bikes: 22, latitude: 25.0955, longitude: 121.527 }, { sna: 'YouBike2.0_東吳大學', available_rent_bikes: 8, available_return_bikes: 14, latitude: 25.0946, longitude: 121.5457 }];
  keep('YouBike 車數', env.call('ybReply_'));
  // 學餐折價券：一張的卡片、兩張以上左右滑
  env.setNow('2026-10-26T08:00:00+08:00');
  const coupon = env.call('cpSheet_', '學餐折價券', ['時間', '使用者 ID', '券號', '面額', '狀態', '到期日']);
  coupon.appendRow([new Date('2026-10-26T08:00:00+08:00'), 'A', 'SC1026-0001', 30, '未使用', '2026/11/25']);
  keep('折價券', env.call('ptMyCoupons_', 'A'));
  coupon.appendRow([new Date('2026-10-26T08:00:00+08:00'), 'A', 'SC1026-0002', 30, '未使用', '2026/11/25']);
  keep('折價券兩張', env.call('ptMyCoupons_', 'A'));
  keep('兌換確認', env.call('ptRedeemAsk_', 'B'));
  keep('全校減碳', env.call('ptSchool_'));
  env.run('rainPop_ = () => 80');
  const reminder = env.call('buildReminder_', new Date('2026-10-13T12:00:00+08:00'));
  keep('推播：雨天提醒', env.call('choices_', reminder.message, reminder.buttons, { title: reminder.title, menu: false }));
  return cards;
}

module.exports = { sampleCards };
