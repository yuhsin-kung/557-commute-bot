// ============================================================================
// 東吳通勤達人 LINE Bot：全部程式碼（16 個檔案合成一個）
//
// 這個檔案是自動產生的，不要直接改。要改請改 bot/ 裡的檔案，再執行 npm run bundle。
// 用法：Apps Script 裡只留一個「程式碼.gs」，把這整份貼進去，其他 .gs 檔全部刪掉。
//       （留著其他檔案會出現「Identifier ... has already been declared」，因為同樣的東西宣告了兩次）
// 包含：Code.gs、YouBike.gs、共乘.gs、卡片.gs、問卷表單.gs、定位測試.gs、新生.gs、晚上提醒.gs、每日報表.gs、比較器.gs、積分.gs、站位變更.gs、等車室.gs、計數表單.gs、選單.gs、雨傘.gs
// ============================================================================

// ============================================================================
// Code.gs
// ============================================================================

/**
 * 東吳通勤達人 LINE Bot
 * 功能：557 即時到站、降雨機率、多路線比較器（比較器.gs）、晚上提醒（晚上提醒.gs）、
 *       站位變更推播（站位變更.gs）、計程車共乘（共乘.gs、等車室.gs）、所有訊息記錄到試算表
 * 回覆的樣子（卡片、配色）在 卡片.gs；主選單和每個功能的按鈕在 選單.gs
 *
 * 金鑰放在「專案設定 → 指令碼屬性」，不要寫在程式碼裡：
 *   TDX_CLIENT_ID / TDX_CLIENT_SECRET / CWA_API_KEY / LINE_CHANNEL_ACCESS_TOKEN / GEMINI_API_KEY
 */
const PROPS = PropertiesService.getScriptProperties();
const TZ = 'Asia/Taipei';

const STOP_STATUS = { 1: '尚未發車', 2: '交管不停靠', 3: '末班車已過', 4: '今日未營運' };

// ===== LINE 進來的訊息 =====

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  (body.events || []).forEach(handleEvent_);
  return ContentService.createTextOutput('OK');
}

function handleEvent_(ev) {
  if (ev.type === 'follow') {
    reply_(ev.replyToken, menuWelcome_()); // 選單.gs
    log_(ev, '（加入好友）', menuWelcome_());
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
    } else if (/^(選單|主選單|功能|全部功能|更多功能|使用說明|說明|menu|help)$/i.test(text)) {
      answer = menuCard_(); // 選單.gs：四個分類
    } else if (menuCategory_(text)) {
      answer = menuCategory_(text); // 選單.gs：按了分類，傳那一類的功能按鈕
    } else if (/^出門時間(\s|$)/.test(text)) {
      answer = menuFlow_(text); // 選單.gs：用點的排出門時間
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
  return card_({ // 卡片.gs
    badge: '557 即時到站',
    title: title,
    rows: stopNames.map(name => {
      const hits = etas.filter(e => e.StopName.Zh_tw === name);
      return { label: name, value: hits.length ? hits.map(etaText_).join('、') : '沒有資料' };
    }),
    footer: 'TDX 即時資料・' + nowText_(),
    buttons: direction === 0
      ? [{ label: '比較其他路線', text: '幫我比較路線' }, { label: '557 在哪裡搭', text: '557 在哪裡搭' }]
      : [{ label: '找人共乘回士林', text: '共乘 回士林' }],
  });
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
  if (pop >= 60) advice = '很可能下雨。557 會比平常擠，建議早 10 分鐘出門、記得帶傘。';
  else if (pop >= 30) advice = '有機會下雨，帶把傘比較保險。';
  else advice = '應該不會下雨，可以考慮從錢穆故居站走進學校。';

  return card_({ // 卡片.gs
    badge: '上學時段天氣',
    title: (isTomorrow ? '明天' : '今天') + '早上 6–9 點',
    subtitle: '士林區',
    rows: [{ label: '降雨機率', value: pop + '%', best: pop >= 60 }],
    notes: pop >= 60 ? [] : [advice],
    warns: pop >= 60 ? [advice] : [],
    footer: '中央氣象署・' + nowText_(),
    buttons: [{ label: '下雨前一晚提醒我', text: '訂閱提醒' }],
  });
}

// ===== LINE 回覆、紀錄 =====

/**
 * answer 可以是一段文字、一個 LINE 訊息物件，或是它們的陣列（最多 5 則）。
 * 不放輸入框上面那排「快速回覆」：按鈕都做在訊息裡（卡片.gs 的 card_、choices_），會留在聊天室。
 */
function reply_(replyToken, answer) {
  const messages = (Array.isArray(answer) ? answer : [answer])
    .map(m => (typeof m === 'string' ? { type: 'text', text: m } : m));
  const send = list => UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
    payload: JSON.stringify({ replyToken: replyToken, messages: list }),
    muteHttpExceptions: true,
  });
  const res = send(messages);
  if (res.getResponseCode() === 200) return;
  // 卡片的格式只要有一點不對，LINE 就整則不收。這時改用純文字再回一次，Bot 才不會沒反應
  console.error('LINE 不接受這則回覆：' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  send([{ type: 'text', text: plain_(answer).slice(0, 4900) || '抱歉，剛剛出了點問題，請再試一次。' }]);
}

function log_(ev, userText, botText) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('訊息紀錄');
  if (!sheet) {
    sheet = ss.insertSheet('訊息紀錄');
    sheet.appendRow(['時間', '使用者 ID', '使用者訊息', 'Bot 回覆']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), ev.source && ev.source.userId, userText, plain_(botText)]); // 卡片.gs：紀錄裡只留文字
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
  console.log(plain_(route_('557')));
  console.log(plain_(route_('回家')));
  console.log(plain_(route_('天氣')));
  log_({ source: { userId: '測試' } }, '測試', '測試成功');
}

// ============================================================================
// YouBike.gs
// ============================================================================

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

// ============================================================================
// 共乘.gs
// ============================================================================

/**
 * 計程車共乘（12）：東吳 ↔ 士林站，即時＋預約
 *
 * 每一團都是「方向 + 出發時間」：
 *   - 現在走：第一個人開鈴後最多等 5 分鐘，滿 4 人或時間到就成團
 *   - 預約：10 分鐘一格。出發前 5 分鐘開放現場的人加入，並提醒預約的人
 * 2 人以上平分車資；只有 1 人一樣算成團，送積分。預約沒出現扣信用分。
 * 平台只湊人、不碰錢：團主自己用叫車 App 叫車付款，其他人轉給團主。
 *
 * 等車室是一個網頁（等車室.gs），每 3 秒問一次 cpRoomState，所以不用推播額度。
 * 會用到推播的只有：預約有人加入／取消的回報、出發前 5 分鐘的提醒。
 *
 * 第一次使用：部署新版本後，在編輯器執行一次「設定共乘排程」。
 * 用到 Code.gs 的 PROPS、TZ，卡片.gs 的 choices_（訊息裡的按鈕）。
 */
const CP = {
  FARE: 160,              // 士林捷運站 ↔ 外雙溪校區的參考車資（學校公告）
  SEATS: 4,
  LIVE_WAIT_MIN: 5,       // 現在走：最多等幾分鐘
  OPEN_BEFORE_MIN: 5,     // 預約：出發前幾分鐘轉成即時團、發提醒；在這之前取消不扣分
  NO_SHOW_GRACE_MIN: 3,   // 預約：出發時間過幾分鐘還沒按「我到了」算沒出現
  SLOT_MIN: 10,           // 預約幾分鐘一格
  RESERVE_DAYS: 7,        // 最遠可以預約幾天後
  SOLO_POINTS: 20,        // 只有一個人的獎勵，一天一次
  NO_SHOW_PENALTY: 5,
  LATE_CANCEL_PENALTY: 2,
  RIDE_BONUS: 1,          // 完成一次共乘加回的信用分
  MIN_CREDIT: 80,         // 信用分低於這個數字不能預約
  PUSH_KEEP: 30,          // 推播額度至少留這麼多給雨天、考試週提醒
};

const CP_DIRS = {
  去學校: { label: '士林站 → 東吳', meet: '捷運士林站 1 號出口' },
  回士林: { label: '東吳 → 士林站', meet: '東吳大學校門口（第一警衛亭旁）' },
};

const CP_BOT_ID = '@311zktcn'; // 等車室裡「回 LINE」的連結要用

const CP_GROUP_HEAD = ['團號', '方向', '類型', '出發時間', '狀態', '團主', '成員', '建立時間', '更新時間', '已提醒', '已檢查沒出現'];
const CP_USER_HEAD = ['使用者 ID', '暱稱', '信用分', '積分', '上次獨行獎勵', '等車室代碼', '加入時間'];
const CP_LOG_HEAD = ['時間', '團號', '使用者 ID', '方向', '類型', '事件', '人數', '每人金額', '積分變化', '信用分變化'];
const CP_ACTIVE = ['等待中', '已成團', '已叫車'];

// ===== LINE 訊息 =====

/** 文字訊息開頭是「共乘」「我的共乘」「取消共乘」時由 Code.gs 轉過來 */
function cpText_(uid, text) {
  return cpLocked_(() => {
    cpTick_(cpNow_());
    const p = text.trim().split(/\s+/);
    if (p[0] === '我的共乘') return cpMine_(uid);
    if (p[0] === '取消共乘') return cpCancel_(uid, p[1]);
    const dir = p[1];
    if (!CP_DIRS[dir]) return cpAskDir_();
    if (p[2] === '現在走') return cpLiveStatus_(uid, dir);
    if (p[2] === '加入') return cpJoinLive_(uid, dir);
    if (p[2] === '預約') return p[3] ? cpSlotStatus_(uid, dir, cpParseTime_(p[3], p[4])) : cpAskTime_(dir);
    if (p[2] === '確認') return cpReserve_(uid, dir, cpParseTime_(p[3], p[4]));
    return cpAskMode_(dir);
  });
}

/** 「自己選時間」的日期時間選擇器 */
function cpPostback_(uid, postback) {
  const m = String(postback.data || '').match(/^cp=預約&dir=(.+)$/);
  if (!m || !CP_DIRS[m[1]] || !postback.params || !postback.params.datetime) return null;
  const parts = postback.params.datetime.split('T');
  return cpText_(uid, '共乘 ' + m[1] + ' 預約 ' + parts[0] + ' ' + parts[1]);
}

function cpAskDir_() {
  return choices_('🚕 計程車共乘\n\n湊 2～4 個同學一起搭，車資平分：2 人各 ' + cpShare_(2) + '、3 人各 ' + cpShare_(3) + '、4 人各 ' + cpShare_(4) + ' 元。\n\n要往哪個方向？',
    Object.keys(CP_DIRS).map(d => [CP_DIRS[d].label, '共乘 ' + d]).concat([['我的共乘', '我的共乘']]));
}

function cpAskMode_(dir) {
  return choices_('🚕 ' + CP_DIRS[dir].label + '\n\n現在就要走，還是先預約？',
    [['🔔 現在走', '共乘 ' + dir + ' 現在走'], ['📅 預約', '共乘 ' + dir + ' 預約']]);
}

// ----- 現在走 -----

function cpLiveStatus_(uid, dir) {
  const now = cpNow_();
  const groups = cpLoadGroups_();
  const mine = cpCurrentOf_(groups, uid, now);
  if (mine) return cpRoomButton_(uid, '你已經在一團裡了：' + cpWhen_(mine.depart, now) + ' ' + CP_DIRS[mine.dir].label + '，目前 ' + mine.members.length + ' 人。');

  const g = cpJoinable_(groups, dir, now);
  if (!g) {
    return choices_('🔔 ' + CP_DIRS[dir].label + '\n\n現在沒有人在等，你是第一個。\n我幫你開鈴，最多等 ' + CP.LIVE_WAIT_MIN + ' 分鐘。\n\n'
      + '一個人 ' + CP.FARE + ' 元；2 人各 ' + cpShare_(2) + '、3 人各 ' + cpShare_(3) + '、4 人各 ' + cpShare_(4) + ' 元。\n時間到還是沒人，送你 ' + CP.SOLO_POINTS + ' 分。',
      [['開鈴', '共乘 ' + dir + ' 加入'], ['改成預約', '共乘 ' + dir + ' 預約']]);
  }
  const n = g.members.length;
  const left = Math.max(1, Math.ceil((g.depart - now) / 60000));
  return choices_('🔔 ' + CP_DIRS[dir].label + '\n\n現在有 ' + n + ' 個人在等，' + (g.type === '預約' ? cpWhen_(g.depart, now) + ' 出發' : '還剩 ' + left + ' 分鐘') + '。\n'
    + '你加入就 ' + (n + 1) + ' 人，一人約 ' + cpShare_(n + 1) + ' 元（現在 ' + cpShare_(n) + ' 元）。\n集合點：' + CP_DIRS[dir].meet,
    [['加入', '共乘 ' + dir + ' 加入']]);
}

function cpJoinLive_(uid, dir) {
  const now = cpNow_();
  const groups = cpLoadGroups_();
  const mine = cpCurrentOf_(groups, uid, now);
  if (mine) return cpRoomButton_(uid, '你已經在一團裡了，打開等車室看看現在幾個人。');

  const user = cpUser_(uid);
  let g = cpJoinable_(groups, dir, now);
  if (!g) {
    g = { id: cpNewId_(), dir: dir, type: '即時', depart: new Date(now.getTime() + CP.LIVE_WAIT_MIN * 60000),
      status: '等待中', leader: uid, members: [], created: now, reminded: false, checked: false };
  }
  g.members.push({ id: uid, name: user.name, at: now.getTime(), arrived: true, boarded: false });
  cpSaveGroup_(g);
  cpLog_(g, uid, '加入', 0, 0);
  cpTick_(now); // 滿 4 人馬上成團

  const n = g.members.length;
  return cpRoomButton_(uid, (n === 1 ? '🔔 已開鈴！你是第一個，也是團主。' : '✅ 已加入，現在 ' + n + ' 人，一人約 ' + cpShare_(n) + ' 元。')
    + '\n集合點：' + CP_DIRS[dir].meet + '\n\n打開等車室，有人加入會響。');
}

// ----- 預約 -----

function cpAskTime_(dir) {
  const now = cpNow_();
  const day = n => Utilities.formatDate(new Date(now.getTime() + n * 86400000), TZ, 'yyyy-MM-dd');
  // 早八（08:10）、第二節（09:10）往回推車程和走路；回程抓第 8 節、第 9 節下課後
  const presets = dir === '去學校'
    ? [['明天 07:40（早八前）', day(1) + ' 07:40'], ['明天 08:40（第二節前）', day(1) + ' 08:40']]
    : [['17:10（第 8 節下課）', '17:10'], ['18:30（第 9 節下課）', '18:30']].map(([label, hm]) => {
      const today = cpParseTime_(day(0), hm) - now > CP.OPEN_BEFORE_MIN * 60000;
      return [(today ? '今天 ' : '明天 ') + label, day(today ? 0 : 1) + ' ' + hm];
    });
  const iso = d => Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm");
  const items = presets.map(([label, when]) => [label, '共乘 ' + dir + ' 預約 ' + when]);
  items.push({ label: '自己選時間', picker: {
    data: 'cp=預約&dir=' + dir, mode: 'datetime',
    initial: iso(cpRound_(new Date(now.getTime() + 30 * 60000))),
    min: iso(new Date(now.getTime() + (CP.OPEN_BEFORE_MIN + 1) * 60000)),
    max: iso(new Date(now.getTime() + CP.RESERVE_DAYS * 86400000)),
  } });
  return choices_('📅 預約 ' + CP_DIRS[dir].label + '\n\n要幾點出發？（' + CP.SLOT_MIN + ' 分鐘一班）', items); // 卡片.gs
}

function cpSlotStatus_(uid, dir, when) {
  const now = cpNow_();
  const bad = cpCheckSlot_(when, now, dir);
  if (bad) return bad;
  const g = cpSlotGroup_(cpLoadGroups_(), dir, when);
  const title = '📅 ' + cpWhen_(when, now) + ' ' + CP_DIRS[dir].label + '\n\n';
  if (g && g.members.some(m => m.id === uid)) {
    return choices_(title + '你已經預約這班了，目前 ' + g.members.length + ' 人，一人約 ' + cpShare_(g.members.length) + ' 元。', [['我的共乘', '我的共乘'], ['取消共乘', '取消共乘 ' + g.id]]);
  }
  const n = g ? g.members.length : 0;
  if (n >= CP.SEATS) return choices_(title + '這班已經滿 ' + CP.SEATS + ' 人了，換個時間吧。', [['換時間', '共乘 ' + dir + ' 預約']]);
  const iso = Utilities.formatDate(when, TZ, 'yyyy-MM-dd HH:mm');
  return choices_(title + (n ? '這個時段目前 ' + n + ' 人。你加入後 ' + (n + 1) + ' 人，一人約 ' + cpShare_(n + 1) + ' 元。' : '這個時段還沒有人，你是第一個。有人加入我會通知你。')
    + '\n集合點：' + CP_DIRS[dir].meet, [['預約', '共乘 ' + dir + ' 確認 ' + iso], ['換時間', '共乘 ' + dir + ' 預約']]);
}

