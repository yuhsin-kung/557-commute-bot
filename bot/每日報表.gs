/**
 * 每日報表（模組六）：每天晚上把當天的紀錄整理成一封信，寄給德育中心和軍訓室
 *
 * 11/29 改成「學校拿來做決定的資料」（初賽評審 A 的建議），分六塊：
 *   1. 557 擠不擠：557動態紀錄（到站紀錄.gs 每分鐘記）→ 照團隊的排隊規則算今天有幾班要排、最擠的 15 分鐘、最多一班幾人
 *   2. 各站排隊回報：現場回報 → 每站、每 30 分鐘幾人回報在排
 *   3. 學生查詢的需求：預估紀錄＋比較器紀錄 → 查了幾次、最多人要趕第幾節、最多人幾點到站牌
 *   4. 折價券花費：學餐折價券 → 今天兌換、本月累計張數和金額、已使用
 *   5. 打卡防弊：打卡紀錄 → 成功幾次、被擋幾次、各被擋原因（只列次數，不列人）
 *   6. 跟上週同一天比：每日報表分頁裡 7 天前那一列
 * 加上 Gemini 寫的三行摘要（第三行建議根據排隊資料寫；沒有金鑰或額度用完就用固定句子）。
 * 收件人放在指令碼屬性 REPORT_EMAILS（逗號分隔）；沒設定就只記在「每日報表」分頁、不寄信。
 * 每一天的數字都會存一列在「每日報表」分頁，決賽簡報的圖表直接用。報表只有總數，不列任何學生的帳號。
 *
 * 第一次使用：在編輯器執行一次「設定每日報表排程」。557 擠不擠要先執行過「設定557紀錄排程」（到站紀錄.gs）。
 * 用到 Code.gs 的 PROPS、TZ、tooSoon_，站位變更.gs 的 gemini_，共乘.gs 的 cpSheet_。
 */
const REPORT_HOUR = 22;
// 舊的欄位順序不動，新欄位接在後面（舊的列一樣讀得到）
const REPORT_HEAD = ['日期', '使用人數', '訊息數', '比較器次數', '共乘成團', '共乘人次', '獨行', '步行', '騎車', '早到',
  '新訂閱', '少排放（公克）', '最多人問的上課時間', '摘要',
  '557 往東吳班次', '士林站要排班次', '士林國中要排班次', '回程要排班次', '最擠的 15 分鐘', '往東吳最多一班幾人', '回程最多一班幾人',
  '排隊回報人次', '排隊回報最多的時段', '預估查詢次數', '最多人幾點到站牌',
  '今天兌換折價券', '本月兌換張數', '本月兌換金額', '本月已使用張數',
  '打卡成功', '打卡被擋', '被擋原因'];
const RPT_QUEUE_MRT_RIDERS = 60;  // 往東吳：離開國中不是紅色時，離開士林站 60 人以上才算要排（團隊 11/28 定）
const RPT_QUEUE_BACK_RIDERS = 59; // 回程：離開東吳 59 人以上，連續 k 台前 k−1 台要排（團隊 11/28 定）
const RPT_STOP = { 士林國中: '171188', 士林站: '171189', 東吳: '171164' }; // 557動態紀錄的站代號（到站紀錄.gs 的 DYNA_STOPS）
// 打卡紀錄「結果」欄 → 報表上的被擋原因
const RPT_BLOCK = { 誤差太大: '定位不夠準', 不在打卡點: '不在打卡點', 沒加分: '時間不符（走太快／太慢／超過 07:30）', 定位重複: '兩次定位相同', 定位太舊: '定位太舊', 沒有第一次: '沒打第一次', 太晚: '時間不符（走太快／太慢／超過 07:30）' };

// ===== 排程每晚執行 =====

