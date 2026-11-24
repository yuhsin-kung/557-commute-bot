/**
 * 557 到站紀錄：每分鐘記一次 557 每台車在哪一站、多擠，累積起來給「現在出門幾點到校」做預測。
 *
 * 資料來源：臺北市公車動態「行動查詢系統」網頁背後的 JSON（pda5284.gov.taipei），
 * 跟網頁上看到的是同一份：每站預估秒數、每台車到／離哪一站（含時間）、車上擁擠程度。
 * 一次約 5 KB、不用金鑰，不會用到 TDX 點數。
 *
 * 寫進兩個分頁：
 *   557動態紀錄：每台車每次「到站／離站」記一筆（同一個狀態只記一次）
 *   557預估紀錄：每分鐘記一次「網站預估 557 幾分鐘後到士林站（往東吳）」，之後拿來比對網站預估準不準
 *
 * 欄位格式是從網頁的程式（route.jsp?rid=17333）讀出來的：
 *   Bus[].a2 = A2,…,[6]方向(0 往東吳/1 往天文館),[7]站代號,[8]1 在站/0 離站,…,[11]時間 yyMMddHHmmss
 *   Bus[].a3 = A3,…,[4]站代號,[5]車上人數（56 人＝擁擠、4 人＝舒適，網頁程式的變數名稱寫成剩餘量但實際是人數）,[6]擁擠等級(1 舒適/2 中等/3 擁擠，0 就看人數),[7]時間
 *   Stop[].n1 = N1,[1]站代號,…,[3]最近那台車,…,[7]預估秒數(-1 未發車、-2 交管不停、-3 末班已過、-4 今日未營運)
 */
const DYNA_URL = 'https://pda5284.gov.taipei/MQS/RouteDyna?routeid=17333';
const DYNA_HOURS = ['06:00', '20:30']; // 這段時間以外不抓（557 首班約 06:00、末班約 20:00）
const DYNA_STALE_MIN = 20; // 網頁也是這樣：超過 20 分鐘沒更新的車不算（停在場站、GPS 斷線）

const DYNA_STOPS = {
  212023: '天文科學館', 212024: '國立科教館', 171175: '士林高商', 187538: '士林區行政中心(中正)',
  171188: '士林國中', 171189: '捷運士林站(中正)', 171190: '福林國小', 171191: '士林官邸(中正)',
  171192: '泰北中學', 171193: '雙溪公園', 171194: '梅林新村', 171195: '東吳大學(錢穆故居)', 171196: '東吳大學',
  171164: '東吳大學(錢穆故居)', 171165: '梅林新村', 171166: '雙溪公園', 171167: '泰北中學', 171168: '士林官邸(中正)',
  171169: '福林國小', 171170: '捷運士林站(中正)', 171171: '士林國中', 171172: '士林區行政中心(中正)',
  199583: '士林高商', 199584: '國立科教館', 199585: '天文科學館',
};
// 記「網站預估幾分鐘到」的站：往東吳的士林站（上學）、往天文館的錢穆故居（放學）
const DYNA_ETA_STOPS = { 171189: '往東吳｜捷運士林站(中正)', 171164: '往捷運站｜東吳大學(錢穆故居)' };

const DYNA_EVENT_HEAD = ['記錄時間', '車牌', '方向', '站代號', '站名', '到站/離站', '發生時間', '擁擠等級', '車上人數'];
const DYNA_ETA_HEAD = ['記錄時間', '站', '預估秒數', '最近那台車', '網站更新時間'];
const CROWD_NAME = { 1: '舒適', 2: '中等', 3: '擁擠' };

/** 每分鐘由排程呼叫 */
function 記錄557動態() {
  const now = cpNow_(); // 共乘.gs：測試時可以換成假時鐘
  const hm = Utilities.formatDate(now, TZ, 'HH:mm');
  if (hm < DYNA_HOURS[0] || hm > DYNA_HOURS[1]) return;
  if (tooSoon_('記錄557動態', 50)) return; // 公開網頁也呼叫得到（Code.gs），擋掉連續呼叫
  let data;
  try {
    const res = UrlFetchApp.fetch(DYNA_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) return console.error('557 動態網站回 ' + res.getResponseCode());
    data = JSON.parse(res.getContentText());
  } catch (err) {
    return console.error('557 動態抓不到：' + err);
  }
  const parsed = dynaParse_(data, now);
  dynaSaveEvents_(parsed.events, now);
  dynaAppend_('557預估紀錄', DYNA_ETA_HEAD, parsed.etas.map(e => [now].concat(e)));
}