function cpReserve_(uid, dir, when) {
  const now = cpNow_();
  const bad = cpCheckSlot_(when, now, dir);
  if (bad) return bad;
  const user = cpUser_(uid);
  if (user.credit < CP.MIN_CREDIT) {
    return choices_('你的信用分是 ' + user.credit + ' 分，低於 ' + CP.MIN_CREDIT + ' 分暫時不能預約。\n用「現在走」完成共乘，每次可以加回 ' + CP.RIDE_BONUS + ' 分。', [['🔔 現在走', '共乘 ' + dir + ' 現在走']]);
  }
  let g = cpSlotGroup_(cpLoadGroups_(), dir, when);
  if (g && g.members.some(m => m.id === uid)) return cpSlotStatus_(uid, dir, when);
  if (g && g.members.length >= CP.SEATS) return cpSlotStatus_(uid, dir, when);
  if (!g) g = { id: cpNewId_(), dir: dir, type: '預約', depart: when, status: '等待中', leader: uid, members: [], created: now, reminded: false, checked: false };

  const others = g.members.map(m => m.id);
  const before = g.members.length;
  g.members.push({ id: uid, name: user.name, at: now.getTime(), arrived: false, boarded: false });
  if (!g.members.some(m => m.id === g.leader)) g.leader = uid;
  cpSaveGroup_(g);
  cpLog_(g, uid, '預約', 0, 0);

  const n = g.members.length;
  const what = cpWhen_(when, now) + ' ' + CP_DIRS[dir].label;
  cpPush_(others, '🔔 ' + what + '，又有 1 人加入\n現在 ' + n + ' 人，一人約 ' + cpShare_(n) + ' 元（原本 ' + cpShare_(before) + ' 元）');

  return choices_('✅ 已預約 ' + what + '\n目前 ' + n + ' 人，一人約 ' + cpShare_(n) + ' 元\n集合點：' + CP_DIRS[dir].meet + '\n\n'
    + '・有人加入或取消，我會通知你\n・出發前 ' + CP.OPEN_BEFORE_MIN + ' 分鐘到集合點，傳「我的共乘」打開等車室按「我到了」\n'
    + '・出發 ' + CP.OPEN_BEFORE_MIN + ' 分鐘前可以免費取消；沒出現扣信用分 ' + CP.NO_SHOW_PENALTY + ' 分',
    [['我的共乘', '我的共乘'], ['取消共乘', '取消共乘 ' + g.id]]);
}

function cpCheckSlot_(when, now, dir) {
  const again = [['重新選時間', '共乘 ' + dir + ' 預約']];
  if (!when || isNaN(when)) return choices_('我看不懂這個時間，重新選一次吧。', again);
  if (when - now <= CP.OPEN_BEFORE_MIN * 60000) return choices_('這個時間太近了，' + CP.OPEN_BEFORE_MIN + ' 分鐘內要走請用「現在走」。', [['🔔 現在走', '共乘 ' + dir + ' 現在走']].concat(again));
  if (when - now > CP.RESERVE_DAYS * 86400000) return choices_('最遠只能預約 ' + CP.RESERVE_DAYS + ' 天內的時間。', again);
  return null;
}

// ----- 我的共乘、取消 -----

function cpMine_(uid) {
  const now = cpNow_();
  const mine = cpLoadGroups_().filter(g => CP_ACTIVE.indexOf(g.status) >= 0 && g.members.some(m => m.id === uid))
    .sort((a, b) => a.depart - b.depart);
  const user = cpUser_(uid);
  const me = '信用分 ' + user.credit + '・積分 ' + user.points;
  if (!mine.length) return choices_('你目前沒有共乘。\n' + me, [['🚕 共乘', '共乘']]);
  const lines = mine.map(g => '・' + cpWhen_(g.depart, now) + ' ' + CP_DIRS[g.dir].label + '（' + g.status + '，' + g.members.length + ' 人，一人約 ' + cpShare_(g.members.length) + ' 元）');
  return cpRoomButton_(uid, '🚕 我的共乘\n' + lines.join('\n') + '\n\n' + me, [['取消共乘', '取消共乘']]);
}

function cpCancel_(uid, groupId) {
  const now = cpNow_();
  const mine = cpLoadGroups_().filter(g => CP_ACTIVE.indexOf(g.status) >= 0 && g.members.some(m => m.id === uid && !m.boarded))
    .sort((a, b) => a.depart - b.depart);
  if (!mine.length) return choices_('你目前沒有可以取消的共乘。', [['🚕 共乘', '共乘']]);
  let g = groupId ? mine.filter(x => x.id === groupId)[0] : (mine.length === 1 ? mine[0] : null);
  if (!g) {
    return choices_('要取消哪一班？', mine.map(x => [cpWhen_(x.depart, now) + ' ' + (x.dir === '去學校' ? '往東吳' : '往士林'), '取消共乘 ' + x.id]));
  }
  const penalty = cpLeave_(g, uid, now);
  return choices_('已取消 ' + cpWhen_(g.depart, now) + ' ' + CP_DIRS[g.dir].label + '。'
    + (penalty ? '\n因為已經成團或快出發了，信用分扣 ' + penalty + ' 分。' : ''), [['🚕 共乘', '共乘']]);
}

/** 把人從團裡移掉；快出發或已成團才走要扣信用分。回傳扣了幾分 */
function cpLeave_(g, uid, now) {
  const late = g.status !== '等待中' || (g.type === '預約' && cpOpen_(g, now));
  const penalty = late ? CP.LATE_CANCEL_PENALTY : 0;
  const before = g.members.length;
  g.members = g.members.filter(m => m.id !== uid);
  if (!g.members.length) g.status = '取消';
  else if (g.leader === uid) g.leader = g.members[0].id;
  if (g.status === '已成團' && g.members.length === 1) g.status = '等待中'; // 剩一個人，交給 cpTick_ 判斷獨行
  cpSaveGroup_(g);
  if (penalty) cpCredit_(uid, -penalty);
  cpLog_(g, uid, late ? '臨時取消' : '取消', 0, -penalty, before);

  if (g.type === '預約' && g.members.length) {
    const n = g.members.length;
    cpPush_(g.members.map(m => m.id), cpWhen_(g.depart, now) + ' ' + CP_DIRS[g.dir].label + ' 那班有 1 人取消，現在 ' + n + ' 人，一人約 ' + cpShare_(n) + ' 元');
  }
  return penalty;
}

// ===== 每分鐘檢查：成團、獨行獎勵、沒出現、出發提醒 =====

function 共乘每分鐘檢查() {
  cpLocked_(() => cpTick_(cpNow_()));
}

function cpTick_(now) {
  cpLoadGroups_().filter(g => CP_ACTIVE.indexOf(g.status) >= 0).forEach(g => {
    let changed = false;

    if (g.status === '等待中') {
      if (g.type === '預約' && !g.reminded && g.members.length && cpOpen_(g, now)) {
        g.reminded = true;
        changed = true;
        const n = g.members.length;
        cpPush_(g.members.map(m => m.id), '🚕 你預約的 ' + cpWhen_(g.depart, now) + ' ' + CP_DIRS[g.dir].label + ' 快出發了\n現在 ' + n + ' 人，一人約 ' + cpShare_(n) + ' 元\n集合點：' + CP_DIRS[g.dir].meet
          + '\n\n到了請傳「我的共乘」，打開等車室按「我到了」。');
      }
      if (!g.members.length) {
        g.status = '取消';
        changed = true;
      } else if (now >= g.depart || (g.members.length >= CP.SEATS && cpOpen_(g, now))) {
        // 預約團就算提早滿了，也要等到出發前 5 分鐘才算成團（在那之前還能免費取消）
        if (g.members.length >= 2) {
          g.status = '已成團';
          changed = true;
        } else if (g.members[0].arrived) {
          cpSolo_(g);
          changed = true;
        } // 預約的那一個人還沒到：等到寬限時間再算沒出現
      }
    }

    if (g.type === '預約' && !g.checked && now - g.depart >= CP.NO_SHOW_GRACE_MIN * 60000 && CP_ACTIVE.indexOf(g.status) >= 0) {
      g.checked = true;
      changed = true;
      const size = g.members.length;
      g.members.filter(m => !m.arrived && !m.boarded).forEach(m => {
        cpCredit_(m.id, -CP.NO_SHOW_PENALTY);
        cpLog_(g, m.id, '沒出現', 0, -CP.NO_SHOW_PENALTY, size);
      });
      g.members = g.members.filter(m => m.arrived || m.boarded);
      if (!g.members.length) {
        g.status = '取消';
      } else {
        if (!g.members.some(m => m.id === g.leader)) g.leader = g.members[0].id;
        if (g.members.length === 1 && g.status !== '已叫車') cpSolo_(g);
      }
    }

    if ((g.status === '已成團' || g.status === '已叫車') && now - g.depart > 60 * 60000) {
      g.status = '已結束';
      changed = true;
    }
    if (changed) cpSaveGroup_(g);
  });
}

/** 只有一個人：一樣算成團，送積分（一天一次） */
function cpSolo_(g) {
  g.status = '獨行';
  const m = g.members[0];
  const user = cpUser_(m.id);
  const today = Utilities.formatDate(cpNow_(), TZ, 'yyyy-MM-dd');
  m.reward = user.soloDay === today ? 0 : CP.SOLO_POINTS;
  if (m.reward) {
    user.points += m.reward;
    user.soloDay = today;
    cpSaveUser_(user);
  }
  cpLog_(g, m.id, '獨行', m.reward, 0);
}

// ===== 等車室網頁呼叫的函式（google.script.run） =====

function doGet(e) {
  const token = e && e.parameter && e.parameter.t;
  if (e && e.parameter && e.parameter.page === 'geo') return geoTestPage_(); // 定位測試.gs
  if (e && e.parameter && e.parameter.page === 'checkin' && /^[0-9a-f-]{36}$/.test(token || '')) return ptCheckinPage_(token); // 積分.gs
  if (e && e.parameter && e.parameter.page === 'room' && /^[0-9a-f-]{36}$/.test(token || '')) {
    return HtmlService.createHtmlOutput(ROOM_HTML.replace('__TOKEN__', token).replace('__BOT__', CP_BOT_ID)) // 等車室.gs
      .setTitle('共乘等車室')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return ContentService.createTextOutput('東吳通勤達人');
}

function cpRoomState(token) {
  return cpLocked_(() => {
    const now = cpNow_();
    cpTick_(now);
    return cpRoomView_(token, now);
  });
}

/** action：arrived（我到了）、call（叫車）、board（上車了）、leave（離開） */
function cpRoomAction(token, action) {
  return cpLocked_(() => {
    const now = cpNow_();
    cpTick_(now);
    const user = cpUserByToken_(token);
    const g = user && cpCurrentOf_(cpLoadGroups_(), user.id, now);
    const me = g && g.members.filter(m => m.id === user.id)[0];
    if (me && CP_ACTIVE.indexOf(g.status) >= 0) {
      if (action === 'arrived') {
        me.arrived = true;
        cpSaveGroup_(g);
      } else if (action === 'leave' && !me.boarded) {
        cpLeave_(g, user.id, now);
      } else if (action === 'call' && g.leader === user.id && g.status === '已成團') {
        g.status = '已叫車';
        cpSaveGroup_(g);
        cpLog_(g, user.id, '叫車', 0, 0);
      } else if (action === 'board' && g.status !== '等待中' && !me.boarded) {
        me.boarded = true;
        me.arrived = true;
        if (g.members.every(m => m.boarded)) g.status = '已出發';
        cpSaveGroup_(g);
        cpCredit_(user.id, CP.RIDE_BONUS);
        cpLog_(g, user.id, '上車', 0, CP.RIDE_BONUS);
      }
      cpTick_(now);
    }
    return cpRoomView_(token, now);
  });
}

function cpRoomView_(token, now) {
  const user = cpUserByToken_(token);
  if (!user) return { ok: false };
  const g = cpCurrentOf_(cpLoadGroups_(), user.id, now, true);
  if (!g) return { ok: true, none: true, credit: user.credit, points: user.points };
  const me = g.members.filter(m => m.id === user.id)[0];
  const n = g.members.length;
  return {
    ok: true,
    status: g.status,
    type: g.type,
    dir: CP_DIRS[g.dir].label,
    meet: CP_DIRS[g.dir].meet,
    when: cpWhen_(g.depart, now),
    departAt: g.depart.getTime(),
    now: now.getTime(),
    total: CP.FARE,
    share: cpShare_(n),
    seats: CP.SEATS,
    isLeader: g.leader === user.id,
    arrived: !!me.arrived,
    boarded: !!me.boarded,
    reward: me.reward || 0,
    members: g.members.map(m => ({ name: m.name, leader: m.id === g.leader, me: m.id === user.id, arrived: !!m.arrived, boarded: !!m.boarded })),
    credit: user.credit,
    points: user.points,
  };
}

// ===== 資料：共乘團、共乘用戶、共乘紀錄 =====

function cpLoadGroups_() {
  return cpSheet_('共乘團', CP_GROUP_HEAD).getDataRange().getValues().slice(1).map((r, i) => ({
    row: i + 2, id: r[0], dir: r[1], type: r[2], depart: new Date(r[3]), status: r[4], leader: r[5],
    members: JSON.parse(r[6] || '[]'), created: new Date(r[7]), updated: new Date(r[8]),
    reminded: r[9] === true, checked: r[10] === true,
  }));
}

function cpSaveGroup_(g) {
  const sheet = cpSheet_('共乘團', CP_GROUP_HEAD);
  g.updated = cpNow_();
  const row = [g.id, g.dir, g.type, g.depart, g.status, g.leader, JSON.stringify(g.members), g.created, g.updated, !!g.reminded, !!g.checked];
  if (g.row) {
    sheet.getRange(g.row, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    g.row = sheet.getLastRow();
  }
}

/** 這個方向現在可以加入的團：即時團，或 5 分鐘內要出發的預約團 */
function cpJoinable_(groups, dir, now) {
  return groups.filter(g => g.dir === dir && g.status === '等待中' && g.members.length < CP.SEATS && now < g.depart && cpOpen_(g, now))
    .sort((a, b) => a.depart - b.depart)[0];
}

/** 即時團一直是開放的；預約團要到出發前 5 分鐘才開放現場加入 */
function cpOpen_(g, now) {
  return g.type === '即時' || g.depart - now <= CP.OPEN_BEFORE_MIN * 60000;
}

function cpSlotGroup_(groups, dir, when) {
  return groups.filter(g => g.dir === dir && g.type === '預約' && g.status === '等待中' && g.depart.getTime() === when.getTime())[0];
}

/**
 * 這個人「現在」所在的團：即時團，或已經開放現場加入的預約團。
 * withRecent=true 時，15 分鐘內剛結束的團也算（等車室要顯示結果）。
 */
function cpCurrentOf_(groups, uid, now, withRecent) {
  const mine = groups.filter(g => g.members.some(m => m.id === uid));
  const live = mine.filter(g => CP_ACTIVE.indexOf(g.status) >= 0 && cpOpen_(g, now))
    .sort((a, b) => a.depart - b.depart)[0];
  if (live || !withRecent) return live;
  const upcoming = mine.filter(g => CP_ACTIVE.indexOf(g.status) >= 0).sort((a, b) => a.depart - b.depart)[0];
  if (upcoming) return upcoming;
  return mine.filter(g => now - g.updated <= 15 * 60000).sort((a, b) => b.updated - a.updated)[0];
}

function cpUser_(uid) {
  const sheet = cpSheet_('共乘用戶', CP_USER_HEAD);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === uid) return cpUserFromRow_(rows[i], i + 1);
  }
  const user = { id: uid, name: cpLineName_(uid), credit: 100, points: 0, soloDay: '', token: Utilities.getUuid(), joined: cpNow_() };
  sheet.appendRow([user.id, user.name, user.credit, user.points, user.soloDay, user.token, user.joined]);
  user.row = sheet.getLastRow();
  return user;
}

function cpUserByToken_(token) {
  const rows = cpSheet_('共乘用戶', CP_USER_HEAD).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (token && rows[i][5] === token) return cpUserFromRow_(rows[i], i + 1);
  }
  return null;
}

function cpUserFromRow_(r, row) {
  // 試算表會把「2026-10-12」自動轉成日期，讀回來時統一成字串
  const soloDay = r[4] instanceof Date ? Utilities.formatDate(r[4], TZ, 'yyyy-MM-dd') : String(r[4] || '');
  return { row: row, id: r[0], name: r[1], credit: Number(r[2]), points: Number(r[3]), soloDay: soloDay, token: r[5], joined: r[6] };
}

function cpSaveUser_(user) {
  cpSheet_('共乘用戶', CP_USER_HEAD).getRange(user.row, 1, 1, 7)
    .setValues([[user.id, user.name, user.credit, user.points, user.soloDay, user.token, user.joined]]);
}

function cpCredit_(uid, delta) {
  const user = cpUser_(uid);
  user.credit = Math.max(0, Math.min(100, user.credit + delta));
  cpSaveUser_(user);
}

/** 每個動作都記一筆，之後算配對成功率、平均等候時間（測試數據） */
function cpLog_(g, uid, event, points, credit, size) {
  const n = size || g.members.length;
  cpSheet_('共乘紀錄', CP_LOG_HEAD).appendRow([cpNow_(), g.id, uid, g.dir, g.type, event, n, cpShare_(n), points, credit]);
}

function cpSheet_(name, head) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(head);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ===== LINE：暱稱、推播、訊息格式 =====

/** 等車室裡顯示的名字用 LINE 暱稱（只有同一團的人看得到） */
function cpLineName_(uid) {
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + uid, {
      headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() === 200) return String(JSON.parse(res.getContentText()).displayName || '').slice(0, 10) || '同學';
  } catch (err) {
    console.error(err);
  }
  return '同學';
}

/** 推播給一群人。額度不夠就不發（回傳 false），把剩下的留給雨天、考試週提醒 */
function cpPush_(uids, text) {
  if (!uids.length) return false;
  try {
    if (cpQuotaLeft_() - uids.length < CP.PUSH_KEEP) return false;
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
      payload: JSON.stringify({ to: uids, messages: [choices_(text, [['我的共乘', '我的共乘'], ['取消共乘', '取消共乘']])] }),
    });
    return true;
  } catch (err) {
    console.error(err); // 推播失敗不能讓預約本身失敗
    return false;
  }
}

