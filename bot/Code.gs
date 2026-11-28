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
  // 到校預估.gs 的測試模式：這個人在測試模式，就整則訊息都當成假裝的時間處理，回覆前面加一行提示
  const test = typeof etaTestOf_ === 'function' && ev.source && etaTestOf_(ev.source.userId);
  if (!test) return handleEventNow_(ev);
  return etaWithTestTime_(test, () => handleEventNow_(ev));
}

function handleEventNow_(ev) {
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
  if (ev.type === 'message' && ev.message.type === 'image') {
    // 積分.gs：騎車到校要傳 YouBike 騎乘紀錄。沒在等照片就不回
    const photo = ptBikePhoto_(ev.source.userId, ev.message.id);
    if (photo) {
      reply_(ev.replyToken, photo);
      log_(ev, '（照片）', photo);
    }
    return;
  }
  if (ev.type === 'message' && ev.message.type === 'location') {
    // 到校預估.gs：從我這裡出發幾點到校。紀錄裡不寫經緯度
    let answer;
    try {
      answer = etaFromLocation_(ev.message.latitude, ev.message.longitude, ev.source.userId);
    } catch (err) {
      console.error(err);
      answer = '抱歉，資料暫時抓不到，等一下再試一次 🙏';
    }
    if (typeof etaTestLabel_ !== 'undefined' && etaTestLabel_) answer = ['🧪 測試模式：當成' + etaTestLabel_].concat(answer);
    reply_(ev.replyToken, answer);
    log_(ev, '（傳了位置）', answer);
    return;
  }
  if (ev.type !== 'message' || ev.message.type !== 'text') return;

  const text = ev.message.text.trim();
  let answer;
  etaLastClass_ = null; // 到校預估.gs
  try {
    if (/^(計程車共乘|共乘|查看我的共乘|我的共乘|取消共乘)(\s|$)/.test(text) || /^(發起共乘|加入共乘|改成預約)$/.test(text) || cpDirByLabel_(text)) {
      answer = cpText_(ev.source.userId, text); // 共乘.gs：按鈕傳出的字跟按鈕上的字一樣（計程車共乘、士林站 → 東吳、發起共乘…）
    } else if (/^(選單|主選單|功能|全部功能|更多功能|使用說明|說明|menu|help)$/i.test(text)) {
      answer = menuCard_(); // 選單.gs：四個分類
    } else if (menuCategory_(text)) {
      answer = menuCategory_(text); // 選單.gs：按了分類，傳那一類的功能按鈕
    } else if (/557\s*以外|替代(路線|方式|交通)|其他的?(通勤|交通)/.test(text)) {
      answer = menuCategory_('557 以外的選擇'); // 「我想找 557 以外的通勤方式」這類說法
    } else if (/^(⏰ ?)?(出發時間規劃|幾點出門)$/.test(text)) {
      answer = menuFlow_('出門時間', ev.source.userId); // 選單.gs：趕課倒推（跟按「⏰ 出發時間規劃」一樣）
    } else if (/^出門時間(\s|$)/.test(text)) {
      answer = menuFlow_(text, ev.source.userId); // 選單.gs：用點的排出門時間（選好課會記下來，接著傳位置就倒推）
    } else if (/^測試時間(\s|$)/.test(text)) {
      answer = etaTestText_(ev.source.userId, text); // 到校預估.gs：測試模式（假日也能試預估）
    } else if (/^從\s*\S+?\s*出發$/.test(text) && !/上課|節|棟/.test(text)) {
      answer = etaFromStationText_(ev.source.userId, text.replace(/^從\s*/, '').replace(/\s*出發$/, '')); // 到校預估.gs：換捷運站
    } else if (/^選擇捷運站(\s|$)/.test(text)) {
      answer = etaPickStation_(text); // 到校預估.gs：自己選路線、選站
    } else if (text === '到校預估 士林站' || text === '我已經在士林站') {
      answer = etaFromShilin_(); // 到校預估.gs：人已經在捷運士林站
    } else if (/^(到校預估|預估到達時間|🚇 預估到達時間|從我這裡出發幾點到校|幾點到東吳|幾點出門、幾點到東吳|🚇 幾點出門、幾點到東吳)$/.test(text)) {
      answer = etaButton_(); // 到校預估.gs：主打功能的入口（傳位置、趕課倒推）
    } else if (text === '定位測試') {
      answer = geoTestButton_(); // 定位測試.gs（暫時的）
    } else if (/^(訂閱提醒|取消提醒|開啟提醒|關閉提醒)$/.test(text)) {
      answer = subscribe_(ev.source.userId, text === '訂閱提醒' || text === '開啟提醒'); // 晚上提醒.gs（按鈕傳出的字跟按鈕一樣：開啟提醒、關閉提醒）
    } else if (/^(訂閱提醒設定|雨天與考試週訂閱提醒|已開啟提醒|✅ 已開啟提醒)$/.test(text)) {
      answer = remindSettings_(ev.source.userId);
    } else {
      // 積分、打卡、YouBike、雨傘、新生、包車：要知道是誰傳的，所以排在 route_ 前面
      answer = memberReply_(ev.source.userId, text) || route_(text, ev.source.userId);
    }
  } catch (err) {
    console.error(err);
    answer = '抱歉，資料暫時抓不到，等一下再試一次 🙏';
  }
  // 回的是出門建議（選單或口語都一樣）：記下這堂課，接著 30 分鐘內傳位置就從學生的位置倒推（到校預估.gs）
  if (etaLastClass_) etaRememberClass_(ev.source.userId, etaLastClass_.day, etaLastClass_.time, etaLastClass_.building);
  if (typeof etaTestLabel_ !== 'undefined' && etaTestLabel_ && !/^測試時間/.test(text)) answer = ['🧪 測試模式：當成' + etaTestLabel_].concat(answer);
  reply_(ev.replyToken, answer);
  log_(ev, text, answer);
}