/** 一次寫多列（比一列一列 appendRow 快很多） */
function dynaAppend_(name, head, rows) {
  if (!rows.length) return;
  const sheet = cpSheet_(name, head);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, head.length).setValues(rows);
}

/** 把網站的 JSON 整理成「每台車現在的狀態」和「兩個站的預估秒數」 */
function dynaParse_(data, now) {
  const stale = now.getTime() - DYNA_STALE_MIN * 60000;
  const events = [];
  const nums = {};
  (data.Bus || []).forEach(bus => {
    nums[bus.id] = bus.num;
    if (!bus.a2 || /^TEST/.test(bus.num)) return;
    const a2 = bus.a2.split(',');
    if (a2[3] === '2' || a2[4] === '99') return; // 網頁也跳過這兩種（非營運、異常）
    const at = dynaTime_(a2[11]);
    if (!at || at.getTime() < stale || !DYNA_STOPS[a2[7]]) return;
    let level = '';
    let riders = '';
    if (bus.a3) {
      const a3 = bus.a3.split(',');
      const t = dynaTime_(a3[7]);
      if (t && t.getTime() >= stale) {
        riders = Number(a3[5]);
        level = Number(a3[6]) > 0 ? Number(a3[6]) : (riders > 32 ? 3 : riders > 22 ? 2 : 1); // 網頁的換算方式
      }
    }
    events.push({ bus: bus.num, dir: a2[6] === '0' ? '往東吳' : '往天文館', stop: a2[7], arrived: a2[8] === '1', at: at, level: level, riders: riders });
  });
  const etas = [];
  (data.Stop || []).forEach(s => {
    if (!s.n1) return;
    const n1 = s.n1.split(',');
    if (!DYNA_ETA_STOPS[n1[1]]) return;
    etas.push([DYNA_ETA_STOPS[n1[1]], Number(n1[7]), nums[n1[3]] || '', String(data.UpdateTime || '').replace(/&#x3a;/g, ':')]);
  });
  return { events: events, etas: etas };
}

/** 只記「跟上次不一樣」的狀態：上次記到哪台車在哪站、到或離，存在快取 */
function dynaSaveEvents_(events, now) {
  const cache = CacheService.getScriptCache();
  const last = JSON.parse(cache.get('dyna_last') || '{}');
  const rows = [];
  events.forEach(e => {
    const key = [e.stop, e.arrived ? 1 : 0, e.at.getTime()].join('|');
    if (last[e.bus] === key) return;
    last[e.bus] = key;
    rows.push([now, e.bus, e.dir, e.stop, DYNA_STOPS[e.stop], e.arrived ? '到站' : '離站', e.at, CROWD_NAME[e.level] || '', e.riders]);
  });
  cache.put('dyna_last', JSON.stringify(last), 6 * 3600);
  dynaAppend_('557動態紀錄', DYNA_EVENT_HEAD, rows);
}

/** 網站的時間格式 yyMMddHHmmss（臺北時間）→ Date */
function dynaTime_(s) {
  if (!/^\d{12}$/.test(s || '')) return null;
  return new Date('20' + s.slice(0, 2) + '-' + s.slice(2, 4) + '-' + s.slice(4, 6) + 'T' + s.slice(6, 8) + ':' + s.slice(8, 10) + ':' + s.slice(10, 12) + '+08:00');
}

// ===== 在編輯器裡手動執行 =====

/** 執行一次就好：每分鐘記錄 557 動態 */
function 設定557紀錄排程() {
  if (tooSoon_('設定557紀錄排程', 60)) return;
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === '記錄557動態')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('記錄557動態').timeBased().everyMinutes(1).create();
  cpSheet_('557動態紀錄', DYNA_EVENT_HEAD);
  cpSheet_('557預估紀錄', DYNA_ETA_HEAD);
  console.log('✅ 已設定：' + DYNA_HOURS.join('–') + ' 每分鐘記錄一次 557 動態');
}