function cpQuotaLeft_() {
  const get = path => JSON.parse(UrlFetchApp.fetch('https://api.line.me/v2/bot/message/' + path, {
    headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
  }).getContentText());
  const quota = get('quota');
  return quota.type === 'none' ? Infinity : quota.value - get('quota/consumption').totalUsage;
}

/** 回一段話加「打開等車室」的按鈕；items 是另外要放的按鈕 */
function cpRoomButton_(uid, text, items) {
  const url = cpWebAppUrl_() + '?page=room&t=' + cpUser_(uid).token;
  return choices_(text, [{ label: '打開等車室', uri: url }].concat(items || [])); // 卡片.gs
}

/** 等車室的網址就是 Bot 的部署網址；抓不到時可以在指令碼屬性設 WEBAPP_URL */
function cpWebAppUrl_() {
  return PROPS.getProperty('WEBAPP_URL') || ScriptApp.getService().getUrl();
}

// ===== 小工具 =====

function cpNow_() {
  return new Date();
}

/** 車資平分，進位到 5 元：2 人 80、3 人 55、4 人 40 */
function cpShare_(n) {
  return n <= 1 ? CP.FARE : Math.ceil(CP.FARE / n / 5) * 5;
}

function cpParseTime_(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{1,2}:\d{2}$/.test(time || '')) return null;
  return cpRound_(new Date(date + 'T' + ('0' + time).slice(-5) + ':00+08:00'));
}

function cpRound_(date) {
  const step = CP.SLOT_MIN * 60000;
  return new Date(Math.round(date.getTime() / step) * step);
}

function cpWhen_(date, now) {
  const day = d => Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  const hm = Utilities.formatDate(date, TZ, 'HH:mm');
  if (day(date) === day(now)) return '今天 ' + hm;
  if (day(date) === day(new Date(now.getTime() + 86400000))) return '明天 ' + hm;
  return Utilities.formatDate(date, TZ, 'M/d') + ' ' + hm;
}

function cpNewId_() {
  return 'G' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** 兩個人同時按「加入」時，一次只讓一個人改試算表 */
function cpLocked_(work) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

// ===== 在編輯器裡手動執行 =====

/** 執行一次就好：每分鐘檢查成團、沒出現、出發提醒 */
function 設定共乘排程() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === '共乘每分鐘檢查')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('共乘每分鐘檢查').timeBased().everyMinutes(1).create();
  ['共乘團', '共乘用戶', '共乘紀錄'].forEach((name, i) => cpSheet_(name, [CP_GROUP_HEAD, CP_USER_HEAD, CP_LOG_HEAD][i]));
  console.log('✅ 已設定：每分鐘檢查一次共乘');
  console.log('等車室網址：' + cpWebAppUrl_() + '?page=room&t=…');
}

// ============================================================================
// 卡片.gs
// ============================================================================

/**
 * 卡片式回覆（LINE 的 Flex Message）和配色
 *
 * 配色是「磚紅米白」：標題列磚紅底白字，內文米白底深色字。
 * 紅色只當品牌色用，不拿來表示警告；要提醒的事情用琥珀色的字。
 *
 * 其他檔案用 card_({ … }) 做一張卡片：
 *   badge     標題上面的小字（這張卡片是什麼）
 *   title     標題
 *   subtitle  標題下面的小字
 *   rows      一列一列的資料：{ label, value, sub, best }。best 是最推薦的那一列
 *   notes     提示（淺色底的一段話）
 *   warns     要注意的事（琥珀色字）
 *   footer    最下面的小字（資料來源、時間）
 *   buttons   按鈕：{ label, text } 按了替使用者傳出 text；{ label, uri } 按了打開網頁
 *   menu      false 就不放最下面的「回選單」
 *
 * 按鈕一律做在訊息裡，不用輸入框上面那排「快速回覆」：那排按鈕傳了新訊息就消失，也不好看。
 * 做在訊息裡的按鈕會留在聊天室，往回滑還能按。
 *   card_({ … buttons })      資料卡片，下面帶幾顆按鈕
 *   choices_(問題, 按鈕)       問一個問題、給幾顆按鈕讓人選（共乘、雨傘、測驗、出門時間都用這個）
 *
 * 每張卡片都帶一份純文字版（altText）：通知預覽、訊息紀錄、LINE 不接受卡片時的備用回覆都用它。
 */
const UI = {
  brand: '#A63A2B',      // 磚紅：標題列、主要按鈕、最推薦的那一列
  brandDark: '#7A2A1F',  // 深磚紅：次要按鈕的字
  onBrand: '#FFFFFF',
  onBrandSoft: '#F7DCD5',
  paper: '#FBF7F0',      // 米白：卡片底色
  soft: '#F3E9DC',       // 提示的底色
  line: '#E6D9C8',       // 分隔線
  ink: '#1B1D22',        // 內文
  muted: '#6B6257',      // 次要文字
  warn: '#8A5A00',       // 要注意的事
};

function card_(spec) {
  return { type: 'flex', altText: cardText_(spec).slice(0, 400), contents: cardBubble_(spec) };
}

function cardBubble_(spec) {
  const body = [];
  (spec.rows || []).forEach((row, i) => {
    if (i > 0) body.push({ type: 'separator', color: UI.line });
    body.push(cardRow_(row));
  });
  (spec.notes || []).filter(Boolean).forEach(note => body.push(cardNote_(note, UI.ink)));
  (spec.warns || []).filter(Boolean).forEach(warn => body.push(cardNote_(warn, UI.warn)));
  if (spec.footer) body.push({ type: 'text', text: spec.footer, size: 'xs', color: UI.muted, wrap: true });
  if (!body.length) body.push({ type: 'text', text: spec.title, size: 'sm', color: UI.ink, wrap: true }); // Flex 不接受空的內文

  const header = [];
  if (spec.badge) header.push({ type: 'text', text: spec.badge, size: 'xs', color: UI.onBrandSoft });
  header.push({ type: 'text', text: spec.title, size: 'lg', weight: 'bold', color: UI.onBrand, wrap: true });
  if (spec.subtitle) header.push({ type: 'text', text: spec.subtitle, size: 'sm', color: UI.onBrandSoft, wrap: true });

  const bubble = {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', backgroundColor: UI.brand, paddingAll: '16px', spacing: 'xs', contents: header },
    body: { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '16px', spacing: 'md', contents: body },
  };
  const buttons = (spec.buttons || []).map(cardButton_);
  if (buttons.length) {
    bubble.footer = { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '12px', paddingTop: '0px', spacing: 'sm', contents: buttons };
  }
  if (spec.menu !== false) {
    if (!bubble.footer) bubble.footer = { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '12px', paddingTop: '0px', spacing: 'sm', contents: [] };
    bubble.footer.contents.push(menuLink_());
  }
  return bubble;
}

/** 每張卡片最下面的小字「回選單」：沒有輸入框上面那排按鈕之後，靠它回到全部功能 */
function menuLink_() {
  return { type: 'text', text: '回選單 ›', size: 'xs', color: UI.muted, align: 'end', action: { type: 'message', label: '回選單', text: '選單' } };
}

/**
 * 問一個問題、給幾顆按鈕讓人選。按鈕在訊息裡，會留在聊天室。
 *   text     問題或說明（可以好幾行）
 *   items    [按鈕上的字, 按了傳出的字]，或 { label, uri }（打開網頁）、{ label, picker }（選日期時間）
 *   options  { title: 加一條標題列, badge: 標題上面的小字, primary: false 就沒有主要按鈕, menu: false 就不放「回選單」 }
 * 4 顆以內直排、第一顆是主要按鈕；超過 4 顆排成兩欄。
 */
function choices_(text, items, options) {
  const o = options || {};
  const chips = items.map((item, i) => choiceChip_(item, i === 0 && o.primary !== false && items.length <= 4));
  const body = [];
  if (text) body.push({ type: 'text', text: String(text), size: 'md', color: UI.ink, wrap: true });
  if (chips.length <= 4) {
    chips.forEach(chip => body.push(chip));
  } else {
    for (let i = 0; i < chips.length; i += 2) {
      // 單數顆的最後一列放一個空格，按鈕才不會變成整列寬
      body.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: [chips[i], chips[i + 1] || { type: 'filler' }] });
    }
  }
  if (o.menu !== false) body.push(menuLink_());

  const bubble = { type: 'bubble', body: { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '16px', spacing: 'sm', contents: body } };
  if (o.title) {
    const header = [];
    if (o.badge) header.push({ type: 'text', text: o.badge, size: 'xs', color: UI.onBrandSoft });
    header.push({ type: 'text', text: o.title, size: 'lg', weight: 'bold', color: UI.onBrand, wrap: true });
    bubble.header = { type: 'box', layout: 'vertical', backgroundColor: UI.brand, paddingAll: '16px', spacing: 'xs', contents: header };
  }
  const labels = items.map(item => '［' + (Array.isArray(item) ? item[0] : item.label) + '］').join('');
  return { type: 'flex', altText: ((o.title ? o.title + '\n' : '') + (text || '') + '\n' + labels).trim().slice(0, 400), contents: bubble };
}

function choiceChip_(item, primary) {
  const label = Array.isArray(item) ? item[0] : item.label;
  let action;
  if (Array.isArray(item)) action = { type: 'message', label: label.slice(0, 20), text: item[1] };
  else if (item.uri) action = { type: 'uri', label: label.slice(0, 20), uri: item.uri };
  else action = Object.assign({ type: 'datetimepicker', label: label.slice(0, 20) }, item.picker);
  return {
    type: 'box', layout: 'vertical', flex: 1, backgroundColor: primary ? UI.brand : UI.soft, cornerRadius: '8px', paddingAll: '12px', action: action,
    contents: [{ type: 'text', text: label, size: 'sm', weight: 'bold', color: primary ? UI.onBrand : UI.brandDark, align: 'center', wrap: true }],
  };
}

function cardRow_(row) {
  const top = {
    type: 'box', layout: 'horizontal', spacing: 'md',
    contents: [{ type: 'text', text: String(row.label), size: 'md', weight: 'bold', color: row.best ? UI.brand : UI.ink, flex: 0, wrap: true }],
  };
  if (row.value) top.contents.push({ type: 'text', text: String(row.value), size: 'md', weight: row.best ? 'bold' : 'regular', color: UI.ink, align: 'end', wrap: true });
  const box = { type: 'box', layout: 'vertical', spacing: 'xs', contents: [top] };
  if (row.sub) box.contents.push({ type: 'text', text: String(row.sub), size: 'xs', color: UI.muted, wrap: true });
  return box;
}

function cardNote_(text, color) {
  return {
    type: 'box', layout: 'vertical', backgroundColor: UI.soft, cornerRadius: '8px', paddingAll: '10px',
    contents: [{ type: 'text', text: String(text), size: 'sm', color: color, wrap: true }],
  };
}

function cardButton_(button, index) {
  const action = button.uri
    ? { type: 'uri', label: button.label.slice(0, 20), uri: button.uri }
    : { type: 'message', label: button.label.slice(0, 20), text: button.text };
  return index === 0
    ? { type: 'button', style: 'primary', color: UI.brand, height: 'sm', action: action }
    : { type: 'button', style: 'link', color: UI.brandDark, height: 'sm', action: action };
}

/** 卡片的純文字版 */
function cardText_(spec) {
  const lines = [spec.title + (spec.subtitle ? '（' + spec.subtitle + '）' : '')];
  (spec.rows || []).forEach(row => {
    lines.push((row.best ? '★ ' : '・') + row.label + (row.value ? '：' + row.value : '') + (row.sub ? '\n　' + row.sub : ''));
  });
  (spec.notes || []).concat(spec.warns || []).filter(Boolean).forEach(note => lines.push('', note));
  if (spec.footer) lines.push('', '（' + spec.footer + '）');
  return lines.join('\n');
}

/** 把回覆（文字、訊息物件，或它們的陣列）變成純文字：訊息紀錄和備用回覆用 */
function plain_(answer) {
  return (Array.isArray(answer) ? answer : [answer])
    .map(m => (typeof m === 'string' ? m : m.text || m.altText || ''))
    .filter(Boolean)
    .join('\n');
}

// ============================================================================
// 問卷表單.gs
// ============================================================================

/**
 * 兩份問卷的 Google 表單（題目和每一題對應哪個項目，見 repo 的「問卷題目.md」）
 *
 *   建立通勤問卷：① 通勤基本問卷，21 題，現在就發
 *   建立回饋問卷：② 使用後回饋，9 題，用 Bot 一週後發
 *
 * 在編輯器各執行一次，網址會印在執行記錄，答案存進這份試算表的新分頁。
 * 每份只會建立一次，再執行只會印出網址。要重建就刪掉指令碼屬性 SURVEY1_URL 或 SURVEY2_URL。
 * 兩份都匿名：不收 Email、不問姓名學號。
 */
const SURVEY_ADD_FRIEND = 'https://line.me/R/ti/p/%40311zktcn'; // 東吳通勤達人的加好友連結

function 建立通勤問卷() {
  surveyOnce_('SURVEY1_URL', buildCommuteSurvey_);
}

function 建立回饋問卷() {
  surveyOnce_('SURVEY2_URL', buildFeedbackSurvey_);
}

function surveyOnce_(key, build) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(key)) {
    console.log('這份問卷已經建立過了，填寫用網址：' + props.getProperty(key));
    return;
  }
  const form = build();
  form.setCollectEmail(false);
  form.setProgressBar(true);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, SpreadsheetApp.getActiveSpreadsheet().getId());
  props.setProperty(key, form.getPublishedUrl());
  console.log('填寫用網址（發給同學）：' + form.getPublishedUrl());
  console.log('編輯表單網址（隊員自己用）：' + form.getEditUrl());
}

// ===== ① 通勤基本問卷 =====

function buildCommuteSurvey_() {
  const form = FormApp.create('東吳外雙溪通勤問卷');
  form.setDescription('東吳通勤小組想了解大家怎麼到外雙溪校區，結果會用來改善 557 擁擠問題。\n問卷匿名，不會收集姓名或學號，約 4 分鐘。');
  form.setConfirmationMessage('謝謝你！\n\n想幫忙測試 LINE Bot「東吳通勤達人」的話，點這裡加好友：\n' + SURVEY_ADD_FRIEND);

  section_(form, '基本資料');
  one_(form, '年級', ['大一', '大二', '大三', '大四', '碩博士班'], { other: true });
  one_(form, '一週有幾天要到外雙溪校區？', ['1 天', '2 天', '3 天', '4 天', '5 天以上']);
  one_(form, '一週有幾天有第一節（8:10）的課？', ['0 天', '1 天', '2 天', '3 天', '4 天以上']);

  section_(form, '怎麼到學校');
  many_(form, '你通常怎麼到學校？', ['557', '300', '其他公車到錢穆故居站再走路', '通勤30', '學校的劍南路站專車', '宿舍專車（泉思學舍）',
    '機車', 'YouBike', '走路', '家人接送', '計程車', '住校'], { help: '可以選好幾個' });
  one_(form, '如果搭捷運，你在哪一站下車轉公車？', ['士林站', '劍南路站（文湖線）', '大直站（文湖線）', '芝山站', '劍潭站', '不搭捷運'], { other: true });
  one_(form, '在士林站等 557，平均要等多久才上得了車？', ['不搭 557', '5 分鐘內', '5–10 分鐘', '10–20 分鐘', '20 分鐘以上']);
  one_(form, '過去一個月，你遇過幾次 557 太擠上不了車？', ['從來沒有', '1–2 次', '每週 1–2 次', '幾乎每天']);

  section_(form, '站牌');
  one_(form, '557 在士林站的上車處今年搬過。你第一次去搭的時候，有直接找到嗎？', ['直接找到', '找了一下才找到', '一開始走錯地方', '不知道有搬過', '沒有搭過']);
  one_(form, '你知道學校建議尖峰時段改到「士林國中站」排隊嗎？', ['知道，也會去那裡排', '知道，但還是在士林站排', '不知道']);
  many_(form, '下雨天你的通勤方式會改變嗎？', ['會提早出門', '本來走路或騎車，改搭 557', '改叫計程車', '不會改變'], { help: '可以選好幾個' });

  // 第 11 題選「天氣好才會」「不願意」的人才會看到第 12 題，所以第 12 題要自己一頁
  section_(form, '557 以外的選擇');
  const youbike = form.addMultipleChoiceItem().setTitle('你願意騎 YouBike（電輔車）上學嗎？').setRequired(true);

  const whyNot = form.addPageBreakItem().setTitle('YouBike');
  many_(form, '不想騎的原因是？', ['上坡太累', '怕曬或怕雨', '怕找不到車或車位', '路上車多危險', '費用'], { other: true, help: '可以選好幾個' });

  const rest = form.addPageBreakItem().setTitle('557 以外的選擇');
  youbike.setChoices([
    youbike.createChoice('願意', rest),
    youbike.createChoice('天氣好才會', whyNot),
    youbike.createChoice('校內有車可以還才會', rest),
    youbike.createChoice('不願意', whyNot),
  ]);

  one_(form, '如果有學生包車，固定時間從士林站直達校園，一趟你願意付多少？', ['不會搭', '15 元以下', '16–25 元', '26–35 元', '36–50 元', '50 元以上']);
  many_(form, '包車你需要哪些時段？', ['8:10 第一節前', '9:10 第二節前', '其他早上時段', '中午', '傍晚回家'], { required: false, help: '可以選好幾個；不會搭的話可以跳過' });
  one_(form, '士林站和學校之間搭計程車約 160 元，2 人各 80、3 人各 55、4 人各 40。如果 LINE Bot 可以幫你當場湊人或事先預約，你願意跟其他東吳同學共乘嗎？',
    ['願意', '趕時間或下雨才會', '只跟認識的人', '不願意']);

  section_(form, '如果有獎勵');
  one_(form, '有第一節課的那幾天，你通常幾點到學校？', ['7:30 以前', '7:30–7:50', '7:50–8:10', '踩線或遲到', '我沒有第一節課']);
  one_(form, '如果 7:30 前到校打卡可以換早餐，你一週會有幾天提早到？', ['0 天，我不會為了這個早起', '1–2 天', '3 天以上', '我本來就 7:30 前到'],
    { help: '提早到代表要比平常早出門。' });
  one_(form, '要換到什麼，你才會願意提早到？', ['10 元折價券就夠', '一杯飲料', '一份完整早餐（約 50 元）', '給什麼都不會']);
  one_(form, '從錢穆故居站走進學校大約 10 分鐘。如果走這一段可以累積點數換早餐或飲料，557 很擠的時候你會改搭其他公車到錢穆故居站再走進來嗎？',
    ['會，常常這樣做', '不趕時間的時候會', '下雨或很熱就不會', '不會']);

  section_(form, '最後');
  one_(form, '我們做了一個 LINE Bot，可以查 557 到站、比較其他路線、下雨天提醒。你願意加好友幫忙測試嗎？', ['願意（送出後會顯示加好友連結）', '不用了']);
  form.addParagraphTextItem().setTitle('對 557 通勤有什麼想說的？').setHelpText('選填');
  return form;
}

