/**
 * 每日報表（模組六）：每天晚上把當天的紀錄整理成一封信，寄給德育中心和軍訓室
 *
 * 內容：多少人用 Bot、問了什麼、比較器被問的上課時段、共乘成團數、步行／騎車／早到、
 *       少排放的碳，加上 Gemini 寫的三行摘要（沒有金鑰或額度用完就用固定句子）。
 * 收件人放在指令碼屬性 REPORT_EMAILS（逗號分隔）；沒設定就只記在「每日報表」分頁、不寄信。
 * 每一天的數字都會存一列在「每日報表」分頁，之後做簡報的圖表直接用。
 *
 * 第一次使用：在編輯器執行一次「設定每日報表排程」。
 * 目前沒有「現場排隊人數」：報表只有學生的選擇和打卡紀錄（PDF 的待確認事項）。
 * 用到 Code.gs 的 PROPS、TZ、tooSoon_，站位變更.gs 的 gemini_，共乘.gs 的 cpSheet_。
 */
const REPORT_HOUR = 22;
const REPORT_HEAD = ['日期', '使用人數', '訊息數', '比較器次數', '共乘成團', '共乘人次', '獨行', '步行', '騎車', '早到',
  '新訂閱', '少排放（公克）', '最多人問的上課時間', '摘要'];

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
  const onDay = (name, col) => rptRows_(name).filter(r => {
    const at = r[col] ? new Date(r[col]) : null; // 空白格、不是日期的格子都跳過
    return at && !isNaN(at) && Utilities.formatDate(at, TZ, 'yyyy-MM-dd') === date;
  });
  const messages = onDay('訊息紀錄', 0).filter(r => r[1] && r[1] !== '測試');
  const compares = onDay('比較器紀錄', 0);
  const carpool = onDay('共乘紀錄', 0);
  const trips = onDay('通勤紀錄', 0);
  const subs = onDay('訂閱', 2).filter(r => r[1] === '訂閱中');

  const count = (rows, col, value) => rows.filter(r => r[col] === value).length;
  const groups = {};
  carpool.filter(r => r[5] === '上車').forEach(r => { groups[r[1]] = 1; });
  // 比較器最常被問的上課時間（例如 08:10）
  const classTimes = {};
  compares.forEach(r => { const t = String(r[4] || '').slice(-5); if (/^\d{2}:\d{2}$/.test(t)) classTimes[t] = (classTimes[t] || 0) + 1; });
  const topTime = Object.keys(classTimes).sort((a, b) => classTimes[b] - classTimes[a])[0] || '';

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
    topTime: topTime,
  };
  report.summary = reportSummary_(report);
  return report;
}

function reportSummary_(r) {
  const fallback = [
    r.date + ' 共 ' + r.users + ' 位同學使用 Bot，問了 ' + r.messages + ' 則訊息，其中 ' + r.compares + ' 次是比較路線。',
    '557 以外的選擇：步行 ' + r.walk + ' 次、騎車 ' + r.bike + ' 次、共乘 ' + r.carpoolRiders + ' 人次（' + r.carpoolGroups + ' 團）。',
    r.topTime ? '最多人問的上課時間是 ' + r.topTime + '，這個時段前的班次需求最高。' : '今天沒有比較器的上課時間紀錄。',
  ].join('\n');
  if (r.messages === 0) return fallback; // 沒有資料就不用花 Gemini 額度
  const text = gemini_('以下是東吳大學外雙溪校區「557 通勤平台」今天的使用統計。請用繁體中文寫三行摘要給學校的德育中心與軍訓室：'
    + '每行一句、要提到數字，第三行給一個具體建議。只根據下面的數字寫，不要推測沒有的資料。不要標題、不要 Markdown。\n' + JSON.stringify(r));
  return text ? text.trim() : fallback;
}

function reportItems_(r) {
  return [
    ['使用 Bot 的同學', r.users + ' 人'], ['訊息', r.messages + ' 則'], ['比較路線', r.compares + ' 次'],
    ['最多人問的上課時間', r.topTime || '—'],
    ['共乘', r.carpoolRiders + ' 人次（' + r.carpoolGroups + ' 團）'], ['一個人也出發（獨行）', r.solo + ' 次'],
    ['步行（錢穆故居站 ↔ 校內）', r.walk + ' 次'], ['騎 YouBike（到校＋回士林）', r.bike + ' 次'], ['7:30 前到校', r.early + ' 次'],
    ['新訂閱提醒', r.newSubs + ' 人'], ['少排放', (r.co2 / 1000).toFixed(2) + ' 公斤 CO₂'],
  ];
}

function reportText_(r) {
  return ['557 通勤平台每日報表 ' + r.date, '', r.summary, ''].concat(reportItems_(r).map(i => i[0] + '：' + i[1]))
    .concat(['', '這份報表只包含學生在 Bot 裡的選擇和打卡紀錄，不含現場排隊人數。']).join('\n');
}

function reportHtml_(r) {
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return '<div style="font-family:sans-serif;line-height:1.7;max-width:560px">'
    + '<h2 style="margin:0 0 8px">557 通勤平台每日報表 ' + r.date + '</h2>'
    + '<p>' + esc(r.summary).replace(/\n/g, '<br>') + '</p>'
    + '<table style="border-collapse:collapse;width:100%">'
    + reportItems_(r).map(i => '<tr><td style="border-top:1px solid #ddd;padding:6px 0">' + esc(i[0]) + '</td><td style="border-top:1px solid #ddd;padding:6px 0;text-align:right">' + esc(i[1]) + '</td></tr>').join('')
    + '</table><p style="color:#667085;font-size:13px">這份報表只包含學生在 Bot 裡的選擇和打卡紀錄，不含現場排隊人數。</p></div>';
}

function saveReport_(r) {
  cpSheet_('每日報表', REPORT_HEAD).appendRow([r.date, r.users, r.messages, r.compares, r.carpoolGroups, r.carpoolRiders, r.solo,
    r.walk, r.bike, r.early, r.newSubs, Math.round(r.co2), r.topTime, r.summary]);
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