/**
 * 模組三、四、五的指令。認得就回覆，不認得回傳 null 交給 route_。
 * 這幾個要比 route_ 先判斷：「借傘」有「傘」字、「排隊禮儀」有「排隊」，不先攔下來會被當成問天氣、問站牌。
 */
function memberReply_(uid, text) {
  if (/^(打卡|步行積分)$/.test(text)) return ptCheckinButton_(uid, ''); // 積分.gs：四種卡都列
  if (text === '到校打卡') return ptCheckinButton_(uid, '到校'); // 走路進學校、早到、騎車到校
  if (text === '出校打卡') return ptCheckinButton_(uid, '離校'); // 走路出學校、騎車回士林
  if (text === '騎車回士林' || text === '提交騎車回士林紀錄') return ptBikeOut_(uid); // YouBike 卡片的按鈕也傳這句
  const checkinMode = text.match(/^打卡\s*(進校|出校|早到)$/);
  if (checkinMode) return ptCheckinButton_(uid, checkinMode[1]);
  if (/^(我的紀錄|我的積分|積分|成就|碳足跡)$/.test(text)) return ptMine_(uid);
  if (text === '全校減碳') return ptSchool_();
  if (text === '騎車到校' || text === '提交騎車到校紀錄') return ptBike_(uid);
  if (/^(兌換折價券|兌換學餐折價券|兌換)$/.test(text)) return ptRedeemAsk_(uid);
  if (text === '確認兌換折價券') return ptRedeem_(uid);
  if (/^(我的折價券|我的學餐折價券|折價券)$/.test(text)) return ptMyCoupons_(uid);
  if (/^(查看 ?)?(youbike|ubike|微笑單車|腳踏車)( ?(查詢|車數))?$/i.test(text)) return ybReply_(); // YouBike.gs
  if (/^(借傘|還傘|共享雨傘)(\s|$)/.test(text)) return umText_(); // 雨傘.gs：Raingo 租借站說明
  if (/^(新生須知|新生教學|新生)$/.test(text)) return nbIntro_(); // 新生.gs
  if (text === '新生測驗' || /^答\s*[1-3]$/.test(text)) return nbQuiz_(uid, text);
  if (text === '排隊禮儀') return nbEtiquette_();
  if (/^(包車|包車調查|學生包車)(\s|$)/.test(text)) return charterText_(); // 新生.gs
  if (/^(出門提醒 |取消出門提醒$)/.test(text)) return lvText_(uid, text); // 發車提醒.gs
  if (text === '回報我在哪裡排隊') return rpText_(uid, '回報現場'); // 按鈕傳出的字跟按鈕一樣
  if (/^回報現場(\s|$)/.test(text)) return rpText_(uid, text); // 現場回報.gs：我在哪一站排隊
  return null;
}