// ===== ② 使用後回饋 =====

function buildFeedbackSurvey_() {
  const form = FormApp.create('東吳通勤達人使用回饋');
  form.setDescription('謝謝你試用「東吳通勤達人」！想知道哪裡好用、哪裡要改。\n問卷匿名，約 2 分鐘。');
  form.setConfirmationMessage('收到了，謝謝你的回饋！');

  many_(form, '你用過 Bot 的哪些功能？', ['557 到站', '幫我比較路線', '問上課時間和大樓（例如「8 點 D 棟」）', '天氣', '557 在哪裡搭', '訂閱提醒', '共乘'], { help: '可以選好幾個' });
  one_(form, '你有照 Bot 的建議，改搭 557 以外的公車嗎？', ['有，比較快到', '有，差不多', '有，反而比較慢', '沒有']);
  scale_(form, 'Bot 算的到站和到校時間準嗎？', 1, 5, '很不準', '很準');
  one_(form, '收到下雨或考試週提醒的那天，你有提早出門嗎？', ['有，提早 5 分鐘內', '有，提早 5–15 分鐘', '有，提早 15 分鐘以上', '沒有提早', '沒收到提醒']);
  one_(form, '「557 在哪裡搭」的資訊有幫助嗎？', ['有幫助', '普通', '沒幫助', '沒用過']);
  scale_(form, '整體滿意度', 1, 5, '很不滿意', '很滿意');
  scale_(form, '你會推薦同學使用嗎？', 0, 10, '完全不會', '一定會');
  many_(form, '最希望我們接下來做什麼？', ['步行集點', '早到早餐券', 'YouBike 即時車數', '共享雨傘', '回家路線比較'], { other: true, required: false, help: '可以選好幾個' });
  form.addParagraphTextItem().setTitle('其他建議').setHelpText('選填');
  return form;
}

// ===== 出題用的小工具 =====

function section_(form, title) {
  form.addSectionHeaderItem().setTitle(title);
}

/** 單選題。options：{ other: 要不要「其他」, required: 預設必填, help: 題目下面的小字 } */
function one_(form, title, choices, options) {
  return question_(form.addMultipleChoiceItem(), title, choices, options);
}

/** 複選題 */
function many_(form, title, choices, options) {
  return question_(form.addCheckboxItem(), title, choices, options);
}

function question_(item, title, choices, options) {
  const o = options || {};
  item.setTitle(title).setChoiceValues(choices).setRequired(o.required !== false);
  if (o.other) item.showOtherOption(true);
  if (o.help) item.setHelpText(o.help);
  return item;
}

function scale_(form, title, low, high, lowLabel, highLabel) {
  return form.addScaleItem().setTitle(title).setBounds(low, high).setLabels(lowLabel, highLabel).setRequired(true);
}

// ============================================================================
// 定位測試.gs
// ============================================================================

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
  return choices_('打開測試頁，按「測試定位」。手機問要不要允許定位時，請按允許。', // 卡片.gs
    [{ label: '打開定位測試', uri: cpWebAppUrl_() + '?page=geo' }], { title: '定位測試' }); // 共乘.gs
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

// ============================================================================
// 新生.gs
// ============================================================================

/**
 * 新生與排隊文化（模組五）：新生排隊教學（23）、排隊禮儀（28）；順便放學生自組包車的意願登記（43）
 *
 * 「新生教學」：重點說明＋教學短片連結（拍好後把網址放進指令碼屬性 NEWBIE_VIDEO_URL）
 * 「新生測驗」：三題小測驗，全對送積分、解鎖第一個成就（積分.gs）
 * 「排隊禮儀」：只講規則，不點名、不拍攝任何人
 * 「包車」：說明規劃中，按「我有興趣」記一筆到「意願紀錄」
 *
 * 上車地點會因捷運施工調整，所以這裡不寫死站牌位置，一律請學生傳「557 在哪裡搭」（站位變更.gs）。
 * 用到卡片.gs 的 choices_，共乘.gs 的 cpSheet_、cpNow_，積分.gs 的 ptAdd_、ptStats_、PT。
 */
const NB_QUIZ = [
  { q: '不確定 557 現在在哪裡上車，最可靠的方法是？', a: ['問路人', '傳「557 在哪裡搭」給我', '照去年的位置'], ok: 1 },
  { q: '隊伍被馬路切成兩段，你應該？', a: ['接在隊伍最後面', '從斷開的地方排進去', '站到車門旁邊等'], ok: 0 },
  { q: '557 太擠擠不上去，還可以怎麼辦？', a: ['只能等下一班 557', '搭其他公車到錢穆故居站再走進學校', '放棄上課'], ok: 1 },
];

function nbIntro_() {
  const video = PROPS.getProperty('NEWBIE_VIDEO_URL');
  return choices_([
    '🎒 第一次搭 557？三件事先知道',
    '',
    '1️⃣ 上車地點會調整：捷運施工期間站牌搬過家，傳「557 在哪裡搭」看最新位置。',
    '2️⃣ 排隊看清楚：隊伍可能被馬路切成兩段，請接在最後面。',
    '3️⃣ 不一定要等 557：士林站有其他公車到錢穆故居站，走進學校大約 10 分鐘。傳「幫我比較路線」就知道哪一班最快。',
  ].concat(video ? ['', '🎬 一分鐘教學短片：' + video] : [])
    .concat(['', '看完做個小測驗，全對有 ' + PT.QUIZ + ' 分，還能解鎖第一個成就 👇']).join('\n'),
  [['新生測驗', '新生測驗'], ['557 在哪裡搭', '557 在哪裡搭'], ['排隊禮儀', '排隊禮儀']]);
}

function nbEtiquette_() {
  return choices_([
    '🙋 排隊禮儀：一起排好，大家都快',
    '',
    '・隊伍被馬路切斷時，接在最後面，不要從斷開的地方排進去。',
    '・前門、後門各一排時，先看清楚自己排的是哪一排。',
    '・車來了依序上車，後面的人不往前擠。',
    '・擠不上去就等下一班，或改搭其他公車到錢穆故居站。',
    '',
    '這份宣導只講規則，不點名、不拍攝任何人。',
  ].join('\n'), [['557 在哪裡搭', '557 在哪裡搭'], ['幫我比較路線', '幫我比較路線']]);
}

// ===== 新生測驗 =====

/** 「新生測驗」從第一題開始；「答 1」「答 2」「答 3」回答目前這一題。進度放在快取，30 分鐘沒答完就重來 */
function nbQuiz_(uid, text) {
  const cache = CacheService.getScriptCache();
  const m = text.match(/^答\s*([1-3])$/);
  const saved = m && cache.get('quiz_' + uid);
  if (!saved) return nbAsk_(uid, 0, 0);

  const state = JSON.parse(saved);
  const item = NB_QUIZ[state.i];
  const right = Number(m[1]) - 1 === item.ok;
  const score = state.score + (right ? 1 : 0);
  const feedback = right ? '⭕ 答對了！' : '❌ 正確答案是「' + item.a[item.ok] + '」。';
  if (state.i + 1 < NB_QUIZ.length) {
    return nbAsk_(uid, state.i + 1, score, feedback);
  }
  cache.remove('quiz_' + uid);
  cpSheet_('測驗紀錄', ['時間', '使用者 ID', '答對題數']).appendRow([cpNow_(), uid, score]);
  if (score < NB_QUIZ.length) {
    return choices_(feedback + '\n\n測驗結束：答對 ' + score + '/' + NB_QUIZ.length + ' 題。全對才有積分，再試一次吧！', [['新生測驗', '新生測驗']]);
  }
  // 全對只送一次積分
  const first = ptStats_(uid).測驗 === 0;
  const fresh = first ? ptAdd_(uid, '測驗', PT.QUIZ, 0, '新生測驗全對') : [];
  return feedback + '\n\n🎉 全部答對！' + (first ? '+' + PT.QUIZ + ' 分' : '（積分之前領過了）') + ptBadgeText_(fresh);
}

/** 出第 i 題。feedback 是上一題答對或答錯的說明，放在題目前面。三個選項是三顆按鈕，選項就寫在按鈕上 */
function nbAsk_(uid, i, score, feedback) {
  CacheService.getScriptCache().put('quiz_' + uid, JSON.stringify({ i: i, score: score }), 30 * 60);
  const item = NB_QUIZ[i];
  return choices_((feedback ? feedback + '\n\n' : '') + item.q,
    item.a.map((a, k) => [a, '答 ' + (k + 1)]),
    { title: '第 ' + (i + 1) + ' 題／共 ' + NB_QUIZ.length + ' 題', badge: '新生測驗', primary: false, menu: false });
}

// ===== 學生自組包車（43）：還在調查需求 =====

function charterText_(uid, text) {
  if (text.trim() === '包車 我有興趣') {
    cpSheet_('意願紀錄', ['時間', '使用者 ID', '項目', '內容']).appendRow([cpNow_(), uid, '包車', '有興趣']);
    return '收到！你的意願記下來了，包車確定開辦時會通知有訂閱提醒的同學。';
  }
  const survey = PROPS.getProperty('SURVEY1_URL'); // 問卷表單.gs「建立通勤問卷」存的網址
  return choices_([
    '🚐 學生自組包車（規劃中）',
    '',
    '想法：固定在尖峰時段從士林站直達校園，用學期訂閱制。',
    '目前在調查需求，還沒有發車。開辦前會先確認合法的業者和保險。',
  ].concat(survey ? ['', '願意付多少、需要哪些時段，請填問卷：' + survey] : []).join('\n'),
  [['我有興趣', '包車 我有興趣'], ['訂閱提醒', '訂閱提醒']]);
}

// ============================================================================
// 晚上提醒.gs
// ============================================================================

/**
 * 晚上提醒：雨天預警（6）＋考試週預警（7）
 *
 * 每晚 9 點檢查明天早上會不會下雨、是不是考試週，有一項成立就推播給有訂閱的人。
 * LINE 免費方案每月只能主動推播 200 則（以人次計算），所以：
 *   - 只發給傳過「訂閱提醒」的人
 *   - 雨天和考試週合併成一則
 *   - 明天是週末、放假就不發；額度不夠也不發
 *
 * 第一次使用：在編輯器執行一次「設定晚上提醒排程」。
 */
const RAIN_ALERT_POP = 60;    // 降雨機率 ≥ 這個數字才提醒
const REMIND_HOUR = 21;       // 每晚幾點檢查

// ===== 排程每晚執行 =====

function 晚上提醒() {
  // 一天只跑一次：這個函式公開網頁也呼叫得到（見 Code.gs 的 tooSoon_），不能讓人重複觸發把推播額度用光
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (PROPS.getProperty('REMIND_LAST_DAY') === today) return;
  PROPS.setProperty('REMIND_LAST_DAY', today);

  const result = buildReminder_(addMin_(new Date(), 24 * 60));
  if (!result.message) {
    logPush_('不用提醒', result.pop, result.event, 0, result.reason);
    return;
  }
  sendToSubscribers_(result, '晚上提醒');
}

/** 檢查某一天要不要提醒，回傳 { message, pop, event, reason } */
function buildReminder_(day) {
  const weekday = Number(Utilities.formatDate(day, TZ, 'u')); // 1=週一 … 7=週日
  const dateText = Utilities.formatDate(day, TZ, 'M/d');
  if (weekday >= 6) return { reason: dateText + ' 是週末' };

  const event = calendarEvent_(day); // 比較器.gs：[開始, 結束, 類型, 名稱, 影響]
  if (event && event[2] === '放假') return { reason: dateText + ' ' + event[3] + '放假', event: event[3] };

  const pop = rainPop_(timeOn_(day, '07:30')); // 比較器.gs：上學尖峰那一格的降雨機率
  const isRain = pop >= RAIN_ALERT_POP;
  const isExam = event && event[2] === '考試';
  if (!isRain && !isExam) {
    return { reason: '降雨機率 ' + pop + '%，不是考試週', pop: pop, event: event ? event[3] : '' };
  }

  const lines = ['🔔 明天（' + dateText + '）上學提醒', ''];
  if (isRain) {
    lines.push('☔ 早上降雨機率 ' + pop + '%');
    lines.push('下雨天 557 會比平常擠，建議早 10 分鐘出門、記得帶傘。');
  }
  if (isExam) {
    if (isRain) lines.push('');
    lines.push('📝 ' + event[3] + '期間，搭車的人會比較集中。');
  }
  lines.push('');
  lines.push('💡 士林站有 13 條公車跟 557 走一樣的路到錢穆故居站，不一定要等 557。');

  return {
    title: '明天（' + dateText + '）上學提醒',
    message: lines.slice(2).join('\n'),
    buttons: [['排明天的出門時間', '出門時間 明天'], ['預約共乘', '共乘 去學校 預約'], ['不想收提醒', '取消提醒']],
    pop: pop, event: isExam ? event[3] : '', reason: isRain && isExam ? '下雨＋考試週' : isRain ? '下雨' : '考試週',
  };
}

// ===== 訂閱 =====

function subscribe_(userId, on) {
  const sheet = subscriberSheet_();
  const rows = sheet.getDataRange().getValues();
  const i = rows.findIndex(r => r[0] === userId);
  if (i > 0) {
    sheet.getRange(i + 1, 2, 1, 2).setValues([[on ? '訂閱中' : '已取消', new Date()]]);
  } else {
    sheet.appendRow([userId, on ? '訂閱中' : '已取消', new Date()]);
  }
  return on
    ? '✅ 訂閱成功！\n\n明天早上會下雨、或是考試週的時候，我會在前一晚 9 點提醒你。\n沒事的晚上不會打擾你 🙂\n\n不想收了就傳「取消提醒」。'
    : '已取消提醒 👋\n想再收的話傳「訂閱提醒」就好。';
}

function subscribers_() {
  return subscriberSheet_().getDataRange().getValues().slice(1)
    .filter(r => r[1] === '訂閱中')
    .map(r => r[0]);
}

function subscriberSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('訂閱');
  if (!sheet) {
    sheet = ss.insertSheet('訂閱');
    sheet.appendRow(['使用者 ID', '狀態', '更新時間']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ===== 推播 =====

function sendToSubscribers_(result, kind) {
  const to = subscribers_();
  if (!to.length) {
    logPush_(kind, result.pop, result.event, 0, '沒有人訂閱');
    return;
  }
  const left = pushQuotaLeft_();
  if (left < to.length) {
    logPush_(kind, result.pop, result.event, 0, '額度不夠：剩 ' + left + ' 則，要發 ' + to.length + ' 人');
    return;
  }

  // multicast 一次最多 500 人
  for (let i = 0; i < to.length; i += 500) {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
      payload: JSON.stringify({
        to: to.slice(i, i + 500),
        messages: [choices_(result.message, result.buttons || [['全部功能', '選單']], { title: result.title, menu: false })], // 卡片.gs
      }),
    });
  }
  logPush_(kind, result.pop, result.event, to.length, result.reason + '，已發送（剩 ' + (left - to.length) + ' 則）');
}

/** 這個月還能主動推播幾則 */
function pushQuotaLeft_() {
  const get = path => JSON.parse(UrlFetchApp.fetch('https://api.line.me/v2/bot/message/' + path, {
    headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
  }).getContentText());
  const quota = get('quota');
  if (quota.type === 'none') return Infinity;
  return quota.value - get('quota/consumption').totalUsage;
}

/** 每晚的檢查結果都記一筆，之後可以跟現場計數對照：下雨天到底有沒有比較擠 */
function logPush_(kind, pop, event, count, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('推播紀錄');
  if (!sheet) {
    sheet = ss.insertSheet('推播紀錄');
    sheet.appendRow(['時間', '類型', '明早降雨機率', '行事曆', '發送人數', '說明']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), kind, pop == null ? '' : pop, event || '', count, note]);
}

// ===== 在編輯器裡手動執行 =====

/** 執行一次就好：設定每晚 9 點自動執行「晚上提醒」（重複執行不會重複設定） */
function 設定晚上提醒排程() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === '晚上提醒')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('晚上提醒').timeBased().everyDays(1).atHour(REMIND_HOUR).inTimezone(TZ).create();
  console.log('✅ 已設定：每天 ' + REMIND_HOUR + ':00～' + (REMIND_HOUR + 1) + ':00 之間執行「晚上提醒」');
}

/** 只印出來、不發送：看看未來幾天各會不會提醒 */
function 測試晚上提醒() {
  if (tooSoon_('測試晚上提醒', 60)) return; // Code.gs：公開網頁也呼叫得到，一分鐘只跑一次
  for (let d = 1; d <= 3; d++) {
    const day = addMin_(new Date(), d * 24 * 60);
    const r = buildReminder_(day);
    console.log('【' + Utilities.formatDate(day, TZ, 'M/d（E）') + '】' + (r.message ? '會提醒（' + r.reason + '）\n' + r.message : '不提醒：' + r.reason));
  }
  // 11/9 期中考第一天，確認考試週的訊息
  const exam = buildReminder_(new Date('2026-11-09T12:00:00+08:00'));
  console.log('【11/9 期中考】' + (exam.message ? '\n' + exam.message : exam.reason));
  console.log('目前訂閱人數：' + subscribers_().length + '，本月剩餘推播額度：' + pushQuotaLeft_());
}