function 每日報表() {
  // 一天只寄一次：這個函式公開網頁也呼叫得到（見 Code.gs 的 tooSoon_）
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (PROPS.getProperty('REPORT_LAST_DAY') === today) return;
  PROPS.setProperty('REPORT_LAST_DAY', today);
  const report = buildReport_(new Date());
  saveReport_(report);
  const to = PROPS.getProperty('REPORT_EMAILS');
  if (to) {
    MailApp.sendEmail({ to: to, name: '東吳通勤達人', subject: '557 通勤平台每日報表 ' + report.date, body: reportText_(report), htmlBody: reportHtml_(report) });
  }
}

/** 整理某一天的數字 */
function buildReport_(day) {
  const date = Utilities.formatDate(day, TZ, 'yyyy-MM-dd');
  const isDay = v => { const at = v ? new Date(v) : null; return at && !isNaN(at) && Utilities.formatDate(at, TZ, 'yyyy-MM-dd') === date; };
  const onDay = (name, col) => rptRows_(name).filter(r => isDay(r[col])); // 空白格、不是日期的格子都跳過
  const messages = onDay('訊息紀錄', 0).filter(r => r[1] && r[1] !== '測試');
  const compares = onDay('比較器紀錄', 0);
  const carpool = onDay('共乘紀錄', 0);
  const trips = onDay('通勤紀錄', 0);
  const subs = onDay('訂閱', 2).filter(r => r[1] === '訂閱中');
  const etaLogs = onDay('預估紀錄', 0).filter(r => !r[1]); // 測試模式的不算

  const count = (rows, col, value) => rows.filter(r => r[col] === value).length;
  const groups = {};
  carpool.filter(r => r[5] === '上車').forEach(r => { groups[r[1]] = 1; });
  // 最多人問的上課時間（例如 08:10）：比較器（出發時間規劃）＋預估紀錄（從位置倒推）
  const classTimes = {};
  compares.map(r => r[4]).concat(etaLogs.map(r => r[3])).forEach(v => { const t = String(v || '').slice(-5); if (/^\d{2}:\d{2}$/.test(t)) classTimes[t] = (classTimes[t] || 0) + 1; });

  const report = {
    date: date,
    users: Object.keys(messages.reduce((set, r) => { set[r[1]] = 1; return set; }, {})).length,
    messages: messages.length,
    compares: compares.length,
    carpoolGroups: Object.keys(groups).length,
    carpoolRiders: count(carpool, 5, '上車'),
    solo: count(carpool, 5, '獨行'),
    walk: count(trips, 2, '步行') + count(trips, 2, '步行出校'),
    bike: count(trips, 2, '騎車') + count(trips, 2, '騎車出校'),
    early: count(trips, 2, '早到'),
    newSubs: subs.length,
    co2: trips.reduce((sum, r) => sum + (Number(r[4]) || 0), 0),
    topTime: rptTop_(classTimes),
  };
  Object.assign(report, rptBus_(rptRows_('557動態紀錄').filter(r => r[5] === '離站' && isDay(r[6]))));
  Object.assign(report, rptQueueReports_(onDay('現場回報', 0)));
  Object.assign(report, rptDemand_(etaLogs));
  Object.assign(report, rptCoupons_(rptRows_('學餐折價券'), day));
  Object.assign(report, rptCheckins_(onDay('打卡紀錄', 0)));
  report.lastWeek = rptLastWeek_(day);
  report.summary = reportSummary_(report);
  return report;
}

/** 次數最多的那一個（同次數取先出現的）；沒有就空字串 */
function rptTop_(counts) {
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || '';
}

/** 「09:37」→「09:30–10:00」（size 分鐘一段） */
function rptSlot_(at, size) {
  const m = Number(Utilities.formatDate(at, TZ, 'H')) * 60 + Number(Utilities.formatDate(at, TZ, 'm'));
  const s = Math.floor(m / size) * size;
  const hm = x => ('0' + Math.floor(x / 60)).slice(-2) + ':' + ('0' + (x % 60)).slice(-2);
  return hm(s) + '–' + hm(s + size);
}

