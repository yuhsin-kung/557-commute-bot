/**
 * 積分帳本（模組四）：步行積分（11）、早到獎勵（4）、碳足跡看板（51）、通勤成就（35）
 * 步行、騎車、早到一次都是 1 點；集滿 3 點換一張 30 元學餐折價券（傳「兌換折價券」）。
 *
 * 打卡不用 QR code（會被拍照外流），改用手機定位：
 *   在 LINE 傳「打卡」→ 打開打卡頁 → 手機回報位置 → 伺服器算離哪個打卡點最近。
 *   - 在錢穆故居站打卡：開始計時
 *   - 25 分鐘內走到校內再打一次：步行完成，加分、記減碳量
 *   - 7:30 前在校內打卡：早到 1 點（一天一次）
 * 只記打卡點名稱、距離和誤差，不記經緯度。
 *
 * 積分跟共乘共用「共乘用戶」分頁的「積分」欄；每一筆加分記在「通勤紀錄」。
 * 成就不另外存，每次從紀錄算出來。
 * 用到 Code.gs 的 PROPS、TZ，共乘.gs 的 cpUser_、cpSheet_、cpLocked_、cpNow_，定位測試.gs 的 GEO_POINTS。
 */
const PT = {
  WALK: 1,              // 錢穆故居站走進學校
  BIKE: 1,              // 騎 YouBike 到校
  EARLY: 1,             // 7:30 前到校
  QUIZ: 1,              // 新生測驗全對
  UMBRELLA: 1,          // 借傘後歸還
  COUPON_POINTS: 3,     // 幾點換一張學餐折價券
  COUPON_VALUE: 30,     // 折價券面額（元）
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
  return choices_('早到：7:30 前在學校打卡。\n步行：在錢穆故居站先打一次，走進學校再打一次。\n一次 1 點，集滿 ' + PT.COUPON_POINTS + ' 點換 ' + PT.COUPON_VALUE + ' 元學餐折價券。', // 卡片.gs
    [{ label: '打開打卡頁', uri: cpWebAppUrl_() + '?page=checkin&t=' + cpUser_(uid).token }, ['我的紀錄', '我的紀錄']],
    { title: '到校打卡', badge: '積分' });
}

/** 「我的紀錄」 */
function ptMine_(uid) {
  const user = cpUser_(uid);
  const s = ptStats_(uid);
  const have = ptBadges_(s);
  const badges = PT_BADGES.map(b => (have.indexOf(b[0]) >= 0 ? '🏅 ' + b[0] : '▫️ ' + b[0] + '（' + b[1] + '）'));
  const coupons = Math.floor(user.points / PT.COUPON_POINTS);
  const text = [
    '📒 我的通勤紀錄',
    '',
    '積分：' + user.points + ' 點　信用分：' + user.credit,
    coupons ? '可以兌換 ' + coupons + ' 張 ' + PT.COUPON_VALUE + ' 元學餐折價券 🎫' : '再 ' + (PT.COUPON_POINTS - user.points % PT.COUPON_POINTS) + ' 點就能換一張 ' + PT.COUPON_VALUE + ' 元學餐折價券',
    '步行 ' + s.步行 + ' 次・騎車 ' + s.騎車 + ' 次・共乘 ' + s.共乘 + ' 次・早到 ' + s.早到 + ' 次',
    '累積少排放：' + (s.減碳 / 1000).toFixed(2) + ' 公斤 CO₂',
    '',
    '成就：',
  ].concat(badges).join('\n');
  return choices_(text, coupons ? [['兌換學餐折價券', '兌換折價券']] : [], { primary: coupons > 0 }); // 只有能兌換時才放按鈕
}

