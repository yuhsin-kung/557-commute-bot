/**
 * 到校預估：幾點到 557 站牌（捷運到站牌.gs 算的）→ 幾點到東吳。
 * 用 預測表557.gs（監測資料整理的歷史統計，tools/匯出Bot預測表557.py 產生）：
 *   離峰：到站牌＋第一台到東吳的中位數，給一個時間
 *   尖峰（07:30–08:00、09:15–10:00）：一律給範圍，第一台中位數 ～ 照排隊規則最晚到東吳的 P80（團隊規定尖峰不准只推公車時間）
 * 兩個站牌（捷運士林站、士林國中）出捷運站都約走 5 分鐘，兩個都算，推薦比較早到的：
 *   尖峰比「最晚」，離峰比「第一台」。09:30–10:00 多半是國中（士林站排最兇）
 */

const P557_STOPS = ['捷運士林站', '士林國中'];

function p557InPeak_(minute) {
  return P557_PEAKS.some(p => p[0] <= minute && minute < p[1]);
}

/** 這個時刻最接近的那一格（前後 5 分鐘內），沒有就 null */
function p557Row_(stop, minute) {
  let best = null;
  (P557_TABLE[stop] || []).forEach(r => {
    if (Math.abs(r[0] - minute) <= 5 && (!best || Math.abs(r[0] - minute) < Math.abs(best[0] - minute))) best = r;
  });
  return best;
}

/**
 * 從這個站牌、atStop 這一刻開始等車，幾點到東吳。
 * 回傳 { stop, peak, early, late, queuePct, text }（early、late 是 Date；離峰 late＝null），查不到回 null
 */
function p557Estimate_(stop, atStop) {
  const wd = Number(Utilities.formatDate(atStop, TZ, 'u'));
  if (wd >= 6) return null;
  const minute = mrtMinuteOfDay_(atStop); // 捷運到站牌.gs
  const row = p557Row_(stop, minute);
  if (!row) return null;
  const hm = d => Utilities.formatDate(d, TZ, 'HH:mm');
  const early = new Date(atStop.getTime() + Math.round(row[1]) * 60000);
  const peak = p557InPeak_(minute);
  if (!peak) return { stop, peak, early, late: null, queuePct: row[3], text: `約 ${hm(early)} 到東吳` };
  const late = new Date(atStop.getTime() + Math.ceil(Math.max(row[4], row[2])) * 60000);
  return { stop, peak, early, late, queuePct: row[3],
    text: `${hm(early)}–${hm(late)} 到東吳（尖峰` + (row[3] >= 10 ? `，第一台要排隊的機率約 ${row[3]}%）` : '，這站通常不用排）') };
}

/** 兩個站牌都算，排出推薦的那個（尖峰比最晚、離峰比第一台；一樣就捷運站） */
function p557Both_(atStop) {
  const all = P557_STOPS.map(s => p557Estimate_(s, atStop)).filter(Boolean);
  if (!all.length) return null;
  const key = e => (e.peak ? e.late : e.early).getTime();
  const best = all.reduce((a, b) => (key(b) < key(a) ? b : a));
  return { best, all };
}

/** 給學生看的幾行字 */
function p557Lines_(atStop) {
  const r = p557Both_(atStop);
  if (!r) return ['這個時間還沒有 557 的預測（目前只有平常日 07:00–18:30）'];
  const lines = [`建議走去${r.best.stop}站牌：${r.best.text}`];
  r.all.filter(e => e !== r.best).forEach(e => lines.push(`（${e.stop}站牌：${e.text}）`));
  return lines;
}

// ===== 到校預估網頁：按一個按鈕 → 手機定位 → mrtPlanFromHere（捷運到站牌.gs）→ 顯示幾點到東吳 =====

/** LINE 裡傳「到校預估」→ 打開網頁的按鈕 */
function etaButton_() {
  return choices_('按下面的按鈕，用你現在的位置算：走到哪個捷運站、搭哪班捷運、走去哪個 557 站牌，幾點到東吳。\n\n手機問要不要允許定位，請按允許。位置只用來算時間，不會記錄。', // 卡片.gs
    [{ label: '用我的位置查', uri: cpWebAppUrl_() + '?page=eta' }], { title: '🚇 從我這裡出發幾點到校', badge: '出門前提醒' }); // 共乘.gs
}