/**
 * 1. 557 擠不擠（團隊 11/28 的規則，到校時間預測.md「尖峰的定義：要排隊才算」）
 *   士林國中：離開國中是紅色（擁擠）而且下一台也是紅色 → 要排（連續 k 台紅色，前 k−1 台要排）
 *   捷運士林站：這台離開國中是紅色，或離開士林站 60 人以上 → 要排
 *   回程：離開東吳 59 人以上而且下一台也是 → 要排
 * departures 是 557動態紀錄裡當天「離站」的列
 */
function rptBus_(departures) {
  const dep = departures.map(r => ({ bus: r[1], stop: String(r[3]), at: new Date(r[6]), red: r[7] === '擁擠', riders: Number(r[8]) || 0 }));
  const at = id => dep.filter(d => d.stop === id).sort((a, b) => a.at - b.at);
  const zh = at(RPT_STOP.士林國中), mrt = at(RPT_STOP.士林站), back = at(RPT_STOP.東吳);
  const chain = (list, full) => list.filter((d, i) => full(d) && list[i + 1] && full(list[i + 1]));
  const zhQueue = chain(zh, d => d.red);
  const zhOf = d => zh.filter(z => z.bus === d.bus && d.at - z.at >= 0 && d.at - z.at <= 15 * 60000).pop(); // 同一台車、15 分鐘內離開國中
  const mrtQueue = mrt.filter(d => { const z = zhOf(d); return (z && z.red) || d.riders >= RPT_QUEUE_MRT_RIDERS; });
  const backQueue = chain(back, d => d.riders >= RPT_QUEUE_BACK_RIDERS);
  // 最擠的 15 分鐘：要排的班次最多的那段；都不用排就看離開士林站人數最多的那班
  const slots = {};
  zhQueue.concat(mrtQueue, backQueue).forEach(d => { const s = rptSlot_(d.at, 15); slots[s] = (slots[s] || 0) + 1; });
  const most = mrt.slice().sort((a, b) => b.riders - a.riders)[0];
  return {
    busTrips: mrt.length,
    mrtQueue: mrtQueue.length,
    zhQueue: zhQueue.length,
    backQueue: backQueue.length,
    busySlot: rptTop_(slots) || (most && most.riders ? rptSlot_(most.at, 15) : ''),
    maxToSchool: mrt.reduce((m, d) => Math.max(m, d.riders), 0),
    maxBack: back.reduce((m, d) => Math.max(m, d.riders), 0),
  };
}

/** 2. 各站排隊回報：每站人次、回報最多的 30 分鐘（例：09:30–10:00 捷運士林站 12 人） */
function rptQueueReports_(rows) {
  const byStop = {}, bySlot = {};
  rows.forEach(r => {
    const stop = String(r[2] || '');
    byStop[stop] = (byStop[stop] || 0) + 1;
    const key = rptSlot_(new Date(r[0]), 30) + ' ' + stop;
    bySlot[key] = (bySlot[key] || 0) + 1;
  });
  const top = rptTop_(bySlot);
  return {
    queueReports: rows.length,
    queueByStop: Object.keys(byStop).map(k => k + ' ' + byStop[k] + ' 人').join('、'),
    queueTop: top ? top + ' ' + bySlot[top] + ' 人' : '',
  };
}

/** 3. 學生查詢的需求：預估到達時間、出發時間規劃查了幾次，最多人幾點到站牌（30 分鐘一段） */
function rptDemand_(etaLogs) {
  const slots = {};
  etaLogs.forEach(r => {
    const m = String(r[4] || '').match(/到站牌 (\d{4}-\d\d-\d\d \d\d:\d\d)/);
    if (m) { const s = rptSlot_(new Date(m[1].replace(' ', 'T') + ':00+08:00'), 30); slots[s] = (slots[s] || 0) + 1; }
  });
  return { etaQueries: etaLogs.length, topArrive: rptTop_(slots) };
}