/** 「兌換折價券」：先告訴同學有幾點、可以換幾張，按「確認兌換」才真的扣點 */
function ptRedeemAsk_(uid) {
  const user = cpUser_(uid);
  const can = Math.floor(user.points / PT.COUPON_POINTS);
  if (!can) {
    return card_({ // 卡片.gs
      badge: '積分與打卡',
      title: '兌換學餐折價券',
      rows: [{ label: '目前積分', value: user.points + ' 點' }, { label: '還差', value: (PT.COUPON_POINTS - user.points) + ' 點', best: true }],
      notes: ['集滿 ' + PT.COUPON_POINTS + ' 點換一張 ' + PT.COUPON_VALUE + ' 元學餐折價券。早到、步行、騎車到校，一次都是 1 點。'],
      buttons: [{ label: '到校打卡', text: '打卡' }, { label: '騎車到校', text: '騎車到校' }],
    });
  }
  return card_({
    badge: '積分與打卡',
    title: '兌換學餐折價券',
    rows: [
      { label: '目前積分', value: user.points + ' 點' },
      { label: '可以兌換', value: can + ' 張', best: true },
      { label: '這次兌換', value: '1 張 ' + PT.COUPON_VALUE + ' 元，扣 ' + PT.COUPON_POINTS + ' 點' },
    ],
    notes: ['兌換後剩下 ' + (user.points - PT.COUPON_POINTS) + ' 點。要兌換嗎？'],
    buttons: [{ label: '確認兌換', text: '確認兌換折價券' }, { label: '先不要', text: '我的紀錄' }],
  });
}

