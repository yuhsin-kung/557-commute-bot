/**
 * 電輔 YouBike（13）：士林站附近可以借幾台、學校附近可以還幾格
 *
 * 資料是臺北市 YouBike 2.0 的即時開放資料，不用金鑰，一分鐘更新一次。
 * 校內已經有 YouBike 站（見校園地圖），所以只列「士林站借、學校還」和回程的反方向。
 * 用到 Code.gs 的 nowText_，卡片.gs 的 dsCard_（設計稿版型）。
 */
const YB_URL = 'https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json';
const YB_MRT = [25.09547, 121.52690];    // 捷運士林站（跟定位測試.gs 同一個座標）
const YB_CAMPUS = [25.09457, 121.54575]; // 校內 557 站
const YB_NEAR_MRT_M = 400;
const YB_NEAR_CAMPUS_M = 700;

// 11/28 團隊設計稿：照通勤順序列站（士林站出來最常借的三站、到東吳最常還的三站）；這幾站查不到時用最近的站補
const YB_BORROW = [['捷運士林站(1號出口)', '捷運士林站（1號出口）'], ['福林公園', '福林公園'], ['中山中正路口', '中山中正路口']];
const YB_RETURN = [['東吳大學', '東吳大學'], ['國立故宮博物院', '國立故宮博物院'], ['至善臨溪路口', '至善臨溪路口']];

function ybReply_() {
  const stations = ybStations_();
  const head = { kicker: '557 以外的選擇', title: 'YouBike 通勤資訊', route: '捷運士林站 → 東吳大學' };
  if (!stations.length) {
    return dsCard_(Object.assign(head, { blocks: [{ text: '現在查不到 YouBike 即時資料，等一下再試一次 🙏' }] })); // 卡片.gs
  }
  const borrow = ybPick_(stations, YB_BORROW, 'toMrt', YB_NEAR_MRT_M);
  const back = ybPick_(stations, YB_RETURN, 'toCampus', YB_NEAR_CAMPUS_M);
  const avail = list => (list.length ? list.map(s => ({ avail: { name: s.label, bikes: s.bikes, docks: s.docks } })) : [{ text: '附近沒有站點資料', muted: true }]);
  const hasBike = borrow.some(s => s.bikes > 0);
  return dsCard_(Object.assign(head, {
    badge: hasBike ? '目前有車可借' : '士林站目前沒車',
    blocks: [
      { stats: [['單程距離', '約 3.5 公里'], ['路線特色', '部分上坡']] },
      { text: '可查看沿途借車站與東吳附近還車站的即時數量。', muted: true },
      { sec: '📍 士林站借車', note: '從士林出發，選擇方便的借車站' },
    ].concat(avail(borrow), [
      { sec: '📍 東吳附近還車', note: '抵達學校後，查看附近可還車的站點' },
    ], avail(back), [
      { panel: { title: '騎乘小提醒', lines: ['・距離：約 3.5 公里', '・路況：部分路段有上坡', '・建議：可選擇電輔車，騎乘較輕鬆'] } },
      { panel: { lines: ['🎁 騎乘集點：完成騎乘後，點擊下方按鈕並上傳騎乘紀錄截圖，即可獲得 1 點。'], tone: 'brand' } },
      { small: '資料更新時間：' + nowText_() + '｜臺北市 YouBike 開放資料' }, // Code.gs
    ]),
    // 按了跟「騎車到校」「騎車回士林」一樣（積分.gs）：等學生傳騎乘紀錄截圖
    buttons: [['提交騎車到校紀錄', '提交騎車到校紀錄'], ['提交騎車回士林紀錄', '提交騎車回士林紀錄']],
    alt: '🚲 YouBike 通勤資訊（' + (hasBike ? '目前有車可借' : '士林站目前沒車') + '）\n士林站借車：' + borrow.map(s => s.label + ' 可借 ' + s.bikes + '・可還 ' + s.docks).join('；')
      + '\n東吳附近還車：' + back.map(s => s.label + ' 可借 ' + s.bikes + '・可還 ' + s.docks).join('；'),
  }));
}

/** 先放設計稿指定的站（照順序），查不到的用最近的站補到 3 站 */
function ybPick_(stations, wanted, key, maxM) {
  const out = [];
  wanted.forEach(w => {
    const s = stations.filter(x => x.name === w[0])[0];
    if (s) out.push(Object.assign({ label: w[1] }, s));
  });
  stations.filter(s => s[key] <= maxM && !out.some(o => o.name === s.name)).sort((a, b) => a[key] - b[key])
    .slice(0, Math.max(0, 3 - out.length)).forEach(s => out.push(Object.assign({ label: s.name }, s)));
  return out;
}

/** 抓全市站點太大（一千多站），只留士林站和東吳附近的，快取一分鐘 */
function ybStations_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('youbike');
  if (cached) return JSON.parse(cached);
  let all;
  try {
    all = JSON.parse(UrlFetchApp.fetch(YB_URL, { muteHttpExceptions: true }).getContentText());
  } catch (err) {
    console.error(err);
    return [];
  }
  const near = (Array.isArray(all) ? all : []).map(s => {
    const here = [Number(s.latitude), Number(s.longitude)];
    return {
      name: String(s.sna || '').replace('YouBike2.0_', ''),
      bikes: Number(s.available_rent_bikes) || 0,
      docks: Number(s.available_return_bikes) || 0,
      toMrt: Math.round(ybMeters_(here, YB_MRT)),
      toCampus: Math.round(ybMeters_(here, YB_CAMPUS)),
    };
  }).filter(s => s.toMrt <= YB_NEAR_MRT_M || s.toCampus <= YB_NEAR_CAMPUS_M);
  if (near.length) cache.put('youbike', JSON.stringify(near), 60); // 抓不到（空的）不快取，下一次再抓
  return near;
}

function ybMeters_(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function 測試YouBike() {
  if (tooSoon_('測試YouBike', 60)) return; // Code.gs：公開網頁也呼叫得到，一分鐘只跑一次
  console.log(plain_(ybReply_())); // 卡片.gs
}