/** 不管有沒有下雨，強制發一則測試訊息給所有訂閱的人（會用掉額度，測試時才用） */
function 試發給訂閱者() {
  // 要先在指令碼屬性把 ALLOW_TEST_PUSH 設成 1 才會發，發完自動關掉，避免被公開網頁拿來刷推播額度
  if (PROPS.getProperty('ALLOW_TEST_PUSH') !== '1') {
    console.log('沒有發送。要試發的話：專案設定 → 指令碼屬性 → 新增 ALLOW_TEST_PUSH，值填 1，再執行一次。');
    return;
  }
  PROPS.setProperty('ALLOW_TEST_PUSH', '0');
  sendToSubscribers_({
    message: '🧪 這是測試訊息\n\n如果你收到這則，代表晚上提醒可以正常推播 🎉',
    reason: '手動測試',
  }, '手動測試');
}

// ============================================================================
// 每日報表.gs
// ============================================================================

/**
 * 每日報表（模組六）：每天晚上把當天的紀錄整理成一封信，寄給德育中心和軍訓室
 *
 * 內容：多少人用 Bot、問了什麼、比較器被問的上課時段、共乘成團數、步行／騎車／早到／借傘、
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
  '借傘', '新訂閱', '少排放（公克）', '最多人問的上課時間', '摘要'];

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
  const umbrellas = onDay('雨傘', 4);
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
    walk: count(trips, 2, '步行'),
    bike: count(trips, 2, '騎車'),
    early: count(trips, 2, '早到'),
    umbrellas: umbrellas.length,
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
    ['步行（錢穆故居站 → 校內）', r.walk + ' 次'], ['騎 YouBike', r.bike + ' 次'], ['7:30 前到校', r.early + ' 次'],
    ['借傘', r.umbrellas + ' 次'], ['新訂閱提醒', r.newSubs + ' 人'], ['少排放', (r.co2 / 1000).toFixed(2) + ' 公斤 CO₂'],
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
    r.walk, r.bike, r.early, r.umbrellas, r.newSubs, Math.round(r.co2), r.topTime, r.summary]);
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

// ============================================================================
// 比較器.gs
// ============================================================================

/**
 * 多路線比較器（15）＋文湖線分流（16）
 *
 * 學生說「8 點在 D 棟上課」，比較 557 和其他公車，告訴他幾點出門、搭哪一條。
 * 路線清單是 2026-10-09 用 TDX StopOfRoute 查的：
 * 從捷運士林站(中正)出發，13 條公車跟 557 走同樣 6 站到錢穆故居站，557、300 再多一站進校園。
 * 車程是估計值，之後用「行車時間紀錄器」的真實資料校正。
 */
const QIAN = '東吳大學(錢穆故居)';
const CAMPUS = '東吳大學';

const ORIGINS = {
  士林站: {
    stop: '捷運士林站(中正)',
    routes: [
      ['557', 0, CAMPUS], ['300', 1, CAMPUS], ['通勤30', 1, CAMPUS],
      ['255', 1, QIAN], ['255區', 0, QIAN], ['304承德', 1, QIAN], ['304重慶', 1, QIAN],
      ['680', 1, QIAN], ['683', 0, QIAN], ['683預', 0, QIAN], ['957', 0, QIAN],
      ['北環幹線', 0, QIAN], ['紅30', 1, QIAN], ['小18', 0, QIAN], ['小19', 0, QIAN], ['市民小巴1', 0, QIAN],
    ],
    rideMin: { [QIAN]: 10, [CAMPUS]: 12 },
  },
  劍南路站: {
    stop: '捷運劍南路站',
    routes: [['268', 0, QIAN], ['681', 0, QIAN], ['683', 1, QIAN], ['683預', 1, QIAN], ['957', 1, QIAN], ['北環幹線', 1, QIAN]],
    rideMin: { [QIAN]: 8 },
  },
  大直站: {
    stop: '捷運大直站',
    routes: [['680', 0, QIAN]],
    rideMin: { [QIAN]: 12 },
  },
};

// 代號: [名稱, 別名, 從校內 557 站步行分鐘, 從錢穆故居站步行分鐘]（地圖估計，之後換成實測）
const BUILDINGS = {
  A: ['寵惠堂', '行政大樓', 1, 6], B: ['綜合大樓', '綜大', 2, 5], C: ['愛徒樓', '安素堂', 4, 3],
  D: ['第二教學研究大樓', '二教 松怡廳', 3, 4], E: ['汽機車停車場', '停車場', 2, 7], F: ['文化樓', '', 4, 8],
  G: ['戴蓀堂', '', 3, 7], H: ['哲生樓', '', 5, 8], I: ['光道廳', '', 5, 9], J: ['研討室', '', 5, 9],
  K: ['心理學系實驗室', '心理實驗室', 6, 9], L: ['心理學系', '心理系', 5, 9], M: ['超庸館', '', 6, 10],
  N: ['圖書館', '', 6, 8], P: ['雷德樓', '教師研究一樓', 6, 10], Q: ['教師研究二樓', '', 7, 8],
  R: ['第一教學研究大樓', '一教', 8, 10], S: ['楓雅學苑', '', 9, 9], T: ['東荊學廬', '', 10, 10],
  U: ['東桂學廬', '', 9, 11], 1: ['榕華樓', '', 8, 11], 2: ['柚芳樓', '', 8, 10], 3: ['松勁樓', '', 9, 9],
  4: ['教職員宿舍', '', 10, 10], 5: ['文舍', '', 8, 7], 6: ['德舍', '', 9, 7],
};

const PERIODS = {
  1: '08:10', 2: '09:10', 3: '10:10', 4: '11:10', E: '12:10', 5: '13:10', 6: '14:10',
  7: '15:10', 8: '16:10', 9: '17:10', A: '18:25', B: '19:20', C: '20:20', D: '21:15',
};

// 學校的劍南路站師生專車：上課日 07:50 從捷運劍南路站發車，到 A 棟前（德育中心 115-1 時刻表，不適用 T-PASS）
const JIANNAN_SHUTTLE = '07:50';

const BUFFER_MIN = 5;      // 提早幾分鐘到教室
const PEAK_EXTRA_MIN = 10; // 尖峰 557 可能擠不上，要多等一兩班

// ===== 主流程 =====

function compareReply_(text) {
  const q = parseQuestion_(text);
  if (q.intent === '回家') return busReply_(1, ['東吳大學(錢穆故居)'], '557 東吳 → 士林');
  if (q.intent === '天氣') return rainReply_();
  if (q.intent === '站牌') return stationReply_(); // 站位變更.gs
  if (q.intent === '其他' && !q.building && !q.arriveTime) return menuUnknown_(); // 選單.gs：看不懂就給按鈕
  return compareQuery_(q, text);
}

/** q 是整理好的問題：{ arriveTime, building, day, origin }。打字問的和用按鈕點的（選單.gs）都走這裡 */
function compareQuery_(q, text) {
  const origin = ORIGINS[q.origin] ? q.origin : '士林站';
  const building = BUILDINGS[q.building] ? q.building : '';
  const now = new Date();
  const classAt = q.arriveTime ? timeOn_(q.day === '明天' ? addMin_(now, 24 * 60) : now, q.arriveTime) : null;

  // 上課時間還很久（或是明天）→ 給出門建議；快到了 → 查即時到站
  const planAhead = classAt && (classAt - now) > 90 * 60 * 1000;
  const answer = planAhead
    ? planReply_(origin, building, classAt, q.day === '明天')
    : liveReply_(origin, building, classAt);

  logCompare_(text, origin, building, classAt, planAhead ? '出門建議' : '即時');
  return answer;
}

/** 即時模式：查出發站所有路線的到站時間，算出各條到教室的時間 */
function liveReply_(originName, building, classAt) {
  const o = ORIGINS[originName];
  const etas = etaAtStop_(o.stop);
  const now = new Date();
  const target = building ? building + ' 棟' : '東吳大學';
  const head = { badge: '多路線比較', title: originName + ' → ' + target, subtitle: building ? BUILDINGS[building][0] : '' };

  const options = [];
  o.routes.forEach(([route, dir, dest]) => {
    const e = etas.find(x => x.RouteName.Zh_tw === route && x.Direction === dir);
    if (!e || e.EstimateTime == null) return;
    const waitMin = Math.max(0, Math.round(e.EstimateTime / 60));
    const walk = walkMin_(building, dest);
    const total = waitMin + o.rideMin[dest] + walk;
    options.push({ route, dest, waitMin, walk, arrive: addMin_(now, total) });
  });

  if (!options.length) {
    return card_(Object.assign(head, { // 卡片.gs
      notes: ['現在 ' + o.stop + ' 沒有車往東吳的即時資料，可能是末班車已過或還沒發車。'],
      footer: 'TDX 即時資料・' + nowText_(),
      buttons: [{ label: '找人共乘', text: '共乘' }, { label: '排明天的出門時間', text: '出門時間 明天' }],
    }));
  }
  options.sort((a, b) => a.arrive - b.arrive);

  const rows = options.slice(0, 4).map((opt, i) => ({
    label: opt.route,
    value: (opt.waitMin <= 1 ? '即將進站' : opt.waitMin + ' 分鐘後') + '・' + fmt_(opt.arrive) + ' 到',
    sub: (opt.dest === CAMPUS ? '直接進校園' : '錢穆故居站下車') + (building ? '，走 ' + opt.walk + ' 分鐘' : '')
      + (classAt && opt.arrive > classAt ? '（會遲到）' : ''),
    best: i === 0,
  }));

  const notes = [];
  const warns = [];
  const best = options[0];
  const bus557 = options.find(x => x.route === '557');
  if (originName === '士林站' && best.route !== '557') {
    notes.push(best.route + ' 跟 557 走一樣的路，到錢穆故居站下車就好，不用擠 557。');
  } else if (originName === '士林站' && bus557 && isPeak_(now)) {
    warns.push('現在是尖峰，557 可能擠不上。其他車到錢穆故居站下車也一樣。');
  }
  if (classAt && best.arrive > classAt) warns.push(fmt_(classAt) + ' 上課，最快的車也會遲到。可以考慮共乘。');


  return card_(Object.assign(head, {
    rows: rows,
    notes: notes,
    warns: warns,
    footer: (classAt ? fmt_(classAt) + ' 上課・' : '') + 'TDX 即時資料・' + nowText_() + '・車程為估計值',
    buttons: [{ label: '找人共乘', text: '共乘' }, { label: '算到教室的時間', text: '出門時間 今天' }, { label: '557 在哪裡搭', text: '557 在哪裡搭' }],
  }));
}

/** 出門建議模式：上課時間還很久，用預估車程往回推 */
function planReply_(originName, building, classAt, isTomorrow) {
  const o = ORIGINS[originName];
  const mustArrive = addMin_(classAt, -BUFFER_MIN);
  const extra = crowdExtra_(classAt);
  const peak = isPeak_(addMin_(classAt, -30));
  const rows = [];

  if (originName === '士林站') {
    const by557 = addMin_(mustArrive, -(o.rideMin[CAMPUS] + walkMin_(building, CAMPUS) + (peak ? PEAK_EXTRA_MIN : 0) + extra.min));
    const byOther = addMin_(mustArrive, -(o.rideMin[QIAN] + walkMin_(building, QIAN) + 5 + extra.min));
    rows.push({ label: '搭 557 進校園', value: fmt_(by557) + ' 前到士林站',
      sub: peak ? '尖峰可能要等一兩班，已多算 ' + PEAK_EXTRA_MIN + ' 分鐘' : '' });
    rows.push({ label: '搭其他車', value: fmt_(byOther) + ' 前到士林站',
      sub: '255、304、紅30、683、957、北環幹線… 哪班先來搭哪班，到錢穆故居站下車' + (building ? '，走 ' + walkMin_(building, QIAN) + ' 分鐘' : '') });
  } else {
    const by = addMin_(mustArrive, -(o.rideMin[QIAN] + walkMin_(building, QIAN) + 5 + extra.min));
    rows.push({ label: o.stop, value: fmt_(by) + ' 前到站',
      sub: '搭 ' + o.routes.map(r => r[0]).join('、') + ' 到錢穆故居站' + (building ? '，走 ' + walkMin_(building, QIAN) + ' 分鐘' : '') });
    // 學校專車進校園到 A 棟前，用「從校內站走過去」的時間估
    const shuttle = timeOn_(classAt, JIANNAN_SHUTTLE);
    const shuttleArrive = addMin_(shuttle, o.rideMin[QIAN] + 2 + walkMin_(building, CAMPUS));
    const weekday = Number(Utilities.formatDate(classAt, TZ, 'u')) <= 5;
    if (originName === '劍南路站' && weekday && shuttleArrive <= mustArrive) {
      rows.push({ label: '學校專車', value: JIANNAN_SHUTTLE + ' 發車',
        sub: '約 ' + fmt_(shuttleArrive) + ' 到教室。在【捷運劍南路站】站牌（往自強隧道方向）上車，不適用 T-PASS' });
    }
  }
  rows[0].best = true;

  return card_({ // 卡片.gs
    badge: '出門建議',
    title: (isTomorrow ? '明天 ' : '今天 ') + fmt_(classAt) + ' 上課',
    subtitle: building ? building + ' 棟 ' + BUILDINGS[building][0] : '',
    rows: rows,
    warns: extra.reasons.length ? [extra.reasons.join('、') + '，已多算 ' + extra.min + ' 分鐘。'] : [],
    footer: '依預估車程推算，出門前按「現在最快的車」可以看即時到站',
    buttons: [{ label: '預約共乘', text: originName === '士林站' ? '共乘 去學校 預約' : '共乘' }]
      // 換出發站、換時間都用按的（選單.gs 的「出門時間」流程）
      .concat(Object.keys(ORIGINS).filter(name => name !== originName).map(name => ({
        label: '改從' + name + '出發',
        text: ['出門時間', isTomorrow ? '明天' : '今天', fmt_(classAt), building || '不指定', name].join(' '),
      })))
      .concat([{ label: '換一個時間', text: '出門時間' }, { label: '現在最快的車', text: '幫我比較路線' }]),
  });
}

// ===== 解析學生的問題 =====

/**
 * Gemini 免費版每分鐘只能叫幾次（gemini-3.5-flash 是 5 次），尖峰很容易用完，
 * 所以規則看得懂的句子（有時間或大樓、回家、天氣、站牌）就不叫 Gemini，看不懂的才交給它。
 */
function parseQuestion_(text) {
  const byRules = parseWithRules_(text);
  if (byRules.arriveTime || byRules.building || byRules.intent !== '其他') return byRules;
  return parseWithGemini_(text) || byRules;
}

function parseWithGemini_(text) {
  const key = PROPS.getProperty('GEMINI_API_KEY');
  if (!key) return null;
  const buildingList = Object.keys(BUILDINGS).map(k => k + '=' + BUILDINGS[k][0] + (BUILDINGS[k][1] ? '/' + BUILDINGS[k][1] : '')).join('、');
  const periodList = Object.keys(PERIODS).map(k => '第' + k + '節=' + PERIODS[k]).join('、');
  const body = {
    contents: [{ parts: [{ text: text }] }],
    systemInstruction: { parts: [{ text:
      '你是東吳大學外雙溪校區的通勤小幫手，把學生的訊息整理成 JSON。\n'
      + '大樓代號：' + buildingList + '\n節次：' + periodList + '。早八=08:10。\n'
      + '說「8點上課」就用 08:00。沒提到的欄位填空字串。出發地只能是：士林站、劍南路站、大直站，沒提到填空字串。\n'
      + '問公車在哪裡上車、站牌在哪、要去哪裡排隊，intent 填「站牌」。' } ] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          intent: { type: 'STRING', enum: ['去學校', '回家', '天氣', '站牌', '其他'] },
          arriveTime: { type: 'STRING', description: '要抵達的時間 HH:MM' },
          building: { type: 'STRING', description: '大樓代號' },
          day: { type: 'STRING', enum: ['今天', '明天', '未指定'] },
          origin: { type: 'STRING' },
        },
        required: ['intent', 'arriveTime', 'building', 'day', 'origin'],
      },
    },
  };
  try {
    const call = model => UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    // 先用 lite（免費額度比較多），超過額度（429）或塞車（503）再換 flash
    let res = call('gemini-3.5-flash-lite');
    if (res.getResponseCode() !== 200) res = call('gemini-3.5-flash');
    if (res.getResponseCode() !== 200) {
      console.error('Gemini ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
      return null;
    }
    const q = JSON.parse(JSON.parse(res.getContentText()).candidates[0].content.parts[0].text);
    q.building = String(q.building || '').toUpperCase();
    return q;
  } catch (err) {
    console.error(err);
    return null;
  }
}

