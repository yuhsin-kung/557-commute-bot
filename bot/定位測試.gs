/**
 * 定位測試（暫時的，確認完就可以刪）
 *
 * 步行積分（11）想用手機定位打卡，取代會被拍照外流的 QR code。
 * 但 Apps Script 的網頁包在一層框架裡，不確定在 LINE 裡拿不拿得到手機定位，所以先做這一頁來試。
 * 在 LINE 傳「定位測試」→ 打開測試頁 → 按「測試定位」。結果會記到「定位測試」分頁。
 *
 * 只記有沒有成功、誤差、離哪個點最近和距離，不記經緯度。
 * 座標是 TDX 公車站牌的位置（2026-10-13 查的）。
 */
const GEO_POINTS = {
  錢穆故居站: [25.09727, 121.54160], // 至善路、臨溪路口，往東往西兩支站牌的中間
  '校內 557 站': [25.09457, 121.54575],
  捷運士林站: [25.09547, 121.52690],
  士林國中站: [25.09465, 121.52305],
};

function geoTestPage_() {
  return HtmlService.createHtmlOutput(GEO_TEST_HTML.replace('__POINTS__', JSON.stringify(GEO_POINTS)))
    .setTitle('定位測試')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function geoTestButton_() {
  return {
    type: 'template',
    altText: '定位測試',
    template: {
      type: 'buttons',
      text: '打開測試頁，按「測試定位」。手機問要不要允許定位時，請按允許。',
      actions: [{ type: 'uri', label: '打開定位測試', uri: cpWebAppUrl_() + '?page=geo' }], // 共乘.gs
    },
  };
}

/** 測試頁回報結果。這是公開網頁能呼叫的函式，所以每個欄位都只收固定格式、限制長度 */
function geoTestLog(result) {
  const r = result || {};
  const text = (v, max) => String(v == null ? '' : v).slice(0, max);
  const num = v => (typeof v === 'number' && isFinite(v) ? Math.round(v) : '');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('定位測試');
  if (!sheet) {
    sheet = ss.insertSheet('定位測試');
    sheet.appendRow(['時間', '結果', '誤差（公尺）', '最近的點', '距離（公尺）', '花了幾秒', '錯誤', '環境', '瀏覽器']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), r.ok === true ? '成功' : '失敗', num(r.accuracy), GEO_POINTS[r.nearest] ? r.nearest : '', num(r.distance),
    num(r.seconds), text(r.error, 120), text(r.env, 120), text(r.ua, 200)]);
  return true;
}

const GEO_TEST_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<base target="_top">
<style>
  body { margin:0; padding:16px; font:16px/1.6 -apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif; background:#f4f5f7; color:#1c2330; }
  .card { background:#fff; border:1px solid #e4e7ec; border-radius:14px; padding:18px; max-width:440px; margin:0 auto 12px; }
  h1 { font-size:22px; margin:0 0 6px; }
  button { display:block; width:100%; padding:14px; border-radius:12px; border:0; background:#0b6e4f; color:#fff; font-size:17px; font-weight:700; margin-top:12px; }
  button:disabled { opacity:.5; }
  .big { font-size:26px; font-weight:700; margin:6px 0; }
  .ok { color:#0b6e4f; } .bad { color:#b42318; }
  table { width:100%; border-collapse:collapse; margin-top:8px; }
  td { padding:7px 0; border-top:1px solid #e4e7ec; } td:last-child { text-align:right; font-variant-numeric:tabular-nums; }
  small, .sub { color:#667085; font-size:14px; }
</style>
</head>
<body>
<div class="card">
  <h1>定位測試</h1>
  <div class="sub">確認這個網頁在你的手機上拿不拿得到定位。只會記錄有沒有成功、誤差，和離哪個站最近，不會記錄你的位置。</div>
  <button id="go" onclick="run()">測試定位</button>
</div>
<div class="card" id="out" style="display:none"></div>
<div class="card"><small id="env"></small></div>
<script>
var POINTS = __POINTS__;

function meters(a, b) {
  var R = 6371000, rad = Math.PI / 180;
  var dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function environment() {
  var policy = '不明';
  try { if (document.featurePolicy) policy = document.featurePolicy.allowsFeature('geolocation') ? '允許' : '不允許'; } catch (e) {}
  return [
    '支援定位：' + ('geolocation' in navigator ? '是' : '否'),
    '框架允許定位：' + policy,
    '安全連線：' + (window.isSecureContext ? '是' : '否'),
    '在框架裡：' + (window.self !== window.top ? '是' : '否'),
    'LINE 內：' + (/Line\\//i.test(navigator.userAgent) ? '是' : '否'),
  ].join('｜');
}

function show(html) { var out = document.getElementById('out'); out.style.display = 'block'; out.innerHTML = html; }
function report(r) {
  r.env = environment(); r.ua = navigator.userAgent;
  try { google.script.run.withFailureHandler(function () {}).geoTestLog(r); } catch (e) {}
}

function run() {
  var btn = document.getElementById('go'), started = Date.now();
  if (!('geolocation' in navigator)) {
    show('<div class="big bad">拿不到定位</div><div>這個瀏覽器不支援定位。</div>');
    return report({ ok: false, error: '不支援 geolocation' });
  }
  btn.disabled = true; btn.textContent = '定位中…（最多 20 秒）';
  navigator.geolocation.getCurrentPosition(function (pos) {
    var here = [pos.coords.latitude, pos.coords.longitude], rows = '', nearest = '', best = Infinity;
    Object.keys(POINTS).forEach(function (name) {
      var d = meters(here, POINTS[name]);
      if (d < best) { best = d; nearest = name; }
      rows += '<tr><td>' + name + '</td><td>' + (d < 1000 ? Math.round(d) + ' 公尺' : (d / 1000).toFixed(1) + ' 公里') + '</td></tr>';
    });
    var seconds = (Date.now() - started) / 1000;
    show('<div class="big ok">拿到定位了 ✓</div><div>誤差大約 ' + Math.round(pos.coords.accuracy) + ' 公尺，花了 ' + seconds.toFixed(1) + ' 秒</div>'
      + '<table>' + rows + '</table><div class="sub" style="margin-top:8px">離你最近的是「' + nearest + '」。</div>');
    btn.disabled = false; btn.textContent = '再測一次';
    report({ ok: true, accuracy: pos.coords.accuracy, nearest: nearest, distance: best, seconds: seconds });
  }, function (err) {
    var why = { 1: '沒有允許定位（或被框架擋掉）', 2: '手機抓不到位置', 3: '等太久，逾時' }[err.code] || '不明原因';
    show('<div class="big bad">拿不到定位</div><div>' + why + '</div><div class="sub">錯誤代碼 ' + err.code + '：' + String(err.message).replace(/</g, '&lt;') + '</div>');
    btn.disabled = false; btn.textContent = '再測一次';
    report({ ok: false, error: err.code + ' ' + err.message, seconds: (Date.now() - started) / 1000 });
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}

document.getElementById('env').textContent = environment();
</script>
</body>
</html>`;