/** 4. 折價券花費：今天兌換、本月累計（兌換張數、金額）、本月兌換的已經用掉幾張 */
function rptCoupons_(rows, day) {
  const fmt = (v, p) => { const at = v ? new Date(v) : null; return at && !isNaN(at) ? Utilities.formatDate(at, TZ, p) : ''; };
  const today = Utilities.formatDate(day, TZ, 'yyyy-MM-dd'), month = Utilities.formatDate(day, TZ, 'yyyy-MM');
  const inMonth = rows.filter(r => fmt(r[0], 'yyyy-MM') === month && fmt(r[0], 'yyyy-MM-dd') <= today);
  return {
    couponsToday: rows.filter(r => fmt(r[0], 'yyyy-MM-dd') === today).length,
    couponsMonth: inMonth.length,
    couponsMonthValue: inMonth.reduce((s, r) => s + (Number(r[3]) || 0), 0),
    couponsMonthUsed: inMonth.filter(r => r[4] && r[4] !== '未使用').length,
  };
}

/** 5. 打卡防弊：加分幾次、被擋幾次和原因（第一次打卡成功、今天拿過了不算被擋） */
function rptCheckins_(rows) {
  const why = {};
  let blocked = 0;
  rows.forEach(r => {
    const reason = RPT_BLOCK[r[5]];
    if (!reason) return;
    blocked++;
    why[reason] = (why[reason] || 0) + 1;
  });
  return {
    checkinOk: rows.filter(r => r[5] === '加分').length,
    checkinBlocked: blocked,
    blockReasons: Object.keys(why).sort((a, b) => why[b] - why[a]).map(k => k + ' ' + why[k]).join('、'),
  };
}

/** 6. 上週同一天：每日報表分頁裡 7 天前那一列（照欄位名稱取，舊的列沒有的欄位就是空的）；沒有就 null */
function rptLastWeek_(day) {
  const date = Utilities.formatDate(new Date(day.getTime() - 7 * 86400000), TZ, 'yyyy-MM-dd');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('每日報表');
  if (!sheet) return null;
  const all = sheet.getDataRange().getValues();
  const head = all[0].map(String);
  const row = all.slice(1).filter(r => {
    const v = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]);
    return v === date;
  }).pop();
  if (!row) return null;
  const out = {};
  head.forEach((h, i) => { out[h] = row[i]; });
  return out;
}

function reportSummary_(r) {
  const fallback = [
    r.date + ' 共 ' + r.users + ' 位同學使用 Bot，問了 ' + r.messages + ' 則訊息，預估到達時間查了 ' + r.etaQueries + ' 次。',
    r.busTrips ? '557 往東吳 ' + r.busTrips + ' 班，士林站要排隊 ' + r.mrtQueue + ' 班、士林國中 ' + r.zhQueue + ' 班、回程 ' + r.backQueue + ' 班' + (r.busySlot ? '，最擠的是 ' + r.busySlot : '') + '。'
      : '今天沒有 557 動態紀錄（要先執行「設定557紀錄排程」）。',
    r.mrtQueue + r.zhQueue > 0 && r.busySlot
      ? '建議在 ' + r.busySlot + ' 前宣導改到士林國中站排隊，或請公車處在這個時段加班。'
      : (r.queueTop ? '排隊回報最多的是 ' + r.queueTop + '，可以留意這個時段的站牌秩序。' : '今天沒有需要特別處理的排隊時段。'),
  ].join('\n');
  if (r.messages === 0 && !r.busTrips) return fallback; // 沒有資料就不用花 Gemini 額度
  const data = Object.assign({}, r);
  delete data.summary;
  delete data.lastWeek;
  const text = gemini_('以下是東吳大學外雙溪校區「557 通勤平台」今天的統計（JSON）。請用繁體中文寫三行摘要給學校的德育中心與軍訓室：'
    + '每行一句、要提到數字。第一行講使用情況，第二行講 557 哪個時段要排隊（mrtQueue 士林站、zhQueue 士林國中、backQueue 回程要排的班次，busySlot 最擠的 15 分鐘，queueTop 排隊回報最多的時段），'
    + '第三行根據排隊資料給學校一個具體可以做的建議（例如哪個時段宣導改去士林國中排、請公車處加班、派人維持秩序）。'
    + '只根據下面的數字寫，不要推測沒有的資料；數字是 0 或空的就說沒有。不要標題、不要 Markdown。\n' + JSON.stringify(data));
  return text ? text.trim() : fallback;
}

