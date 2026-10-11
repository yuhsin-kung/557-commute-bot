/**
 * 東吳通勤達人 LINE Bot
 * 功能：557 即時到站、降雨機率、多路線比較器（比較器.gs）、晚上提醒（晚上提醒.gs）、
 *       站位變更推播（站位變更.gs）、計程車共乘（共乘.gs、等車室.gs）、所有訊息記錄到試算表
 *
 * 金鑰放在「專案設定 → 指令碼屬性」，不要寫在程式碼裡：
 *   TDX_CLIENT_ID / TDX_CLIENT_SECRET / CWA_API_KEY / LINE_CHANNEL_ACCESS_TOKEN / GEMINI_API_KEY
 */
const PROPS = PropertiesService.getScriptProperties();
const TZ = 'Asia/Taipei';

const HELP = [
  '嗨！我是東吳通勤達人 🚌',
  '',
  '你可以問我：',
  '・「557」：士林站往東吳的下一班車',
  '・「回家」：東吳往士林的下一班車',
  '・「天氣」：上學時段會不會下雨',
  '・「8 點在 D 棟上課」：幫你比較 557 和其他路線，算幾點出門',
  '・「我從劍南路站出發，第三節在一教」：文湖線的同學也可以問',
  '・「557 在哪裡搭」：最新的上車站牌和排隊方式',
  '・「共乘」：找同學一起搭計程車，可以現在走或預約',
  '・「打卡」：從錢穆故居站走進學校拿積分，7:30 前到校有早餐券',
  '・「我的紀錄」：積分、成就、少排放多少碳',
  '・「YouBike」「共享雨傘」「新生教學」「包車」',
  '・「訂閱提醒」：明天下雨、考試週、站牌搬家，都會提醒你',
  '',
  '也可以直接點下面的按鈕 👇',
].join('\n');

const QUICK_REPLY = {
  items: [
    '幫我比較路線',
    '557 去學校',
    '557 回家',
    '共乘',
    '打卡',
    '我的紀錄',
    '明天會下雨嗎',
    '訂閱提醒',
  ].map(label => ({
    type: 'action',
    action: { type: 'message', label: label, text: label },
  })),
};

const STOP_STATUS = { 1: '尚未發車', 2: '交管不停靠', 3: '末班車已過', 4: '今日未營運' };

// ===== LINE 進來的訊息 =====

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  (body.events || []).forEach(handleEvent_);
  return ContentService.createTextOutput('OK');
}

function handleEvent_(ev) {
  if (ev.type === 'follow') {
    reply_(ev.replyToken, HELP);
    log_(ev, '（加入好友）', HELP);
    return;
  }
  if (ev.type === 'postback') {
    const picked = cpPostback_(ev.source.userId, ev.postback); // 共乘.gs：預約的時間選擇器
    if (picked) {
      reply_(ev.replyToken, picked);
      log_(ev, '（選時間）' + ev.postback.params.datetime, picked);
    }
    return;
  }
  if (ev.type !== 'message' || ev.message.type !== 'text') return;

  const text = ev.message.text.trim();
  let answer;
  try {
    if (/^(共乘|我的共乘|取消共乘)(\s|$)/.test(text)) {
      answer = cpText_(ev.source.userId, text); // 共乘.gs
    } else if (text === '定位測試') {
      answer = geoTestButton_(); // 定位測試.gs（暫時的）
    } else if (/^(訂閱提醒|取消提醒)$/.test(text)) {
      answer = subscribe_(ev.source.userId, text === '訂閱提醒'); // 晚上提醒.gs
    } else {
      // 積分、打卡、YouBike、雨傘、新生、包車：要知道是誰傳的，所以排在 route_ 前面
      answer = memberReply_(ev.source.userId, text) || route_(text);
    }
  } catch (err) {
    console.error(err);
    answer = '抱歉，資料暫時抓不到，等一下再試一次 🙏';
  }
  reply_(ev.replyToken, answer);
  log_(ev, text, answer);
}

/**
 * 模組三、四、五的指令。認得就回覆，不認得回傳 null 交給 route_。
 * 這幾個要比 route_ 先判斷：「借傘」有「傘」字、「排隊禮儀」有「排隊」，不先攔下來會被當成問天氣、問站牌。
 */
