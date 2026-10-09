/**
 * 東吳通勤達人 LINE Bot
 * 功能：557 即時到站、降雨機率、多路線比較器（比較器.gs）、晚上提醒（晚上提醒.gs）、
 *       站位變更推播（站位變更.gs）、所有訊息記錄到試算表
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
  '・「訂閱提醒」：明天下雨、考試週、站牌搬家，都會提醒你',
  '',
  '也可以直接點下面的按鈕 👇',
].join('\n');

const QUICK_REPLY = {
  items: [
    '幫我比較路線',
    '557 去學校',
    '557 回家',
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
  if (ev.type !== 'message' || ev.message.type !== 'text') return;

  const text = ev.message.text.trim();
  let answer;
  try {
    if (/^(訂閱提醒|取消提醒)$/.test(text)) {
      answer = subscribe_(ev.source.userId, text === '訂閱提醒'); // 晚上提醒.gs
    } else {
      answer = route_(text);
    }
  } catch (err) {
    console.error(err);
    answer = '抱歉，資料暫時抓不到，等一下再試一次 🙏';
  }
  reply_(ev.replyToken, answer);
  log_(ev, text, answer);
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

function reply_(replyToken, text) {
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
    payload: JSON.stringify({
      replyToken: replyToken,
      messages: [{ type: 'text', text: text, quickReply: QUICK_REPLY }],
    }),
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
  sheet.appendRow([new Date(), ev.source && ev.source.userId, userText, botText]);
}

function nowText_() {
  return Utilities.formatDate(new Date(), TZ, 'HH:mm');
}

// ===== 在編輯器裡手動執行，確認金鑰和資料都正常 =====

function 測試() {
  console.log(route_('557'));
  console.log(route_('回家'));
  console.log(route_('天氣'));
  log_({ source: { userId: '測試' } }, '測試', '測試成功');
}