/** Gemini 不能用時的備案：用規則抓時間、大樓、出發地 */
function parseWithRules_(text) {
  const CN = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const t = text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // 「八點半」「十點」「十一點」→ 8點半、10點、11點
    .replace(/(十?[一二兩三四五六七八九]|十)(?=\s*點)/g, m => String(m === '十' ? 10 : m[0] === '十' ? 10 + CN[m[1]] : CN[m]));
  let arriveTime = '';
  const period = t.match(/第\s*([1-9A-E一二三四五六七八九])\s*節/i);
  const clock = t.match(/(\d{1,2})\s*[:：點]\s*(\d{1,2}|半)?/);
  if (/早八/.test(t)) arriveTime = '08:10';
  else if (period) arriveTime = PERIODS[CN[period[1]] || period[1].toUpperCase()];
  else if (clock) {
    let hour = Number(clock[1]);
    if (hour < 7) hour += 12; // 最早的課 8:10，「兩點」「6點」一定是下午
    const minute = clock[2] === '半' ? 30 : Number(clock[2] || 0);
    arriveTime = ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2);
  }

  let building = '';
  const code = t.match(/([A-U1-6])\s*棟/i);
  if (code) building = code[1].toUpperCase();
  else {
    Object.keys(BUILDINGS).some(k => {
      const names = [BUILDINGS[k][0]].concat(BUILDINGS[k][1].split(' ').filter(Boolean));
      if (names.some(n => t.indexOf(n) >= 0)) { building = k; return true; }
      return false;
    });
  }

  let intent = '其他';
  if (/回家|回程|下課/.test(t)) intent = '回家';
  else if (/雨|天氣|傘/.test(t)) intent = '天氣';
  else if (/站牌|上車|排隊|出口|去哪|哪(裡|邊|兒)/.test(t) && !arriveTime && !building) intent = '站牌';
  else if (arriveTime || building || /上課|學校|出門|東吳|怎麼去/.test(t)) intent = '去學校';

  return {
    intent: intent,
    arriveTime: arriveTime,
    building: building,
    day: /明天|明早/.test(t) ? '明天' : '未指定',
    origin: /劍南/.test(t) ? '劍南路站' : /大直/.test(t) ? '大直站' : '',
  };
}

// ===== 小工具 =====

/** 一次抓出發站所有路線的到站時間（快取 30 秒，避免 TDX 限流） */
function etaAtStop_(stopName) {
  const cache = CacheService.getScriptCache();
  const key = 'eta_' + Utilities.base64EncodeWebSafe(stopName);
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  const filter = "StopName/Zh_tw eq '" + stopName + "'";
  const etas = tdx_('EstimatedTimeOfArrival/City/Taipei?$format=JSON&$select=RouteName,Direction,EstimateTime,StopStatus&$filter=' + encodeURIComponent(filter));
  cache.put(key, JSON.stringify(etas), 30);
  return etas;
}

function walkMin_(building, dest) {
  if (!building) return 0;
  return BUILDINGS[building][dest === CAMPUS ? 2 : 3];
}

/** 下雨、考試週要多留時間 */
function crowdExtra_(when) {
  const reasons = [];
  let min = 0;
  try {
    const rain = rainPop_(when);
    if (rain >= 60) { reasons.push('降雨機率 ' + rain + '%'); min += 10; }
  } catch (err) { console.error(err); }
  const event = calendarEvent_(when);
  if (event && event[2] === '考試') { reasons.push(event[3]); min += 10; }
  return { min: min, reasons: reasons };
}

/** 讀「行事曆」分頁，找這一天的事件：[開始, 結束, 類型, 名稱, 影響] */
function calendarEvent_(when) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('行事曆');
  if (!sheet) return null;
  const day = Utilities.formatDate(when, TZ, 'yyyy-MM-dd');
  // 試算表可能把日期轉成 Date 或「2026/9/14」，統一成 yyyy-MM-dd 再比
  const toDay = v => v instanceof Date
    ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd')
    : String(v).replace(/(\d{4})\D(\d{1,2})\D(\d{1,2})/, (m, y, mo, d) => y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2));
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.find(r => toDay(r[0]) <= day && day <= toDay(r[1]) && r[2] !== '活動') || null;
}

/** 某個時間點所在的 3 小時降雨機率 */
function rainPop_(when) {
  const url = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-061'
    + '?Authorization=' + PROPS.getProperty('CWA_API_KEY')
    + '&LocationName=' + encodeURIComponent('士林區')
    + '&ElementName=' + encodeURIComponent('3小時降雨機率');
  const times = JSON.parse(UrlFetchApp.fetch(url).getContentText()).records.Locations[0].Location[0].WeatherElement[0].Time;
  const slot = times.find(t => new Date(t.StartTime) <= when && when < new Date(t.EndTime));
  return slot ? Number(slot.ElementValue[0].ProbabilityOfPrecipitation) : 0;
}

/** 學校公告的尖峰入校時段（德育中心 115-1 時刻表）：07:20–08:20、09:00–10:00，尖峰班距 4–6 分 */
function isPeak_(when) {
  const day = Number(Utilities.formatDate(when, TZ, 'u')); // 1=週一 … 7=週日
  const hm = Utilities.formatDate(when, TZ, 'HH:mm');
  return day <= 5 && ((hm >= '07:20' && hm <= '08:20') || (hm >= '09:00' && hm <= '10:00'));
}

function timeOn_(date, hhmm) {
  return new Date(Utilities.formatDate(date, TZ, 'yyyy-MM-dd') + 'T' + hhmm + ':00+08:00');
}

function addMin_(date, min) {
  return new Date(date.getTime() + min * 60 * 1000);
}

function fmt_(date) {
  return Utilities.formatDate(date, TZ, 'HH:mm');
}

/** 每次比較都記一筆，之後可以統計大家從哪裡出發、幾點上課（測試數據） */
function logCompare_(text, origin, building, classAt, mode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('比較器紀錄');
  if (!sheet) {
    sheet = ss.insertSheet('比較器紀錄');
    sheet.appendRow(['時間', '學生問的', '出發站', '大樓', '上課時間', '模式']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), text, origin, building, classAt ? fmt_(classAt) : '', mode]);
}

function 測試比較器() {
  if (tooSoon_('測試比較器', 60)) return; // Code.gs：公開網頁也呼叫得到，一分鐘只跑一次
  ['8點在D棟上課', '明天早八 H棟 我要幾點出門', '我從劍南路站出發，第三節在一教', '我現在要去學校'].forEach(t => {
    console.log('【' + t + '】\n' + plain_(compareReply_(t)) + '\n');
  });
}

// ============================================================================
// 積分.gs
// ============================================================================

/**
 * 積分帳本（模組四）：步行積分（11）、早到早餐券（4）、碳足跡看板（51）、通勤成就（35）
 *
 * 打卡不用 QR code（會被拍照外流），改用手機定位：
 *   在 LINE 傳「打卡」→ 打開打卡頁 → 手機回報位置 → 伺服器算離哪個打卡點最近。
 *   - 在錢穆故居站打卡：開始計時
 *   - 25 分鐘內走到校內再打一次：步行完成，加分、記減碳量
 *   - 7:30 前在校內打卡：早到早餐券（一天一次）
 * 只記打卡點名稱、距離和誤差，不記經緯度。
 *
 * 積分跟共乘共用「共乘用戶」分頁的「積分」欄；每一筆加分記在「通勤紀錄」。
 * 成就不另外存，每次從紀錄算出來。
 * 用到 Code.gs 的 PROPS、TZ，共乘.gs 的 cpUser_、cpSheet_、cpLocked_、cpNow_，定位測試.gs 的 GEO_POINTS。
 */
const PT = {
  WALK: 10,             // 錢穆故居站走進學校
  BIKE: 8,              // 騎 YouBike 到校
  EARLY: 5,             // 7:30 前到校
  QUIZ: 5,              // 新生測驗全對
  UMBRELLA: 3,          // 借傘後歸還
  WALK_MAX_MIN: 25,     // 起點打卡後幾分鐘內到校才算步行
  EARLY_BEFORE: '07:30',
  NEAR_M: 150,          // 離錢穆故居站多近算「在站牌」
  CAMPUS_M: 300,        // 離校內 557 站多近算「在學校」
  MAX_ACCURACY_M: 150,  // 定位誤差超過這個數字不收
  WALK_KM: 0.8,         // 錢穆故居站到校內，少搭的公車距離
  BIKE_KM: 3.5,         // 士林站到東吳
  // 市區公車（甲類）每人每公里 76.7 公克 CO₂e：環境部產品碳足跡資訊網，2017 年公告。
  // 這個數字是從引用該網站的文章查到的，放進簡報前要到產品碳足跡資訊網核對一次。
  BUS_G_PER_KM: 76.7,
};

const PT_START = '錢穆故居站';
const PT_CAMPUS = '校內 557 站';
const PT_LOG_HEAD = ['時間', '使用者 ID', '方式', '積分', '少排放（公克）', '備註'];
const PT_CHECKIN_HEAD = ['時間', '使用者 ID', '打卡點', '距離（公尺）', '誤差（公尺）', '結果'];

/** 成就：[名稱, 條件說明, 判斷] */
const PT_BADGES = [
  ['新生上路', '新生測驗全對', s => s.測驗 >= 1],
  ['走路達人', '從錢穆故居站走進學校 5 次', s => s.步行 >= 5],
  ['早鳥', '7:30 前到校 3 次', s => s.早到 >= 3],
  ['雨天英雄', '借過雨傘並歸還', s => s.還傘 >= 1],
  ['共乘夥伴', '完成 1 次計程車共乘', s => s.共乘 >= 1],
  ['減碳一公斤', '累積少排放 1 公斤 CO₂', s => s.減碳 >= 1000],
];

// ===== 加分、統計 =====

/** 加分並記一筆。回傳這次新拿到的成就名稱 */
function ptAdd_(uid, mode, points, co2, note) {
  const before = ptBadges_(ptStats_(uid));
  const user = cpUser_(uid);
  user.points += points;
  cpSaveUser_(user);
  cpSheet_('通勤紀錄', PT_LOG_HEAD).appendRow([cpNow_(), uid, mode, points, Math.round(co2 || 0), note || '']);
  return ptBadges_(ptStats_(uid)).filter(b => before.indexOf(b) < 0);
}

function ptStats_(uid) {
  const s = { 步行: 0, 騎車: 0, 早到: 0, 測驗: 0, 還傘: 0, 共乘: 0, 減碳: 0 };
  cpSheet_('通勤紀錄', PT_LOG_HEAD).getDataRange().getValues().slice(1).forEach(r => {
    if (r[1] !== uid) return;
    if (r[2] in s) s[r[2]] += 1;
    s.減碳 += Number(r[4]) || 0;
  });
  // 共乘的紀錄在共乘.gs 自己的分頁，「上車」和「獨行」都算完成一次
  cpSheet_('共乘紀錄', CP_LOG_HEAD).getDataRange().getValues().slice(1).forEach(r => {
    if (r[2] === uid && (r[5] === '上車' || r[5] === '獨行')) s.共乘 += 1;
  });
  return s;
}

function ptBadges_(stats) {
  return PT_BADGES.filter(b => b[2](stats)).map(b => b[0]);
}

function ptDoneToday_(uid, mode) {
  const today = Utilities.formatDate(cpNow_(), TZ, 'yyyy-MM-dd');
  return cpSheet_('通勤紀錄', PT_LOG_HEAD).getDataRange().getValues().slice(1)
    .some(r => r[1] === uid && r[2] === mode && Utilities.formatDate(new Date(r[0]), TZ, 'yyyy-MM-dd') === today);
}

function ptBadgeText_(fresh) {
  return fresh.length ? '\n\n🏅 解鎖成就：' + fresh.join('、') : '';
}

// ===== LINE 訊息 =====

/** 「打卡」：給一個按鈕打開打卡頁 */
function ptCheckinButton_(uid) {
  return choices_('在錢穆故居站先打一次，走進學校再打一次，就有步行積分。7:30 前到校還有早餐券。', // 卡片.gs
    [{ label: '打開打卡頁', uri: cpWebAppUrl_() + '?page=checkin&t=' + cpUser_(uid).token }, ['我的紀錄', '我的紀錄']],
    { title: '到校打卡', badge: '積分' });
}

/** 「我的紀錄」 */
function ptMine_(uid) {
  const user = cpUser_(uid);
  const s = ptStats_(uid);
  const have = ptBadges_(s);
  const badges = PT_BADGES.map(b => (have.indexOf(b[0]) >= 0 ? '🏅 ' + b[0] : '▫️ ' + b[0] + '（' + b[1] + '）'));
  return [
    '📒 我的通勤紀錄',
    '',
    '積分：' + user.points + ' 分　信用分：' + user.credit,
    '步行 ' + s.步行 + ' 次・騎車 ' + s.騎車 + ' 次・共乘 ' + s.共乘 + ' 次・早到 ' + s.早到 + ' 次',
    '累積少排放：' + (s.減碳 / 1000).toFixed(2) + ' 公斤 CO₂',
    '',
    '成就：',
  ].concat(badges).concat(['', '傳「打卡」開始累積，傳「全校減碳」看大家的成果。']).join('\n');
}

/** 「全校減碳」（51）：全部人的加總，對應 SDG 11、SDG 13 */
function ptSchool_() {
  const rows = cpSheet_('通勤紀錄', PT_LOG_HEAD).getDataRange().getValues().slice(1);
  const count = mode => rows.filter(r => r[2] === mode).length;
  const total = rows.reduce((sum, r) => sum + (Number(r[4]) || 0), 0);
  const people = Object.keys(rows.reduce((set, r) => { set[r[1]] = 1; return set; }, {})).length;
  const board = PROPS.getProperty('LOOKER_URL');
  return [
    '🌱 全校減碳看板',
    '',
    '大家一起少排放了 ' + (total / 1000).toFixed(2) + ' 公斤 CO₂',
    '參與人數：' + people + ' 人',
    '步行 ' + count('步行') + ' 次・騎車 ' + count('騎車') + ' 次',
    '',
    '（少搭的公車距離 × 市區公車每人每公里 ' + PT.BUS_G_PER_KM + ' 公克 CO₂e，環境部產品碳足跡資訊網）',
  ].concat(board ? ['', '完整看板：' + board] : []).join('\n');
}

/** 「騎車到校」：30 分鐘內要先在校內打過卡，一天一次 */
function ptBike_(uid) {
  return cpLocked_(() => {
    if (ptDoneToday_(uid, '騎車')) return '今天已經記過騎車到校了，明天繼續 🚲';
    if (ptDoneToday_(uid, '步行')) return '今天已經記過步行到校了，一天記一種方式就好 🙂';
    const now = cpNow_();
    const onCampus = cpSheet_('打卡紀錄', PT_CHECKIN_HEAD).getDataRange().getValues().slice(1)
      .some(r => r[1] === uid && r[2] === PT_CAMPUS && now - new Date(r[0]) < 30 * 60000);
    if (!onCampus) return ['請先在學校打卡，確認你到校了，再傳一次「騎車到校」。', ptCheckinButton_(uid)];
    const co2 = PT.BIKE_KM * PT.BUS_G_PER_KM;
    const fresh = ptAdd_(uid, '騎車', PT.BIKE, co2, 'YouBike');
    return '🚲 騎車到校 +' + PT.BIKE + ' 分\n少排放 ' + Math.round(co2) + ' 公克 CO₂' + ptBadgeText_(fresh);
  });
}

// ===== 打卡頁呼叫的函式（google.script.run） =====

/**
 * 打卡頁回報位置。這是公開網頁能呼叫的函式，所以每個參數都檢查格式。
 * 回傳 { ok, title, lines }，打卡頁直接顯示。
 */
function ptCheckin(token, lat, lng, accuracy) {
  if (!/^[0-9a-f-]{36}$/.test(String(token || ''))) return { ok: false, title: '連結失效', lines: ['請回 LINE 再傳一次「打卡」。'] };
  const ok = v => typeof v === 'number' && isFinite(v);
  if (!ok(lat) || !ok(lng) || !ok(accuracy) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { ok: false, title: '定位資料不正確', lines: ['請再試一次。'] };
  }
  return cpLocked_(() => {
    const user = cpUserByToken_(token);
    if (!user) return { ok: false, title: '連結失效', lines: ['請回 LINE 再傳一次「打卡」。'] };
    const cache = CacheService.getScriptCache();
    if (cache.get('checkin_' + user.id)) return { ok: false, title: '剛剛打過了', lines: ['一分鐘後再試。'] };
    cache.put('checkin_' + user.id, '1', 60);
    return ptCheckinAt_(user.id, [lat, lng], accuracy);
  });
}

function ptCheckinAt_(uid, here, accuracy) {
  const sheet = cpSheet_('打卡紀錄', PT_CHECKIN_HEAD);
  const now = cpNow_();
  const record = (spot, dist, result) => sheet.appendRow([now, uid, spot, Math.round(dist), Math.round(accuracy), result]);

  if (accuracy > PT.MAX_ACCURACY_M) {
    record('', 0, '誤差太大');
    return { ok: false, title: '定位不夠準', lines: ['誤差約 ' + Math.round(accuracy) + ' 公尺。走到室外、打開 GPS 再試一次。'] };
  }
  const dStart = ptMeters_(here, GEO_POINTS[PT_START]);
  const dCampus = ptMeters_(here, GEO_POINTS[PT_CAMPUS]);

  if (dStart <= PT.NEAR_M) {
    record(PT_START, dStart, '起點');
    return { ok: true, title: '錢穆故居站打卡成功', lines: ['開始計時！' + PT.WALK_MAX_MIN + ' 分鐘內走進學校再打一次卡，就有 ' + PT.WALK + ' 分。'] };
  }
  if (dCampus > PT.CAMPUS_M) {
    const nearer = dStart < dCampus ? [PT_START, dStart] : ['學校', dCampus];
    record('', nearer[1], '不在打卡點');
    return { ok: false, title: '不在打卡點附近', lines: ['離' + nearer[0] + '還有大約 ' + Math.round(nearer[1]) + ' 公尺。', '打卡點：錢穆故居站、校內。'] };
  }

  // 到校：看有沒有步行、有沒有早到
  const lines = [];
  let fresh = [];
  const started = sheet.getDataRange().getValues().slice(1)
    .filter(r => r[1] === uid && r[2] === PT_START && now - new Date(r[0]) <= PT.WALK_MAX_MIN * 60000).pop();
  if (started && !ptDoneToday_(uid, '步行') && !ptDoneToday_(uid, '騎車')) {
    const minutes = Math.max(1, Math.round((now - new Date(started[0])) / 60000));
    const co2 = PT.WALK_KM * PT.BUS_G_PER_KM;
    fresh = fresh.concat(ptAdd_(uid, '步行', PT.WALK, co2, minutes + ' 分鐘'));
    lines.push('🚶 走了 ' + minutes + ' 分鐘，步行 +' + PT.WALK + ' 分');
    lines.push('少排放 ' + Math.round(co2) + ' 公克 CO₂');
  }
  const hhmm = Utilities.formatDate(now, TZ, 'HH:mm');
  if (hhmm < PT.EARLY_BEFORE && !ptDoneToday_(uid, '早到')) {
    fresh = fresh.concat(ptAdd_(uid, '早到', PT.EARLY, 0, hhmm));
    lines.push('🌅 ' + hhmm + ' 到校，早到 +' + PT.EARLY + ' 分');
    lines.push('🎫 早餐券 EB-' + Utilities.formatDate(now, TZ, 'MMdd') + '-' + cpUser_(uid).row + '（今天 10:00 前有效，合作店家洽談中）');
  }
  if (!lines.length) lines.push('到校打卡成功。先在錢穆故居站打卡再走進來才有步行積分；7:30 前到校有早餐券。');
  if (fresh.length) lines.push('🏅 解鎖成就：' + fresh.join('、'));
  record(PT_CAMPUS, dCampus, lines.length > 1 || fresh.length ? '加分' : '到校');
  return { ok: true, title: '到校打卡成功', lines: lines.concat(['目前積分：' + cpUser_(uid).points + ' 分']) };
}