function route_(text, uid) {
  if (/^(557|557 即時動態|557 到站|557 去學校|557 回家|公車)$/.test(text)) {
    return bus557Reply_(); // 往東吳、往捷運站一起顯示
  }
  if (/回家|回程|下課/.test(text)) {
    return busReply_(1, ['東吳大學(錢穆故居)'], '557 東吳 → 士林');
  }
  if (/雨|天氣|傘/.test(text)) {
    return rainReply_(uid);
  }
  if (/站牌|站位|上車(地點|處)|候車|排隊|哪(裡|邊|兒)?(搭|排|上車|等)/.test(text)) {
    return stationReply_(); // 站位變更.gs：「557 站牌資訊」「557 在哪裡搭」都會到這裡
  }
  if (/^(比較所有路線|比較所有公車路線|幫我比較路線|現在最快的車)$/.test(text)) {
    return liveReply_('士林站', '', null); // 比較器.gs：士林站現在最快的幾班車
  }
  return compareReply_(text, uid); // 其他問題交給比較器（比較器.gs）判斷
}

/** 「雨天與考試週訂閱提醒」：提醒條件、提醒時間，再給開啟、關閉兩顆按鈕（11/28 團隊設計稿） */
function remindSettings_(uid) {
  const on = uid ? isSubscribed_(uid) : false; // 晚上提醒.gs
  return dsCard_({ // 卡片.gs
    kicker: '出門前提醒',
    title: '🔔 雨天與考試週提醒',
    badge: uid ? (on ? '已開啟' : '未開啟') : '',
    lead: '訂閱提醒，讓你提前掌握隔天的天氣與考試週資訊，不再匆忙出門。',
    blocks: [
      { hr: true },
      { h: '提醒條件' },
      { group: [
        ['🌧️ 隔天降雨機率達 ' + RAIN_ALERT_POP + '% 以上', '', '提醒隔天可能下雨，提早準備雨具。'], // 晚上提醒.gs
        ['📖 遇到考試週', '', '提醒你留意隔天行程，提早安排出門時間。'],
      ] },
      { stat: { label: '🕘 提醒時間', boldLabel: true, value: '每晚 9:00', note: '符合提醒條件時，於前一晚推播通知。' } },
      { text: '📅 週末及放假日不會推播提醒。', muted: true },
    ],
    buttons: [['開啟提醒', '開啟提醒'], ['關閉提醒', '關閉提醒']],
  });
}

// ===== 557 即時到站（TDX） =====

/** 「557 即時動態」：往東吳（士林站、士林國中）、往捷運站（東吳大學）分兩組（11/28 團隊設計稿） */
function bus557Reply_() {
  const etas = tdx_('EstimatedTimeOfArrival/City/Taipei/557?$format=JSON&$filter=' + encodeURIComponent("RouteName/Zh_tw eq '557'"));
  // [站名, 顯示的字, 是不是狀態（末班車已過、尚未發車這種，用琥珀色標籤）]
  const stop = (dir, name) => {
    const hits = etas.filter(e => e.Direction === dir && e.StopName.Zh_tw === name);
    const timed = hits.filter(e => e.EstimateTime != null);
    if (timed.length) return [busStopName_(name), timed.map(etaText_).join('、'), false];
    return [busStopName_(name), hits.length ? hits.map(etaText_).join('、') : '沒有資料', true];
  };
  const toSchool = [stop(0, '捷運士林站(中正)'), stop(0, '士林國中')];
  const toMrt = [stop(1, '東吳大學(錢穆故居)')];
  const ended = toSchool.concat(toMrt).every(r => /末班車已過/.test(r[1]));
  const blocks = [{ sec: '往東吳方向' }, { status: toSchool }, { sec: '往捷運站方向' }, { status: toMrt }];
  if (ended) blocks.push({ panel: { tone: 'warn', title: 'ⓘ 557 今天已經收班', lines: ['可以按「比較所有路線」改搭其他公車，或找人共乘計程車。'] } });
  blocks.push({ hr: true }, { small: '🔄 TDX 即時資料・' + nowText_() });
  return dsCard_({ // 卡片.gs
    kicker: '557 即時動態',
    title: '557 往東吳 / 往捷運站',
    blocks: blocks,
    buttons: [['比較所有路線', '比較所有路線'], ['回報我在哪裡排隊', '回報我在哪裡排隊'], { label: '查看 557 站牌資訊', text: '查看 557 站牌資訊', style: 'outline' }],
  });
}