/** 報表上一項一項的數字，分成六塊：[區塊標題, [[項目, 數字, 上週同一天（可省略）], …]] */
function reportSections_(r) {
  const lw = (name, unit) => (r.lastWeek && r.lastWeek[name] !== '' && r.lastWeek[name] !== undefined ? '上週 ' + r.lastWeek[name] + (unit || '') : '');
  return [
    ['557 擠不擠（團隊的排隊規則）', r.busTrips ? [
      ['往東吳班次', r.busTrips + ' 班', lw('557 往東吳班次', ' 班')],
      ['捷運士林站要排隊', r.mrtQueue + ' 班', lw('士林站要排班次', ' 班')],
      ['士林國中要排隊', r.zhQueue + ' 班', lw('士林國中要排班次', ' 班')],
      ['回程（東吳上車）要排隊', r.backQueue + ' 班', lw('回程要排班次', ' 班')],
      ['最擠的 15 分鐘', r.busySlot || '—'],
      ['最多一班幾人（往東吳／回程）', r.maxToSchool + ' 人／' + r.maxBack + ' 人'],
    ] : [['今天沒有 557 動態紀錄', '要先執行「設定557紀錄排程」']]],
    ['各站排隊回報（學生自己按的）', [
      ['回報人次', r.queueReports + ' 人次', lw('排隊回報人次', ' 人次')],
      ['各站', r.queueByStop || '—'],
      ['回報最多的時段', r.queueTop || '—'],
    ]],
    ['學生查詢的需求', [
      ['使用 Bot 的同學', r.users + ' 人', lw('使用人數', ' 人')],
      ['訊息', r.messages + ' 則', lw('訊息數', ' 則')],
      ['預估到達時間、出發時間規劃', r.etaQueries + ' 次', lw('預估查詢次數', ' 次')],
      ['比較路線', r.compares + ' 次', lw('比較器次數', ' 次')],
      ['最多人要趕的上課時間', r.topTime || '—'],
      ['最多人幾點到站牌', r.topArrive || '—'],
    ]],
    ['557 以外的選擇與減碳', [
      ['共乘', r.carpoolRiders + ' 人次（' + r.carpoolGroups + ' 團）', lw('共乘人次', ' 人次')],
      ['一個人也出發（獨行）', r.solo + ' 次'],
      ['步行（錢穆故居站 ↔ 校內）', r.walk + ' 次', lw('步行', ' 次')],
      ['騎 YouBike（到校＋回士林）', r.bike + ' 次', lw('騎車', ' 次')],
      ['7:30 前到校', r.early + ' 次', lw('早到', ' 次')],
      ['新訂閱提醒', r.newSubs + ' 人'],
      ['少排放', (r.co2 / 1000).toFixed(2) + ' 公斤 CO₂'],
    ]],
    ['學餐折價券花費', [
      ['今天兌換', r.couponsToday + ' 張'],
      ['本月兌換', r.couponsMonth + ' 張，' + r.couponsMonthValue + ' 元'],
      ['本月兌換的已使用', r.couponsMonthUsed + ' 張'],
    ]],
    ['打卡防弊（只列次數）', [
      ['打卡成功拿到點', r.checkinOk + ' 次', lw('打卡成功', ' 次')],
      ['被擋下來', r.checkinBlocked + ' 次', lw('打卡被擋', ' 次')],
      ['被擋原因', r.blockReasons || '—'],
    ]],
  ];
}