/** 「確認兌換折價券」：扣 3 點，給一張 30 元學餐折價券。券號記在「學餐折價券」分頁，學餐對號核銷 */
function ptRedeem_(uid) {
  return cpLocked_(() => { // 共乘.gs
    const user = cpUser_(uid);
    if (user.points < PT.COUPON_POINTS) return ptRedeemAsk_(uid);
    user.points -= PT.COUPON_POINTS;
    cpSaveUser_(user);
    const now = cpNow_();
    const sheet = cpSheet_('學餐折價券', ['時間', '使用者 ID', '券號', '面額', '狀態']);
    const code = 'SC' + Utilities.formatDate(now, TZ, 'MMdd') + '-' + ('000' + sheet.getLastRow()).slice(-4);
    sheet.appendRow([now, uid, code, PT.COUPON_VALUE, '未使用']);
    cpSheet_('通勤紀錄', PT_LOG_HEAD).appendRow([now, uid, '兌換', -PT.COUPON_POINTS, 0, code]);
    return card_({
      badge: '🎫 兌換成功',
      title: PT.COUPON_VALUE + ' 元學餐折價券',
      rows: [{ label: '券號', value: code, best: true }, { label: '兌換時間', value: Utilities.formatDate(now, TZ, 'M/d HH:mm') }, { label: '剩下積分', value: user.points + ' 點' }],
      notes: ['結帳時出示這張券給學餐，一張用一次。'],
      buttons: [{ label: '我的紀錄', text: '我的紀錄' }],
    });
  });
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

/**
 * 「騎車到校」：還車後把 YouBike App 的騎乘紀錄（或還車成功畫面）截圖傳給 Bot。
 * AI 讀出日期、借車站、還車站、還車時間：日期要是今天、還車站要在學校附近，
 * 同一筆騎乘紀錄只能用一次，一天只算一次。GPS 打卡分不出是不是騎車，所以改看 YouBike 自己的紀錄。
 */
const PT_BIKE_WAIT_MIN = 10;
const PT_BIKE_CAMPUS = /東吳|外雙溪|錢穆|故宮|至善|臨溪|雙溪/; // 學校附近的還車站名稱

function ptBike_(uid) {
  if (ptDoneToday_(uid, '騎車')) return '今天已經記過騎車到校了，明天繼續 🚲';
  if (ptDoneToday_(uid, '步行')) return '今天已經記過步行到校了，一天記一種方式就好 🙂';
  CacheService.getScriptCache().put('bike_wait_' + uid, '1', PT_BIKE_WAIT_MIN * 60);
  return card_({ // 卡片.gs
    badge: '積分與打卡',
    title: '騎車到校',
    rows: [
      { label: '1', value: '騎 YouBike 到學校，在學校附近的站還車' },
      { label: '2', value: '打開 YouBike App，截圖這次的騎乘紀錄' },
      { label: '3', value: '把截圖直接傳給我' },
    ],
    notes: ['我會確認是今天的紀錄、還車站在學校附近，就加 ' + PT.BIKE + ' 點。' + PT_BIKE_WAIT_MIN + ' 分鐘內傳就可以。'],
  });
}

/** 收到照片：有在等騎車截圖才處理，不然回傳 null */
function ptBikePhoto_(uid, messageId) {
  const cache = CacheService.getScriptCache();
  if (!cache.get('bike_wait_' + uid)) return null;
  const ride = ptReadRide_(messageId);
  if (ride === null) return '🚲 暫時沒辦法辨識截圖，請過一分鐘再傳一次。';
  if (!ride) return '🚲 看不出這是 YouBike 的騎乘紀錄，請截圖 App 裡這次騎乘的紀錄再傳一次。';
  const today = Utilities.formatDate(cpNow_(), TZ, 'yyyy-MM-dd');
  if (ride.date !== today) return '🚲 這筆紀錄是 ' + ride.date + ' 的，要用今天的騎乘紀錄喔。';
  if (!PT_BIKE_CAMPUS.test(ride.to)) return '🚲 還車站是「' + ride.to + '」，要在學校附近還車才算騎車到校。';
  const key = [ride.date, ride.time, ride.from, ride.to].join('｜');
  return cpLocked_(() => { // 共乘.gs
    if (ptDoneToday_(uid, '騎車')) { cache.remove('bike_wait_' + uid); return '今天已經記過騎車到校了，明天繼續 🚲'; }
    const used = cpSheet_('通勤紀錄', PT_LOG_HEAD).getDataRange().getValues().slice(1).some(r => r[2] === '騎車' && r[5] === key);
    if (used) return '🚲 這筆騎乘紀錄已經用過了，一筆紀錄只能領一次。';
    cache.remove('bike_wait_' + uid);
    const co2 = PT.BIKE_KM * PT.BUS_G_PER_KM;
    const fresh = ptAdd_(uid, '騎車', PT.BIKE, co2, key);
    return '🚲 騎車到校 +' + PT.BIKE + ' 點\n' + ride.from + ' → ' + ride.to + '\n少排放 ' + Math.round(co2) + ' 公克 CO₂' + ptBadgeText_(fresh);
  });
}

/**
 * 從 LINE 下載截圖，請 AI 讀出騎乘紀錄。回傳 { date, time, from, to }；
 * 不是騎乘紀錄回傳空字串；AI 不能用回傳 null。
 */
function ptReadRide_(messageId) {
  const res = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + encodeURIComponent(messageId) + '/content', {
    headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return null;
  const blob = res.getBlob();
  const answer = geminiImage_( // 站位變更.gs
    '這是一張 YouBike App 的截圖。如果是一筆騎乘紀錄或還車成功的畫面，請只回一行 JSON：'
    + '{"date":"YYYY-MM-DD","time":"還車時間 HH:MM","from":"借車站名","to":"還車站名"}。'
    + '如果不是 YouBike 的騎乘紀錄，只回「不是」兩個字。',
    blob.getContentType() || 'image/jpeg', Utilities.base64Encode(blob.getBytes()));
  if (!answer) return null;
  const m = answer.match(/\{[\s\S]*\}/);
  if (!m) return '';
  try {
    const r = JSON.parse(m[0]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || !r.to) return '';
    return { date: r.date, time: String(r.time || ''), from: String(r.from || ''), to: String(r.to) };
  } catch (err) {
    return '';
  }
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
    return { ok: true, title: '錢穆故居站打卡成功', lines: ['開始計時！' + PT.WALK_MAX_MIN + ' 分鐘內走進學校再打一次卡，就有 ' + PT.WALK + ' 點。'] };
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
    lines.push('🚶 走了 ' + minutes + ' 分鐘，步行 +' + PT.WALK + ' 點');
    lines.push('少排放 ' + Math.round(co2) + ' 公克 CO₂');
  }
  const hhmm = Utilities.formatDate(now, TZ, 'HH:mm');
  if (hhmm < PT.EARLY_BEFORE && !ptDoneToday_(uid, '早到')) {
    fresh = fresh.concat(ptAdd_(uid, '早到', PT.EARLY, 0, hhmm));
    lines.push('🌅 ' + hhmm + ' 到校，早到 +' + PT.EARLY + ' 點');  }
  if (!lines.length) lines.push('到校打卡成功。先在錢穆故居站打卡再走進來才有步行積分；7:30 前到校有早到積分。');
  if (fresh.length) lines.push('🏅 解鎖成就：' + fresh.join('、'));
  record(PT_CAMPUS, dCampus, lines.length > 1 || fresh.length ? '加分' : '到校');
  return { ok: true, title: '到校打卡成功', lines: lines.concat(['目前積分：' + cpUser_(uid).points + ' 點（' + PT.COUPON_POINTS + ' 點換 ' + PT.COUPON_VALUE + ' 元學餐折價券）']) };
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