/** 站名顯示：括號改成全形，「捷運士林站(中正)」→「捷運士林站（中正）」 */
function busStopName_(name) {
  return String(name).replace(/\(/g, '（').replace(/\)/g, '）');
}

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
      ? [{ label: '比較所有路線', text: '比較所有路線' }, { label: '557 站牌資訊', text: '557 站牌資訊' }]
      : [{ label: '找人共乘計程車回士林', text: '共乘 回士林' }],
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

function rainReply_(uid) {
  const url = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-061'
    + '?Authorization=' + PROPS.getProperty('CWA_API_KEY')
    + '&LocationName=' + encodeURIComponent('士林區')
    + '&ElementName=' + encodeURIComponent('3小時降雨機率');
  const data = JSON.parse(UrlFetchApp.fetch(url).getContentText());
  const times = data.records.Locations[0].Location[0].WeatherElement[0].Time;

  const target = rainTarget_(new Date());
  const slot = times.find(t => t.StartTime.indexOf(target.day + 'T' + target.hour) === 0) || times[0];
  const pop = Number(slot.ElementValue[0].ProbabilityOfPrecipitation);

  // 11/28 團隊設計稿：低機率綠、中等橘、高機率紅，加一行狀態標題，建議放灰色面板
  const when = target.day === Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd') ? '今天' : '明天';
  let level;
  if (pop >= 60) level = { title: '🌧️ 降雨機率高', color: UI.brand, advice: target.morning ? when + '早上很可能下雨。557 會比平常擠，建議早 20 分鐘出門、記得帶傘。' : '很可能下雨，出門記得帶傘。' };
  else if (pop >= 30) level = { title: '🌦️ 降雨機率中等', color: UI.mid, advice: '有機會下雨，帶把傘比較保險。' };
  else level = { title: '☀️ 降雨機率低', color: UI.good, advice: (target.morning ? when + '早上' : '') + '預計不太會下雨，可以考慮從錢穆故居站步行進入學校。' };

  // 訂閱過的人按鈕改成「已開啟提醒」（晚上提醒.gs），避免重複訂閱
  const on = uid ? isSubscribed_(uid) : false;
  return dsCard_({ // 卡片.gs
    kicker: '降雨查詢',
    title: target.title,
    route: '士林區',
    blocks: [
      { hr: true },
      { metric: ['降雨機率', pop + '%', level.color] },
      { panel: { title: level.title, lines: [level.advice], quiet: true, margin: 'md' } },
      { small: '⛅ 中央氣象署資料・' + nowText_() + ' 更新' },
    ],
    buttons: [on ? ['✅ 已開啟提醒', '已開啟提醒'] : ['雨天與考試週訂閱提醒', '雨天與考試週訂閱提醒']],
  });
}

/**
 * 查哪一段的降雨機率（氣象署是 3 小時一段）：
 *   晚上 7 點以後 → 明天早上 6–9 點（上學時段）
 *   早上 9 點以前 → 今天早上 6–9 點
 *   其他時間      → 今天現在這 3 小時
 */
function rainTarget_(now) {
  const h = Number(Utilities.formatDate(now, TZ, 'H'));
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  if (h >= 19) {
    const tomorrow = Utilities.formatDate(new Date(now.getTime() + 24 * 60 * 60 * 1000), TZ, 'yyyy-MM-dd');
    return { day: tomorrow, hour: '06', morning: true, title: '明天早上 6–9 點' };
  }
  if (h < 9) return { day: today, hour: '06', morning: true, title: '今天早上 6–9 點' };
  const start = Math.floor(h / 3) * 3;
  const pad = n => ('0' + n).slice(-2);
  return { day: today, hour: pad(start), morning: false, title: '今天 ' + start + '–' + (start + 3) + ' 點' };
}

// ===== LINE 回覆、紀錄 =====

/**
 * answer 可以是一段文字、一個 LINE 訊息物件，或是它們的陣列（最多 5 則）。
 * 不放輸入框上面那排「快速回覆」：按鈕都做在訊息裡（卡片.gs 的 card_、choices_），會留在聊天室。
 */
function reply_(replyToken, answer) {
  // 純文字也包成卡片（卡片.gs 的 textCard_）：所有回覆都是卡片
  const messages = (Array.isArray(answer) ? answer : [answer])
    .map(m => (typeof m === 'string' ? textCard_(m) : m));
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