function memberReply_(uid, text) {
  if (/^(打卡|到校打卡|步行積分)$/.test(text)) return ptCheckinButton_(uid); // 積分.gs
  if (/^(我的紀錄|我的積分|積分|成就|碳足跡)$/.test(text)) return ptMine_(uid);
  if (text === '全校減碳') return ptSchool_();
  if (text === '騎車到校') return ptBike_(uid);
  if (/^(youbike|ubike|微笑單車|腳踏車)$/i.test(text)) return ybReply_(); // YouBike.gs
  if (/^(借傘|還傘|共享雨傘)(\s|$)/.test(text)) return umText_(uid, text); // 雨傘.gs
  if (text === '新生教學' || text === '新生') return nbIntro_(); // 新生.gs
  if (text === '新生測驗' || /^答\s*[1-3]$/.test(text)) return nbQuiz_(uid, text);
  if (text === '排隊禮儀') return nbEtiquette_();
  if (/^包車(\s|$)/.test(text)) return charterText_(uid, text);
  return null;
}

function route_(text) {
  if (/回家|回程|下課/.test(text)) {
    return busReply_(1, ['東吳大學(錢穆故居)'], '557 東吳 → 士林');
  }
  if (/雨|天氣|傘/.test(text)) {
    return rainReply_();
  }
  if (/站牌|站位|上車(地點|處)|候車|排隊|哪(裡|邊|兒)?(搭|排|上車|等)/.test(text)) {
    return stationReply_(); // 站位變更.gs
  }
  if (text === '幫我比較路線') {
    return liveReply_('士林站', '', null); // 比較器.gs：士林站現在最快的幾班車
  }
  if (/^(557|557 去學校|公車)$/.test(text)) {
    return busReply_(0, ['捷運士林站(中正)', '士林國中'], '557 士林 → 東吳');
  }
  return compareReply_(text); // 其他問題交給比較器（比較器.gs）判斷
}

// ===== 557 即時到站（TDX） =====

function busReply_(direction, stopNames, title) {
  const filter = "RouteName/Zh_tw eq '557' and Direction eq " + direction;
  const etas = tdx_('EstimatedTimeOfArrival/City/Taipei/557?$format=JSON&$filter=' + encodeURIComponent(filter));
  const lines = stopNames.map(name => {
    const hits = etas.filter(e => e.StopName.Zh_tw === name);
    return '📍 ' + name + '\n　' + (hits.length ? hits.map(etaText_).join('、') : '沒有資料');
  });
  return '🚌 ' + title + '\n\n' + lines.join('\n') + '\n\n（TDX 即時資料・' + nowText_() + '）';
}

function etaText_(e) {
  if (e.EstimateTime != null) {
    const min = Math.floor(e.EstimateTime / 60);
    return min <= 1 ? '即將進站' : min + ' 分鐘後到站';
  }
  const status = STOP_STATUS[e.StopStatus] || '沒有資料';
  if (e.StopStatus === 1 && e.NextBusTime) {
    return status + '（下一班約 ' + Utilities.formatDate(new Date(e.NextBusTime), TZ, 'HH:mm') + '）';
  }
  return status;
}

function tdx_(path) {
  const res = UrlFetchApp.fetch('https://tdx.transportdata.tw/api/basic/v2/Bus/' + path, {
    headers: { Authorization: 'Bearer ' + tdxToken_() },
  });
  return JSON.parse(res.getContentText());
}

function tdxToken_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('tdx_token');
  if (cached) return cached;

  const res = UrlFetchApp.fetch('https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token', {
    method: 'post',
    payload: {
      grant_type: 'client_credentials',
      client_id: PROPS.getProperty('TDX_CLIENT_ID'),
      client_secret: PROPS.getProperty('TDX_CLIENT_SECRET'),
    },
  });
  const token = JSON.parse(res.getContentText()).access_token;
  cache.put('tdx_token', token, 6 * 60 * 60); // TDX token 有效 1 天，快取 6 小時
  return token;
}

// ===== 降雨機率（中央氣象署） =====

