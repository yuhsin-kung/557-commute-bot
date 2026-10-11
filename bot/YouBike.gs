/**
 * 電輔 YouBike（13）：士林站附近可以借幾台、學校附近可以還幾格
 *
 * 資料是臺北市 YouBike 2.0 的即時開放資料，不用金鑰，一分鐘更新一次。
 * 校內已經有 YouBike 站（見校園地圖），所以只列「士林站借、學校還」和回程的反方向。
 * 用到 Code.gs 的 nowText_。
 */
const YB_URL = 'https://tcgbusfs.blob.core.windows.net/dotapp/youbike/v2/youbike_immediate.json';
const YB_MRT = [25.09547, 121.52690];    // 捷運士林站（跟定位測試.gs 同一個座標）
const YB_CAMPUS = [25.09457, 121.54575]; // 校內 557 站
const YB_NEAR_MRT_M = 400;
const YB_NEAR_CAMPUS_M = 700;

function ybReply_() {
  const stations = ybStations_();
  if (!stations.length) return '🚲 現在查不到 YouBike 即時資料，等一下再試一次 🙏';
  const mrt = stations.filter(s => s.toMrt <= YB_NEAR_MRT_M).sort((a, b) => a.toMrt - b.toMrt).slice(0, 3);
  const campus = stations.filter(s => s.toCampus <= YB_NEAR_CAMPUS_M).sort((a, b) => a.toCampus - b.toCampus).slice(0, 3);
  const line = s => '・' + s.name + '：可借 ' + s.bikes + ' 台、可還 ' + s.docks + ' 格';
  return [
    '🚲 YouBike 2.0 即時車數',
    '',
    '📍 捷運士林站附近',
  ].concat(mrt.length ? mrt.map(line) : ['・附近沒有站點資料'])
    .concat(['', '📍 東吳附近'])
    .concat(campus.length ? campus.map(line) : ['・附近沒有站點資料'])
    .concat(['', '士林站到東吳大約 3.5 公里，有一段上坡，電輔車比較輕鬆。', '騎到學校後傳「打卡」，再傳「騎車到校」可以拿積分。', '', '（臺北市 YouBike 開放資料・' + nowText_() + '）'])
    .join('\n');
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
  cache.put('youbike', JSON.stringify(near), 60);
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
  console.log(ybReply_());
}