function etaPage_() {
  return HtmlService.createHtmlOutput(ETA_HTML.replace('__BOT__', CP_BOT_ID)) // 共乘.gs
    .setTitle('幾點到東吳')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

const ETA_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<base target="_top">
<style>
  body { margin:0; padding:16px; font:16px/1.6 -apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif; background:#f4f5f7; color:#1c2330; }
  .card { background:#fff; border:1px solid #e4e7ec; border-radius:14px; padding:18px; max-width:440px; margin:0 auto 12px; }
  h1 { font-size:22px; margin:0 0 6px; }
  button, a.btn { display:block; width:100%; box-sizing:border-box; text-align:center; text-decoration:none; padding:14px; border-radius:12px; border:0; background:#0b6e4f; color:#fff; font-size:17px; font-weight:700; margin-top:12px; }
  a.btn { background:#fff; color:#0b6e4f; border:1px solid #0b6e4f; }
  button:disabled { opacity:.5; }
  .big { font-size:26px; font-weight:700; color:#0b6e4f; margin:4px 0; }
  .bad { color:#b42318; font-weight:700; font-size:20px; }
  .sub { color:#667085; font-size:14px; }
  .step { padding:8px 0; border-bottom:1px solid #f0f1f3; }
  .step:last-child { border-bottom:0; }
  p { margin:4px 0; }
</style>
</head>
<body>
<div class="card">
  <h1>從我這裡出發，幾點到東吳？</h1>
  <p>用你現在的位置，算走到哪個捷運站、搭哪班捷運、走去哪個 557 站牌、幾點到東吳。</p>
  <div class="sub">位置只用來算時間，不會記錄。尖峰時段 557 可能要排隊，所以會給一個範圍。</div>
  <button id="go" onclick="run()">用我的位置查</button>
</div>
<div class="card" id="out" style="display:none"></div>
<script>
var BOT = '__BOT__';
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function toLine(text) { return 'https://line.me/R/oaMessage/' + encodeURIComponent(BOT) + '/?' + encodeURIComponent(text); }
function done(msg) {
  var btn = document.getElementById('go');
  btn.disabled = false; btn.textContent = '重新查一次';
  var out = document.getElementById('out');
  out.style.display = 'block';
  out.innerHTML = msg + '<a class="btn" href="' + toLine('出門前提醒') + '">回 LINE</a>';
}
function render(r) {
  if (!r || !r.lines) return done('<div class="bad">算不出來</div><p>請等一下再試一次。</p>');
  var head = '';
  if (r.ok && r.school) {
    head = '<div class="sub">建議走去' + esc(r.school.stop) + '站牌</div>'
      + '<div class="big">' + esc(r.school.late ? r.school.early + '–' + r.school.late : '約 ' + r.school.early) + ' 到東吳</div>';
  } else if (!r.ok) {
    head = '<div class="bad">算不出來</div>';
  }
  done(head + r.lines.map(function (l) { return '<div class="step">' + esc(l) + '</div>'; }).join(''));
}
function run() {
  var btn = document.getElementById('go');
  if (!('geolocation' in navigator)) return done('<div class="bad">拿不到定位</div><p>這個瀏覽器不支援定位。</p>');
  btn.disabled = true; btn.textContent = '定位中…';
  navigator.geolocation.getCurrentPosition(function (pos) {
    btn.textContent = '計算中…';
    google.script.run
      .withSuccessHandler(render)
      .withFailureHandler(function () { done('<div class="bad">連線失敗</div><p>請等一下再試一次。</p>'); })
      .mrtPlanFromHere(pos.coords.latitude, pos.coords.longitude);
  }, function (err) {
    var why = { 1: '沒有允許定位。請到手機設定打開 LINE 的定位權限。', 2: '手機抓不到位置，走到窗邊或室外再試一次。', 3: '等太久了，再試一次。' }[err.code] || '不明原因';
    done('<div class="bad">拿不到定位</div><p>' + esc(why) + '</p>');
  }, { enableHighAccuracy: false, timeout: 20000, maximumAge: 60000 });
}
</script>
</body>
</html>`;