function ptMeters_(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function ptCheckinPage_(token) {
  return HtmlService.createHtmlOutput(PT_CHECKIN_HTML.replace('__TOKEN__', token).replace('__BOT__', CP_BOT_ID))
    .setTitle('到校打卡')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

const PT_CHECKIN_HTML = `<!doctype html>
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
  .big { font-size:24px; font-weight:700; margin:0 0 6px; }
  .ok { color:#0b6e4f; } .bad { color:#b42318; }
  .sub { color:#667085; font-size:14px; }
  p { margin:4px 0; }
</style>
</head>
<body>
<div class="card">
  <h1>到校打卡</h1>
  <div class="sub">只用你的位置判斷離哪個打卡點最近，不會記錄經緯度。手機問要不要允許定位時，請按允許。</div>
  <button id="go" onclick="run()">打卡</button>
</div>
<div class="card" id="out" style="display:none"></div>
<script>
var TOKEN = '__TOKEN__', BOT = '__BOT__';
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function show(ok, title, lines) {
  var out = document.getElementById('out');
  out.style.display = 'block';
  out.innerHTML = '<div class="big ' + (ok ? 'ok' : 'bad') + '">' + esc(title) + '</div>'
    + lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('')
    + '<a class="btn" href="https://line.me/R/oaMessage/' + encodeURIComponent(BOT) + '/?' + encodeURIComponent('我的紀錄') + '">回 LINE 看我的紀錄</a>';
  var btn = document.getElementById('go');
  btn.disabled = false; btn.textContent = '再打一次';
}
function run() {
  var btn = document.getElementById('go');
  if (!('geolocation' in navigator)) return show(false, '拿不到定位', ['這個瀏覽器不支援定位。']);
  btn.disabled = true; btn.textContent = '定位中…（最多 20 秒）';
  navigator.geolocation.getCurrentPosition(function (pos) {
    google.script.run
      .withSuccessHandler(function (r) { show(r.ok, r.title, r.lines); })
      .withFailureHandler(function () { show(false, '連線失敗', ['請再試一次。']); })
      .ptCheckin(TOKEN, pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy);
  }, function (err) {
    var why = { 1: '沒有允許定位。請到手機設定打開 LINE 的定位權限。', 2: '手機抓不到位置，走到室外再試一次。', 3: '等太久了，再試一次。' }[err.code] || '不明原因';
    show(false, '拿不到定位', [why]);
  }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}
</script>
</body>
</html>`;

// ============================================================================
// 站位變更.gs
// ============================================================================

/**
 * 站位變更推播（30）
 *
 * 每 6 小時檢查一次德育中心的「557、300、通勤30等路線公車及劍南路站師生專車」頁面，
 * 內容有變就用 Gemini 寫兩三句摘要，推播給有訂閱提醒的人，並記到「站位變更紀錄」。
 * 學生問「557 在哪裡搭」時，回覆最新的摘要（回覆不用額度）。
 *
 * 第一次使用：在編輯器執行一次「設定站位檢查排程」，它也會先記下現在的頁面當作比對基準。
 */
const STATION_PAGE_URL = 'https://web-ch.scu.edu.tw/life/web_page/2440';
const CHECK_EVERY_HOURS = 6;

// ===== 排程每 6 小時執行 =====

function 檢查站位變更() {
  const now = fetchStationPage_();
  const hash = md5_(now);
  const lastHash = PROPS.getProperty('STATION_PAGE_HASH');
  if (hash === lastHash) return;

  const sheet = stationSheet_();
  if (!lastHash) {
    saveStation_(sheet, now, hash, summarizeStation_(now), '建立比對基準', '');
    return;
  }

  const before = sheet.getRange(sheet.getLastRow(), 3).getValue();
  const diff = diffSummary_(before, now);
  const summary = summarizeStation_(now);
  if (!diff) {
    saveStation_(sheet, now, hash, summary, '頁面有改，但不是站位或時刻的變更', '');
    return;
  }

  const message = diff;
  sendToSubscribers_({ title: '557 上車資訊有更新', message: message, reason: '站位變更',
    buttons: [{ label: '看德育中心公告', uri: STATION_PAGE_URL }, ['最新的上車地點', '557 在哪裡搭']] }, '站位變更'); // 晚上提醒.gs
  saveStation_(sheet, now, hash, summary, '已推播', diff);
}

/** 抓頁面，只留內文（標題列、側邊選單、頁尾的「最後更新時間」都不算） */
function fetchStationPage_() {
  const html = UrlFetchApp.fetch(STATION_PAGE_URL).getContentText();
  const start = html.indexOf("content-txtbox-noshade");
  const end = html.indexOf('回到頁首', start);
  if (start < 0 || end < 0) throw new Error('德育中心頁面改版了，找不到內文，要更新 fetchStationPage_');
  const body = html.slice(start, end);
  // 附件和圖片的網址也算內容：換了時刻表 PDF 或排隊示意圖也要知道
  const links = [];
  body.replace(/(?:href|src)=["']([^"']+\.(?:pdf|jpe?g|png))["']/gi, (m, url) => links.push(url));
  const text = body
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split('\n').map(s => s.trim()).filter(Boolean).join('\n');
  return text.replace(/^[^\n]*\n/, '') + '\n\n附件：\n' + links.join('\n'); // 第一行是 class 名稱的殘渣
}

// ===== Gemini 摘要 =====

/** 比較新舊內容，有站位、排隊、時刻的實質變更才回摘要，否則回空字串 */
function diffSummary_(before, after) {
  const answer = gemini_(
    '以下是東吳大學德育中心公告「557 等公車上車資訊」的舊版和新版內容。'
    + '請用 2～3 句繁體中文，說明對學生搭車有影響的變更（上車站牌位置、排隊方式、班次時刻、停駛）。'
    + '如果只是排版、錯字、日期格式這種不影響搭車的修改，只回「無實質變更」四個字。\n\n'
    + '【舊版】\n' + before + '\n\n【新版】\n' + after
  );
  if (!answer) return '頁面內容有更新，請點連結查看。'; // Gemini 不能用時，寧可多通知一次
  return /無實質變更/.test(answer) ? '' : answer.trim();
}

/** 把整頁整理成學生看得懂的上車地點說明 */
function summarizeStation_(text) {
  const answer = gemini_(
    '以下是東吳大學德育中心公告的公車上車資訊。請整理成給學生看的 LINE 訊息，繁體中文，不超過 250 字，'
    + '分成「士林站」「士林國中站」「校內」三段，寫出 557 的上車地點和排隊方式；300、通勤30、劍南路站師生專車各用一行帶過。'
    + '不要用 Markdown 的 ** 或 #，可以用 📍 開頭。\n\n' + text
  );
  return answer ? answer.trim() : '';
}

function gemini_(prompt) {
  const key = PROPS.getProperty('GEMINI_API_KEY');
  if (!key) return '';
  const call = model => UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    muteHttpExceptions: true,
  });
  // 摘要要寫得好，先用 flash；免費版每分鐘只有 5 次，超過就換 lite
  let res = call('gemini-3.5-flash');
  if (res.getResponseCode() !== 200) res = call('gemini-3.5-flash-lite');
  if (res.getResponseCode() !== 200) {
    console.error('Gemini ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
    return '';
  }
  return JSON.parse(res.getContentText()).candidates[0].content.parts[0].text;
}

// ===== 學生問「在哪裡搭」 =====

function stationReply_() {
  const summary = PROPS.getProperty('STATION_SUMMARY');
  const checked = PROPS.getProperty('STATION_CHECKED_AT');
  const fallback = [
    { label: '捷運士林站', value: '中正路 205 號前', sub: '大成安心購前面' },
    { label: '士林國中站', value: '中正路 341 號前', sub: '富邦銀行士林分行前面。尖峰建議來這裡排', best: true },
    { label: '校內', value: '操場側站牌後', sub: '依藍線排隊' },
  ];
  return card_({ // 卡片.gs
    badge: '德育中心公告',
    title: '557 上車地點',
    rows: summary ? [] : fallback,
    notes: summary ? [summary] : [],
    footer: '來源：德育中心' + (checked ? '，' + checked + ' 更新' : ''),
    buttons: [{ label: '看德育中心公告', uri: STATION_PAGE_URL }, { label: '557 現在到哪了', text: '557' }],
  });
}

// ===== 紀錄 =====

function saveStation_(sheet, text, hash, summary, status, diff) {
  sheet.appendRow([new Date(), status, text, diff, summary]);
  PROPS.setProperty('STATION_PAGE_HASH', hash);
  if (summary) PROPS.setProperty('STATION_SUMMARY', summary);
  PROPS.setProperty('STATION_CHECKED_AT', Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
}

function stationSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('站位變更紀錄');
  if (!sheet) {
    sheet = ss.insertSheet('站位變更紀錄');
    sheet.appendRow(['時間', '狀態', '頁面內容', '變更摘要（推播內容）', '上車地點摘要']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function md5_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// ===== 在編輯器裡手動執行 =====

/** 執行一次就好：每 6 小時檢查一次，並先記下現在的頁面當基準 */
function 設定站位檢查排程() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === '檢查站位變更')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('檢查站位變更').timeBased().everyHours(CHECK_EVERY_HOURS).create();
  檢查站位變更();
  console.log('✅ 已設定：每 ' + CHECK_EVERY_HOURS + ' 小時檢查一次德育中心頁面');
  console.log(plain_(stationReply_()));
}

/** 不推播：假裝頁面改了，看 Gemini 會寫出什麼摘要 */
function 測試站位變更() {
  if (tooSoon_('測試站位變更', 60)) return; // Code.gs：公開網頁也呼叫得到，一分鐘只跑一次
  const now = fetchStationPage_();
  const fake = now.replace('中正路２０５號', '中正路２２１號').replace('大成安心購', '全家便利商店');
  console.log('【假裝 557 站牌搬到全家前】\n' + (diffSummary_(now, fake) || '（判斷為無實質變更）'));
  console.log('\n【只改排版】\n' + (diffSummary_(now, now.replace(/。/g, '.')) || '（判斷為無實質變更）'));
  console.log('\n【學生問 557 在哪裡搭】\n' + stationReply_());
}

// ============================================================================
// 等車室.gs
// ============================================================================

/**
 * 共乘等車室的網頁（共乘.gs 的 doGet 會送出這一頁）
 *
 * 每 3 秒問一次 cpRoomState，畫面上的人數、倒數、每人金額就會跟著更新；
 * 人數變多時響一聲。因為是網頁自己來問，不會用到 LINE 的推播額度。
 * __TOKEN__、__BOT__ 會在 doGet 換成這個人的代碼和 Bot 的 ID。
 */
const ROOM_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<base target="_top">
<style>
  :root { --bg:#f4f5f7; --card:#fff; --ink:#1c2330; --sub:#667085; --line:#e4e7ec; --main:#0b6e4f; --main-ink:#fff; --warn:#b54708; --soft:#e8f3ef; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#12161c; --card:#1c222b; --ink:#eef1f5; --sub:#98a2b3; --line:#2c3440; --main:#3ecf9a; --main-ink:#0c1f18; --warn:#fdb022; --soft:#1d2f29; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--ink); font:16px/1.5 -apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; margin:0 auto 12px; max-width:440px; }
  .dir { font-size:14px; color:var(--sub); }
  h1 { font-size:22px; margin:2px 0 0; }
  .big { font-size:44px; font-weight:700; font-variant-numeric:tabular-nums; line-height:1.15; margin-top:10px; }
  .big small { font-size:16px; font-weight:400; color:var(--sub); }
  .hint { color:var(--sub); font-size:14px; margin-top:4px; }
  .seats { display:flex; gap:8px; margin:14px 0 4px; }
  .seat { flex:1; height:10px; border-radius:5px; background:var(--line); }
  .seat.on { background:var(--main); }
  ul { list-style:none; margin:10px 0 0; padding:0; }
  li { display:flex; justify-content:space-between; padding:9px 0; border-top:1px solid var(--line); }
  li span.tag { color:var(--sub); font-size:14px; }
  button, a.btn { display:block; width:100%; margin-top:10px; padding:14px; border-radius:12px; border:1px solid var(--line); background:var(--card); color:var(--ink); font-size:17px; text-align:center; text-decoration:none; }
  button.main, a.btn.main { background:var(--main); border-color:var(--main); color:var(--main-ink); font-weight:700; }
  button:disabled { opacity:.5; }
  .note { background:var(--soft); border-radius:10px; padding:12px; margin-top:12px; font-size:15px; }
  .warn { color:var(--warn); }
  .foot { text-align:center; color:var(--sub); font-size:13px; max-width:440px; margin:0 auto; }
</style>
</head>
<body>
<div id="app"><div class="card">載入中…</div></div>
<p class="foot" id="foot"></p>
<script>
var TOKEN = '__TOKEN__', BOT = '__BOT__';
var state = null, offset = 0, lastCount = -1, soundOn = false, audio = null, busy = false;
// 這一頁是包在 Apps Script 的框架裡顯示的，瀏覽器會擋掉框架裡的 confirm()、alert()，
// 所以「確定要離開嗎」要直接畫在頁面上。asking 是正在問的那一句，failed 是上一個動作沒送成功。
var asking = '', failed = false;
var ASK = { wait: '確定要離開這一團嗎？', formed: '已經成團了，現在離開會扣信用分。確定嗎？' };

function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function chat(text) { return 'https://line.me/R/oaMessage/' + encodeURIComponent(BOT) + '/?' + encodeURIComponent(text); }
function mmss(ms) {
  var s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return Math.floor(s / 3600) + ' 小時 ' + Math.floor(s % 3600 / 60) + ' 分';
  return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
}

function beep() {
  if (!soundOn || !audio) return;
  [0, 0.25].forEach(function (t) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.25, audio.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.2);
    o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.2);
  });
}
function enableSound() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); soundOn = true; beep(); } catch (e) { soundOn = false; }
  render(state);
}

function poll() {
  if (busy) return;
  google.script.run.withSuccessHandler(render).withFailureHandler(function () {}).cpRoomState(TOKEN);
}
function act(action) {
  asking = '';
  failed = false;
  busy = true;
  document.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  google.script.run
    .withSuccessHandler(function (s) { busy = false; render(s); })
    .withFailureHandler(function () { busy = false; failed = true; render(state); })
    .cpRoomAction(TOKEN, action);
}
function ask(kind) { asking = ASK[kind]; render(state); }
function keep() { asking = ''; render(state); }
function leaveButton(label, kind) {
  if (!asking) return '<button onclick="ask(\\'' + kind + '\\')">' + label + '</button>';
  return '<div class="note warn">' + esc(asking) + '</div>'
    + '<button class="main" onclick="act(\\'leave\\')">確定離開</button>'
    + '<button onclick="keep()">不要，留下來</button>';
}

function members(s) {
  return '<ul>' + s.members.map(function (m) {
    var tags = [];
    if (m.leader) tags.push('團主');
    if (m.boarded) tags.push('已上車'); else if (s.type === '預約') tags.push(m.arrived ? '已到' : '還沒到');
    return '<li><span>' + esc(m.name) + (m.me ? '（我）' : '') + '</span><span class="tag">' + tags.join('・') + '</span></li>';
  }).join('') + '</ul>';
}
function seats(s) {
  var h = '<div class="seats">';
  for (var i = 0; i < s.seats; i++) h += '<div class="seat' + (i < s.members.length ? ' on' : '') + '"></div>';
  return h + '</div>';
}
function nextShare(s) {
  var n = s.members.length;
  if (n >= s.seats) return '';
  return '再多 1 人，每人變 ' + Math.ceil(s.total / (n + 1) / 5) * 5 + ' 元';
}