function rainReply_() {
  const url = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-061'
    + '?Authorization=' + PROPS.getProperty('CWA_API_KEY')
    + '&LocationName=' + encodeURIComponent('士林區')
    + '&ElementName=' + encodeURIComponent('3小時降雨機率');
  const data = JSON.parse(UrlFetchApp.fetch(url).getContentText());
  const times = data.records.Locations[0].Location[0].WeatherElement[0].Time;

  // 早上 9 點前看「今天」上學時段，之後看「明天」
  const now = new Date();
  const isTomorrow = Number(Utilities.formatDate(now, TZ, 'H')) >= 9;
  const target = new Date(now.getTime() + (isTomorrow ? 24 * 60 * 60 * 1000 : 0));
  const day = Utilities.formatDate(target, TZ, 'yyyy-MM-dd');
  const slot = times.find(t => t.StartTime.indexOf(day + 'T06') === 0) || times[0];
  const pop = Number(slot.ElementValue[0].ProbabilityOfPrecipitation);

  let advice;
  if (pop >= 60) advice = '☔ 很可能下雨！557 會比平常擠，建議早 10 分鐘出門、記得帶傘。';
  else if (pop >= 30) advice = '🌥 有機會下雨，帶把傘比較保險。';
  else advice = '☀️ 應該不會下雨，可以考慮從錢穆故居站走進學校 🚶';

  return '🌦 ' + (isTomorrow ? '明天' : '今天') + '早上 6–9 點（士林區）\n'
    + '降雨機率：' + pop + '%\n\n' + advice + '\n\n（中央氣象署・' + nowText_() + '）';
}

// ===== LINE 回覆、紀錄 =====

/** answer 可以是一段文字、一個 LINE 訊息物件，或是它們的陣列（最多 5 則） */
function reply_(replyToken, answer) {
  const messages = (Array.isArray(answer) ? answer : [answer])
    .map(m => (typeof m === 'string' ? { type: 'text', text: m } : m));
  const last = messages[messages.length - 1];
  if (!last.quickReply) last.quickReply = QUICK_REPLY; // 沒有自己的按鈕時，放預設的那一排
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
    payload: JSON.stringify({ replyToken: replyToken, messages: messages }),
  });
}

function log_(ev, userText, botText) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('訊息紀錄');
  if (!sheet) {
    sheet = ss.insertSheet('訊息紀錄');
    sheet.appendRow(['時間', '使用者 ID', '使用者訊息', 'Bot 回覆']);
    sheet.setFrozenRows(1);
  }
  // 共乘的回覆是訊息物件（有按鈕），紀錄裡只留文字
  const shown = typeof botText === 'string' ? botText
    : (Array.isArray(botText) ? botText : [botText]).map(m => (typeof m === 'string' ? m : m.text || m.altText || '')).join('\n');
  sheet.appendRow([new Date(), ev.source && ev.source.userId, userText, shown]);
}

/**
 * 等車室、定位測試是公開網頁，網頁裡的程式可以呼叫這個專案裡任何「名稱不是底線結尾」的函式，
 * 包括只打算在編輯器手動執行的那些。所以：
 *   - 內部用的函式名稱一律用底線結尾（外面呼叫不到）
 *   - 手動執行的函式要嘛重複執行也沒差，要嘛用這個擋住連續執行
 * 回傳 true 代表 seconds 秒內已經執行過，這次應該直接結束。
 */
function tooSoon_(name, seconds) {
  const cache = CacheService.getScriptCache();
  if (cache.get('ran_' + name)) {
    console.log('「' + name + '」' + seconds + ' 秒內執行過了，等一下再試。');
    return true;
  }
  cache.put('ran_' + name, '1', seconds);
  return false;
}

function nowText_() {
  return Utilities.formatDate(new Date(), TZ, 'HH:mm');
}

// ===== 在編輯器裡手動執行，確認金鑰和資料都正常 =====

function 測試() {
  if (tooSoon_('測試', 60)) return; // Code.gs：公開網頁也呼叫得到，一分鐘只跑一次
  console.log(route_('557'));
  console.log(route_('回家'));
  console.log(route_('天氣'));
  log_({ source: { userId: '測試' } }, '測試', '測試成功');
}
