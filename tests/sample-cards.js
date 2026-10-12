// 用假資料做出每一種回覆的卡片。測試、送 LINE 驗證格式、電腦上預覽都用這一份。
const { loadBot } = require('./gas-env');

const FILES = ['Code.gs', '卡片.gs', '選單.gs', '比較器.gs', '晚上提醒.gs', '站位變更.gs', '共乘.gs', '等車室.gs', '定位測試.gs'];

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

  keep('主選單', env.call('menuCard_'));
  return cards;
}

module.exports = { sampleCards };