function render(s) {
  if (!s) return;
  state = s;
  var app = document.getElementById('app'), h = '';
  if (!s.ok) {
    h = '<div class="card"><h1>連結失效了</h1><p class="hint">回 LINE 傳「我的共乘」，再打開一次等車室。</p><a class="btn main" href="' + chat('我的共乘') + '">回 LINE</a></div>';
  } else if (s.none) {
    h = '<div class="card"><h1>你目前沒有共乘</h1><p class="hint">回 LINE 傳「共乘」就能開始。</p><a class="btn main" href="' + chat('共乘') + '">我要共乘</a></div>';
  } else {
    offset = s.now - Date.now();
    var n = s.members.length;
    if (lastCount >= 0 && n > lastCount) beep();
    lastCount = n;
    var head = '<div class="dir">' + esc(s.type) + '・' + esc(s.when) + ' 出發</div><h1>' + esc(s.dir) + '</h1>';
    var meet = '<div class="note">集合點：' + esc(s.meet) + '</div>';
    var arrivedBtn = (s.type === '預約' && !s.arrived) ? '<button class="main" onclick="act(\\'arrived\\')">我到了</button>' : '';

    if (s.status === '等待中') {
      h = '<div class="card">' + head
        + '<div class="big"><span id="cd">–:––</span> <small>' + (s.type === '預約' ? '後出發' : '後成團') + '</small></div>'
        + seats(s)
        + '<div class="big">' + s.share + ' <small>元／人（' + n + ' 人）</small></div>'
        + '<div class="hint">' + nextShare(s) + '</div>'
        + members(s) + meet + arrivedBtn
        + (soundOn ? '' : '<button onclick="enableSound()">🔔 開啟提示音（有人加入會響）</button>')
        + leaveButton('離開', 'wait') + '</div>';
    } else if (s.status === '已成團' || s.status === '已叫車') {
      var called = s.status === '已叫車';
      h = '<div class="card">' + head
        + '<div class="big">' + s.share + ' <small>元／人（' + n + ' 人成團）</small></div>'
        + members(s) + meet;
      if (s.boarded) {
        h += '<div class="note">✅ 已上車。' + (s.isLeader ? '車資你先付，其他人會轉 ' + s.share + ' 元給你。' : '記得轉 ' + s.share + ' 元給團主。') + '</div>';
      } else {
        h += arrivedBtn;
        if (!called && s.isLeader) {
          h += '<div class="note">你是團主：用你的叫車 App 叫車到集合點，車資你先付，其他人各轉 ' + s.share + ' 元給你。</div>'
            + '<button class="main" onclick="act(\\'call\\')">我叫車了</button>';
        } else if (!called) {
          h += '<div class="note">等團主叫車。車資團主先付，到時候轉 ' + s.share + ' 元給他。</div>';
        } else {
          h += '<div class="note">團主已經叫車了，上車後按下面的按鈕。</div>';
        }
        if (called || !s.isLeader) h += '<button class="' + (called ? 'main' : '') + '" onclick="act(\\'board\\')">上車了</button>';
        h += leaveButton('我不搭了', 'formed');
      }
      h += '</div>';
    } else if (s.status === '已出發') {
      h = '<div class="card">' + head + '<div class="big">一路順風 🚕</div><div class="note">' + n + ' 人共乘，每人 ' + s.share + ' 元。'
        + (s.isLeader ? '其他人會轉給你。' : '記得轉給團主。') + '</div></div>';
    } else if (s.status === '獨行') {
      h = '<div class="card">' + head + '<div class="big">這次沒有人順路</div>'
        + '<div class="note">' + (s.reward ? '謝謝你用共乘，送你 ' + s.reward + ' 分 🎁' : '謝謝你用共乘！今天的獎勵已經領過了。') + '</div>'
        + '<p class="hint">接下來要怎麼去？</p>'
        + '<a class="btn main" href="' + chat('幫我比較路線') + '">改搭公車（看現在最快的車）</a>'
        + '<a class="btn" href="' + chat('共乘') + '">再開一次鈴</a></div>';
    } else {
      h = '<div class="card">' + head + '<div class="big">這一團結束了</div><a class="btn main" href="' + chat('共乘') + '">再找一團</a></div>';
    }
    document.getElementById('foot').textContent = '信用分 ' + s.credit + '・積分 ' + s.points;
  }
  if (failed) h += '<div class="card warn">剛剛沒有送出去，請再按一次。</div>';
  app.innerHTML = h;
  tick();
}

function tick() {
  var el = document.getElementById('cd');
  if (el && state && state.departAt) el.textContent = mmss(state.departAt - (Date.now() + offset));
}

setInterval(tick, 500);
setInterval(poll, 3000);
poll();
</script>
</body>
</html>`;

// ============================================================================
// 計數表單.gs
// ============================================================================

/**
 * 士林站現場計數表單
 * 在編輯器選「建立計數表單」執行一次，就會建立 Google 表單，
 * 答案自動存進這份試算表的新分頁。網址會印在執行記錄裡。
 */
function 建立計數表單() {
  // 只建立一次：建過就印出網址。要重建的話，到指令碼屬性刪掉 COUNT_FORM_URL
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('COUNT_FORM_URL')) {
    console.log('表單已經建立過了，填寫用網址：' + props.getProperty('COUNT_FORM_URL'));
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const form = FormApp.create('557 士林站現場計數');
  form.setDescription(
    '每 10 分鐘記一次排隊人數；557 到站時再多記一筆上車人數。\n'
    + '時間會自動記錄，不用填。只數人數、不拍照、不記錄任何人的長相。'
  );
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  const atLeastZero = () => FormApp.createTextValidation()
    .setHelpText('請填 0 以上的數字')
    .requireNumberGreaterThanOrEqualTo(0)
    .build();

  form.addTextItem().setTitle('記錄人').setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('地點')
    .setChoiceValues(['捷運士林站（中正路 205 號前）', '士林國中站（中正路 341 號前）'])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('這筆是')
    .setChoiceValues(['每 10 分鐘的排隊人數', '557 剛到站'])
    .setRequired(true);

  form.addTextItem()
    .setTitle('現在排隊人數')
    .setHelpText('前門、後門兩排加起來。人很多時可以 5 個 5 個數。')
    .setValidation(atLeastZero())
    .setRequired(true);

  form.addTextItem()
    .setTitle('（557 到站才填）上車人數')
    .setValidation(atLeastZero());

  form.addTextItem()
    .setTitle('（557 到站才填）車開走後還留在站上的人數')
    .setHelpText('也就是沒擠上車的人')
    .setValidation(atLeastZero());

  form.addMultipleChoiceItem()
    .setTitle('天氣')
    .setChoiceValues(['晴天', '陰天', '毛毛雨', '大雨'])
    .setRequired(true);

  form.addTextItem()
    .setTitle('這段時間看到幾次插隊')
    .setHelpText('沒看到就填 0；不要拍照、不要記錄是誰')
    .setValidation(atLeastZero());

  form.addParagraphTextItem().setTitle('備註').setHelpText('例如：車子直接過站沒停、有專車、隊伍被馬路切斷');

  props.setProperty('COUNT_FORM_URL', form.getPublishedUrl());
  console.log('填寫用網址（傳給計數的同學）：' + form.getPublishedUrl());
  console.log('編輯表單網址（隊員自己用）：' + form.getEditUrl());
}

// ============================================================================
// 選單.gs
// ============================================================================

/**
 * 主選單和「用點的」流程：每個功能都有按鈕，不用記關鍵字、不用打字
 *
 * 按鈕都做在訊息裡（卡片.gs 的 choices_），不用輸入框上面那排快速回覆。
 *   「選單」        → 一則訊息，四個分類的按鈕（照專案的模組分）
 *   按一個分類      → Bot 把那一類的功能按鈕傳到聊天室
 *   「出門時間」    → 點哪一天 → 點第幾節 → 點哪一棟 → 出門建議（原本要打「明天早八 D 棟」）
 *   加好友、看不懂的句子 → 也是回選單
 *
 * 要加新功能的按鈕：在 MENU 對應的分類加一列 [按鈕上的字, 按了傳出的字]。
 * tests/選單.test.js 會檢查每一顆按鈕傳出去的字 Bot 都認得。
 * 用到 卡片.gs 的 choices_，比較器.gs 的 PERIODS、BUILDINGS、ORIGINS、compareQuery_、timeOn_。
 */
// 分類照《557 通勤平台：專案整理》的模組：學生會直接用到的是模組二、三、五，積分（模組四）另外一類
const MENU = [
  {
    name: '出門前提醒',
    hint: '怎麼去最快、幾點出門、會不會下雨',
    buttons: [['現在最快的車', '幫我比較路線'], ['排出門時間', '出門時間'], ['557 到站', '557 去學校'], ['557 回家', '557 回家'],
      ['明天會下雨嗎', '明天會下雨嗎'], ['557 在哪裡搭', '557 在哪裡搭'], ['開啟提醒', '訂閱提醒'], ['關閉提醒', '取消提醒']],
  },
  {
    name: '557 以外的選擇',
    hint: '共乘、YouBike、雨傘、包車',
    buttons: [['計程車共乘', '共乘'], ['YouBike 車數', 'YouBike'], ['共享雨傘', '共享雨傘'], ['包車意願調查', '包車']],
  },
  {
    name: '新生與排隊',
    hint: '第一次搭 557 看這裡',
    buttons: [['新生教學', '新生教學'], ['新生測驗', '新生測驗'], ['排隊禮儀', '排隊禮儀'], ['557 在哪裡搭', '557 在哪裡搭']],
  },
  {
    name: '積分與打卡',
    hint: '走路、騎車、共乘、早到都能拿分',
    buttons: [['到校打卡', '打卡'], ['我的紀錄', '我的紀錄'], ['全校減碳', '全校減碳'], ['騎車到校', '騎車到校']],
  },
];

// 一則訊息裡的按鈕排成兩欄，節次放 13 個（中午的第 E 節很少排課，要用打的）
const MENU_PERIODS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D'];
// 有教室的大樓 12 棟，加上「不指定」
const MENU_BUILDINGS = ['B', 'D', 'R', 'H', 'G', 'F', 'C', 'N', 'M', 'P', 'Q', 'L'];

/** 「選單」：四個分類。按了分類，Bot 再傳那一類的功能按鈕 */
function menuCard_() {
  return choices_('想做什麼？先選一類，我再把按鈕傳給你。', // 卡片.gs
    MENU.map(c => [c.name, c.name]),
    { title: '東吳通勤達人', badge: '選單', primary: false, menu: false });
}

/** 按了分類：把這一類的功能按鈕傳到聊天室。不是分類名稱就回傳 null */
function menuCategory_(name) {
  const c = MENU.filter(x => x.name === name)[0];
  if (!c) return null;
  return choices_(c.hint, c.buttons, { title: c.name, badge: '選單', primary: false });
}

/** 加好友時 */
function menuWelcome_() {
  return ['嗨！我是東吳通勤達人。\n每個功能都有按鈕，不用打字。先從下面選一類 👇', menuCard_()];
}

/** 看不懂的句子：不要讓人卡住，直接給按鈕 */
function menuUnknown_() {
  return ['我看不懂這句話 🙏\n從下面選一類，我把按鈕傳給你 👇', menuCard_()];
}

/**
 * 「出門時間」一步一步點：出門時間 [今天|明天] [HH:MM] [大樓代號|不指定] [出發站]
 * 每一步都把前面選過的帶在按鈕傳出的字裡，所以 Bot 不用記住誰點到哪一步。
 */
function menuFlow_(text) {
  const p = text.trim().split(/\s+/);
  const day = p[1], time = p[2], building = p[3], origin = p[4];
  const now = new Date();

  if (day !== '今天' && day !== '明天') {
    return choices_('要排哪一天的出門時間？', [['今天', '出門時間 今天'], ['明天', '出門時間 明天']], { title: '排出門時間', badge: '第 1 步', primary: false });
  }
  if (!/^\d{2}:\d{2}$/.test(time || '')) {
    // 今天只列還沒開始的節次
    const periods = MENU_PERIODS.filter(k => day === '明天' || timeOn_(now, PERIODS[k]) > now);
    if (!periods.length) return choices_('今天的課都開始了，要排明天的嗎？', [['排明天的', '出門時間 明天']]);
    return choices_(day + '第幾節上課？', periods.map(k => ['第 ' + k + ' 節 ' + PERIODS[k], '出門時間 ' + day + ' ' + PERIODS[k]]), { title: '排出門時間', badge: '第 2 步' });
  }
  if (!BUILDINGS[building] && building !== '不指定') {
    const items = MENU_BUILDINGS.map(k => [k + ' ' + menuBuildingName_(k), '出門時間 ' + day + ' ' + time + ' ' + k]);
    return choices_(day + ' ' + time + ' 上課，在哪一棟？', items.concat([['不指定', '出門時間 ' + day + ' ' + time + ' 不指定']]), { title: '排出門時間', badge: '第 3 步' });
  }
  return compareQuery_({ // 比較器.gs
    intent: '去學校',
    arriveTime: time,
    building: building === '不指定' ? '' : building,
    day: day,
    origin: ORIGINS[origin] ? origin : '',
  }, text);
}

/** 按鈕上的大樓名稱：大家習慣叫簡稱的用簡稱，其他用全名 */
function menuBuildingName_(code) {
  return { B: '綜大', D: '二教', R: '一教' }[code] || BUILDINGS[code][0];
}

// ============================================================================
// 雨傘.gs
// ============================================================================

/**
 * 共享雨傘（20）：錢穆故居站和校門口各放幾把，借了走到另一端再還
 *
 * 在 LINE 傳「借傘」→ 選在哪裡借 → Bot 給一把傘號；傳「還傘」→ 選在哪裡還。
 * 一個人一次只能借一把。歸還有積分（積分.gs），一天只給一次。每一筆都記在「雨傘」分頁。
 * 雨傘清單要先建立：在編輯器執行一次「建立雨傘清單」（之後可以直接在試算表加傘號）。
 * 用到共乘.gs 的 cpSheet_、cpLocked_、cpNow_，積分.gs 的 ptAdd_、PT。
 */
const UM_SPOTS = ['錢穆故居站', '校門口'];
const UM_HEAD = ['傘號', '狀態', '借用人', '地點', '借出時間', '歸還時間'];
const UM_PER_SPOT = 3; // 建立清單時每個點放幾把

/** 文字訊息開頭是「借傘」「還傘」「共享雨傘」時由 Code.gs 轉過來 */
function umText_(uid, text) {
  const p = text.trim().split(/\s+/);
  if (p[0] === '共享雨傘') return umHelp_(uid);
  if (UM_SPOTS.indexOf(p[1]) < 0) {
    return choices_(p[0] === '借傘' ? '在哪裡借傘？' : '在哪裡還傘？', UM_SPOTS.map(s => [s, p[0] + ' ' + s]));
  }
  return cpLocked_(() => (p[0] === '借傘' ? umBorrow_(uid, p[1]) : umReturn_(uid, p[1])));
}

function umHelp_(uid) {
  const mine = umRows_().filter(u => u.status === '借出' && u.user === uid)[0];
  const left = UM_SPOTS.map(s => s + ' ' + umRows_().filter(u => u.status === '在架' && u.spot === s).length + ' 把').join('、');
  return choices_([
    '☂️ 共享雨傘',
    '',
    '傘架放在錢穆故居站和校門口。下雨天借一把，走到另一端再還。',
    '現在可以借：' + left,
    mine ? '你目前借了 ' + mine.id + '，記得歸還。' : '歸還有 ' + PT.UMBRELLA + ' 分。',
  ].join('\n'), mine ? [['還傘', '還傘']] : [['借傘', '借傘'], ['還傘', '還傘']]);
}

function umBorrow_(uid, spot) {
  const all = umRows_();
  const mine = all.filter(u => u.status === '借出' && u.user === uid)[0];
  if (mine) return choices_('你已經借了 ' + mine.id + '，先歸還才能再借。', [['還傘', '還傘']]);
  const free = all.filter(u => u.status === '在架' && u.spot === spot)[0];
  if (!free) return '☂️ ' + spot + '現在沒有傘可以借了，抱歉 🙏';
  umSave_(free.row, [free.id, '借出', uid, spot, cpNow_(), '']);
  return choices_('☂️ 借到 ' + free.id + '！\n請拿傘架上貼著 ' + free.id + ' 的那一把。走到另一端後傳「還傘」歸還。', [['還傘', '還傘']]);
}

function umReturn_(uid, spot) {
  const mine = umRows_().filter(u => u.status === '借出' && u.user === uid)[0];
  if (!mine) return '你現在沒有借傘喔。';
  umSave_(mine.row, [mine.id, '在架', '', spot, mine.out, cpNow_()]);
  // 借還只要打字就算數，所以還傘的積分一天只給一次，不然重複借還可以一直加分
  if (ptDoneToday_(uid, '還傘')) return '☂️ 已歸還 ' + mine.id + '，謝謝！今天的還傘積分已經領過了。';
  const fresh = ptAdd_(uid, '還傘', PT.UMBRELLA, 0, mine.id + ' 還到' + spot);
  return '☂️ 已歸還 ' + mine.id + '，謝謝！+' + PT.UMBRELLA + ' 分' + ptBadgeText_(fresh);
}

function umRows_() {
  return cpSheet_('雨傘', UM_HEAD).getDataRange().getValues().slice(1)
    .map((r, i) => ({ row: i + 2, id: r[0], status: r[1], user: r[2], spot: r[3], out: r[4] }))
    .filter(u => u.id);
}

function umSave_(row, values) {
  cpSheet_('雨傘', UM_HEAD).getRange(row, 1, 1, 6).setValues([values]);
}

/** 執行一次就好：每個點放 UM_PER_SPOT 把。已經有清單就不動 */
function 建立雨傘清單() {
  if (tooSoon_('建立雨傘清單', 60)) return; // Code.gs：公開網頁也呼叫得到
  const sheet = cpSheet_('雨傘', UM_HEAD);
  if (sheet.getLastRow() > 1) {
    console.log('「雨傘」分頁已經有資料了，要加傘直接在試算表新增一列。');
    return;
  }
  let n = 0;
  UM_SPOTS.forEach(spot => {
    for (let i = 0; i < UM_PER_SPOT; i++) {
      n += 1;
      sheet.appendRow(['U' + ('0' + n).slice(-2), '在架', '', spot, '', '']);
    }
  });
  console.log('建立了 ' + n + ' 把雨傘。');
}