const REPORT_NOTE = '這份報表只有總數，不列任何學生的帳號。557 擠不擠是用公車動態網站的擁擠顏色和車上人數，照團隊的排隊規則推算；排隊回報只算有按的同學。';

function reportText_(r) {
  const lines = ['557 通勤平台每日報表 ' + r.date, '', r.summary];
  reportSections_(r).forEach(([title, items]) => {
    lines.push('', '【' + title + '】');
    items.forEach(i => lines.push(i[0] + '：' + i[1] + (i[2] ? '（' + i[2] + '）' : '')));
  });
  return lines.concat(['', REPORT_NOTE]).join('\n');
}

function reportHtml_(r) {
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const td = 'border-top:1px solid #ddd;padding:6px 0';
  return '<div style="font-family:sans-serif;line-height:1.7;max-width:600px">'
    + '<h2 style="margin:0 0 8px">557 通勤平台每日報表 ' + r.date + '</h2>'
    + '<p style="background:#FBF1EE;border-radius:8px;padding:10px 12px">' + esc(r.summary).replace(/\n/g, '<br>') + '</p>'
    + reportSections_(r).map(([title, items]) => '<h3 style="margin:18px 0 4px;color:#A63A2B">' + esc(title) + '</h3><table style="border-collapse:collapse;width:100%">'
      + items.map(i => '<tr><td style="' + td + '">' + esc(i[0]) + '</td><td style="' + td + ';text-align:right">' + esc(i[1])
        + (i[2] ? '<br><span style="color:#667085;font-size:12px">' + esc(i[2]) + '</span>' : '') + '</td></tr>').join('') + '</table>').join('')
    + '<p style="color:#667085;font-size:13px">' + esc(REPORT_NOTE) + '</p></div>';
}

function saveReport_(r) {
  const sheet = cpSheet_('每日報表', REPORT_HEAD);
  // 舊的分頁標題只有前 14 欄：補上新欄位的標題（舊的列不動）
  if ((sheet.getDataRange().getValues()[0] || []).length < REPORT_HEAD.length) sheet.getRange(1, 1, 1, REPORT_HEAD.length).setValues([REPORT_HEAD]);
  sheet.appendRow([r.date, r.users, r.messages, r.compares, r.carpoolGroups, r.carpoolRiders, r.solo,
    r.walk, r.bike, r.early, r.newSubs, Math.round(r.co2), r.topTime, r.summary,
    r.busTrips, r.mrtQueue, r.zhQueue, r.backQueue, r.busySlot, r.maxToSchool, r.maxBack,
    r.queueReports, r.queueTop, r.etaQueries, r.topArrive,
    r.couponsToday, r.couponsMonth, r.couponsMonthValue, r.couponsMonthUsed,
    r.checkinOk, r.checkinBlocked, r.blockReasons]);
}

/** 讀一個分頁的資料列；分頁還沒建立就當作沒有資料（不要為了報表去建空的分頁） */
function rptRows_(name) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  return sheet ? sheet.getDataRange().getValues().slice(1) : [];
}

// ===== 在編輯器裡手動執行 =====

/** 執行一次就好：每晚 22 點寄報表 */
function 設定每日報表排程() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === '每日報表')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('每日報表').timeBased().atHour(REPORT_HOUR).everyDays(1).inTimezone(TZ).create();
  console.log('排程設好了：每晚 ' + REPORT_HOUR + ' 點寄每日報表。');
}

/** 只印出今天的報表，不寄信、不存檔 */
function 測試每日報表() {
  if (tooSoon_('測試每日報表', 60)) return; // Code.gs：公開網頁也呼叫得到，一分鐘只跑一次
  console.log(reportText_(buildReport_(new Date())));
}
