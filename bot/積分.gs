/**
 * 積分帳本（模組四）：步行積分（11）、早到獎勵（4）、碳足跡看板（51）、通勤成就（35）
 * 步行、騎車、早到一次都是 1 點；集滿 5 點換一張 30 元學餐折價券（傳「兌換折價券」）。
 *
 * 打卡不用 QR code（會被拍照外流），改用手機定位：
 *   在 LINE 傳「打卡」→ 打開打卡頁（一次性代碼，10 分鐘、用過即失效）→ 手機間隔約 3 秒回報兩次位置 → 伺服器用第二次定位算距離。
 *   - 進校：錢穆故居站打卡 → 同一天 6～20 分鐘內在校內打卡點再打一次：步行 +1
 *   - 出校：校內打卡點打卡 → 6～20 分鐘內在錢穆故居站再打一次：步行出校 +1（放學分流）。
 *     兩個方向一天各一次；當天拿過進校點的，要在學校待滿 50 分鐘才算出校
 *   - 打卡結果依人在哪裡告訴他下一步（在校內就說「走出去再打」，在錢穆故居站就說「走進來再打」）
 *   - 離校 500 公尺以外可打出門卡（只記距離）；7:30 前在校內打卡，而且當天已有出門卡、間隔夠久：早到 1 點（一天一次，不分交通方式）
 * 只記打卡點名稱、距離和誤差，不記經緯度。拒收時多記原因。
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
  COUPON_POINTS: 5,     // 幾點換一張學餐折價券
  COUPON_VALUE: 30,     // 折價券面額（元）
  COUPON_DAYS: 30,      // 兌換後幾天內要用
  WALK_MIN_MIN: 6,       // 起點到校至少要隔這麼久才算步行
  WALK_MAX_MIN: 20,      // 起點打卡後幾分鐘內到校才算步行（要同一天）
  STAY_MIN_MIN: 50,      // 今天拿過進校步行點，要在學校待這麼久（一節課）才能拿出校步行點，避免進校馬上走出去刷點
  EARLY_BEFORE: '07:30',
  NEAR_M: 50,           // 離錢穆故居站多近算「在站牌」
  CAMPUS_M: 30,         // 離任何一個校內打卡點（PT_CAMPUS_POINTS）多近算「在學校」
  MAX_ACCURACY_M: 50,   // 定位誤差超過這個數字不收
  DEPART_MIN_M: 500,    // 離校內打卡點至少這麼遠，才算出門卡
  DEPART_MIN_PER_KM: 1, // 出門卡到到校，每公里至少要隔幾分鐘
  FIX_MAX_AGE_SEC: 30,  // 定位時間戳最多比送出早幾秒
  BIKE_MAX_LAG_MIN: 60, // YouBike 還車時間跟上傳最多差幾分鐘
  WALK_KM: 0.8,         // 錢穆故居站到校內，少搭的公車距離
  BIKE_KM: 3.5,         // 士林站到東吳
  // 市區公車（甲類）每人每公里 76.7 公克 CO₂e：環境部產品碳足跡資訊網，2017 年公告。
  // 這個數字是從引用該網站的文章查到的，放進簡報前要到產品碳足跡資訊網核對一次。
  BUS_G_PER_KM: 76.7,
};

const PT_START = '錢穆故居站';
const PT_CAMPUS = '校內 557 站';
const PT_WALK_OUT = '步行出校'; // 通勤紀錄的方式：校內 → 錢穆故居站。進校叫「步行」（舊紀錄沿用），兩個方向一天各一次
// 校內打卡點：[緯度, 經度, 範圍公尺（沒寫就用 PT.CAMPUS_M）]。在任何一個點的範圍內都算到校，記錄寫最近的那個點。
// 大樓座標是 OpenStreetMap 建築輪廓的中心（2026-11-26 查）。D 棟跟 Google 地圖比對差約 24 公尺，其他棟還沒現場核對。
const PT_CAMPUS_POINTS = {
  [PT_CAMPUS]: [25.09457, 121.54575], // 跟定位測試.gs 的 GEO_POINTS 同一個點（TDX 站牌位置）；不直接引用，因為 Apps Script 檔案載入順序不保證
  'A 棟寵惠堂': [25.09437, 121.54573],
  'B 棟綜合大樓': [25.09401, 121.54650, 40], // 校內最大的一棟，範圍放大
  'D 棟第二教研大樓': [25.09453, 121.54717],
  'G 棟戴蓀堂': [25.09411, 121.54575],
  'H 棟哲生樓': [25.09370, 121.54587],
  'M 棟超庸館': [25.09404, 121.54463],
  'N 棟中正圖書館': [25.09345, 121.54645],
  'R 棟第一教學研究大樓': [25.09305, 121.54627],
};

/** 離哪一個校內打卡點最近（扣掉各點範圍後最近）：[名稱, 公尺, 範圍] */
function ptNearestCampus_(here) {
  return Object.keys(PT_CAMPUS_POINTS)
    .map(name => {
      const p = PT_CAMPUS_POINTS[name];
      return [name, ptMeters_(here, p), p[2] || PT.CAMPUS_M];
    })
    .sort((a, b) => (a[1] - a[2]) - (b[1] - b[2]))[0];
}
const PT_COUPON_HEAD = ['時間', '使用者 ID', '券號', '面額', '狀態', '到期日'];
const PT_LOG_HEAD = ['時間', '使用者 ID', '方式', '積分', '少排放（公克）', '備註'];
const PT_CHECKIN_HEAD = ['時間', '使用者 ID', '打卡點', '距離（公尺）', '誤差（公尺）', '結果', '原因'];

/** 成就：[名稱, 條件說明, 判斷] */
const PT_BADGES = [
  ['新生上路', '新生測驗全對', s => s.測驗 >= 1],
  ['走路達人', '在錢穆故居站和學校之間步行 5 次（進校、出校都算）', s => s.步行 >= 5],
  ['早鳥', '7:30 前到校 3 次', s => s.早到 >= 3],
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
  const s = { 步行: 0, 騎車: 0, 早到: 0, 測驗: 0, 共乘: 0, 減碳: 0 };
  cpSheet_('通勤紀錄', PT_LOG_HEAD).getDataRange().getValues().slice(1).forEach(r => {
    if (r[1] !== uid) return;
    if (r[2] === PT_WALK_OUT) s.步行 += 1; // 出校也算步行
    else if (r[2] in s) s[r[2]] += 1;
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

/** 「打卡」：發一組 10 分鐘、用過即失效的代碼，打開打卡頁。優惠券頁仍用 user.token。 */
function ptOnceKey_(code) {
  return 'pt_once_' + code;
}

function ptCheckinButton_(uid) {
  const code = Utilities.getUuid();
  CacheService.getScriptCache().put(ptOnceKey_(code), uid, 10 * 60);
  return choices_('早到：先在離學校 ' + PT.DEPART_MIN_M + ' 公尺外打出門卡，7:30 前再到學校打卡。\n步行：在錢穆故居站先打一次，同一天 ' + PT.WALK_MIN_MIN + '～' + PT.WALK_MAX_MIN + ' 分鐘內走進學校再打一次。\n一次 1 點，集滿 ' + PT.COUPON_POINTS + ' 點換 ' + PT.COUPON_VALUE + ' 元學餐折價券。', // 卡片.gs
    [{ label: '打開打卡頁', uri: cpWebAppUrl_() + '?page=checkin&t=' + code }, ['我的紀錄', '我的紀錄']],
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

/** 「確認兌換折價券」：扣 5 點，給一張 30 元學餐折價券。券號記在「學餐折價券」分頁，學餐對號核銷 */
function ptRedeem_(uid) {
  return cpLocked_(() => { // 共乘.gs
    const user = cpUser_(uid);
    if (user.points < PT.COUPON_POINTS) return ptRedeemAsk_(uid);
    user.points -= PT.COUPON_POINTS;
    cpSaveUser_(user);
    const now = cpNow_();
    const sheet = cpSheet_('學餐折價券', PT_COUPON_HEAD);
    const code = 'SC' + Utilities.formatDate(now, TZ, 'MMdd') + '-' + ('000' + sheet.getLastRow()).slice(-4);
    const until = new Date(now.getTime() + PT.COUPON_DAYS * 24 * 60 * 60 * 1000);
    sheet.appendRow([now, uid, code, PT.COUPON_VALUE, '未使用', Utilities.formatDate(until, TZ, 'yyyy/MM/dd')]);
    cpSheet_('通勤紀錄', PT_LOG_HEAD).appendRow([now, uid, '兌換', -PT.COUPON_POINTS, 0, code]);
    return ['🎫 兌換成功！剩下 ' + user.points + ' 點。', ptCouponCard_(user, ptCoupons_(uid).filter(c => c.code === code)[0])];
  });
}

// ===== 學餐折價券：聊天室裡的券卡片、我的折價券、點開後的券頁面 =====

/** 這個人的折價券（新的在前）。expired：已過期 */
function ptCoupons_(uid) {
  const today = Utilities.formatDate(cpNow_(), TZ, 'yyyy/MM/dd');
  return cpSheet_('學餐折價券', PT_COUPON_HEAD).getDataRange().getValues().slice(1)
    .filter(r => r[1] === uid)
    .map(r => {
      const until = r[5] instanceof Date ? Utilities.formatDate(r[5], TZ, 'yyyy/MM/dd') : String(r[5] || '');
      return { at: new Date(r[0]), code: r[2], value: r[3], status: r[4], until: until, expired: !!until && until < today };
    })
    .reverse();
}

function ptCouponUrl_(user, code) {
  return cpWebAppUrl_() + '?page=coupon&t=' + user.token + '&c=' + encodeURIComponent(code); // 共乘.gs
}

/** 一張券的卡片：上面一塊磚紅色的「票面」，下面是到期日、優惠內容、查看此券 */
function ptCouponCard_(user, c) {
  const image = PROPS.getProperty('COUPON_IMAGE_URL'); // 有準備好的橫幅圖片（公開網址）就放在最上面
  const face = {
    type: 'box', layout: 'vertical', backgroundColor: UI.brand, paddingAll: '20px', spacing: 'xs',
    contents: [
      { type: 'text', text: '東吳通勤達人', size: 'xs', color: UI.onBrandSoft },
      { type: 'text', text: c.value + ' 元', size: '3xl', weight: 'bold', color: UI.onBrand },
      { type: 'text', text: '學餐折價券', size: 'lg', weight: 'bold', color: UI.onBrand },
      { type: 'text', text: '🎫 通勤集點兌換', size: 'xs', color: UI.onBrandSoft },
    ],
  };
  const line = (label, value) => ({ type: 'box', layout: 'horizontal', contents: [
    { type: 'text', text: label, size: 'sm', color: UI.muted, flex: 2 },
    { type: 'text', text: value, size: 'sm', color: UI.ink, flex: 5, wrap: true },
  ] });
  const bubble = {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '16px', spacing: 'md', contents: [
      { type: 'text', text: c.value + ' 元學餐折價券', size: 'lg', weight: 'bold', color: UI.ink },
      { type: 'text', text: c.until + ' 到期', size: 'sm', weight: 'bold', color: UI.muted },
      { type: 'separator', color: UI.line },
      line('優惠內容', '東吳學餐折抵 ' + c.value + ' 元'),
      line('券號', c.code),
    ] },
    footer: { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '12px', paddingTop: '0px', spacing: 'sm', contents: [
      { type: 'button', style: 'primary', color: UI.brand, height: 'sm', action: { type: 'uri', label: '查看此券', uri: ptCouponUrl_(user, c.code) } },
      { type: 'button', style: 'link', color: UI.brandDark, height: 'sm', action: { type: 'message', label: '我的折價券', text: '我的折價券' } },
    ] },
  };
  if (image) bubble.hero = { type: 'image', url: image, size: 'full', aspectRatio: '20:9', aspectMode: 'cover' };
  else bubble.header = face;
  return { type: 'flex', altText: c.value + ' 元學餐折價券｜券號 ' + c.code + '｜' + c.until + ' 到期', contents: bubble };
}

/** 「我的折價券」：還能用的券，一張一張排成可以左右滑的卡片 */
function ptMyCoupons_(uid) {
  const user = cpUser_(uid);
  const usable = ptCoupons_(uid).filter(c => c.status === '未使用' && !c.expired);
  if (!usable.length) {
    return card_({ // 卡片.gs
      badge: '積分與打卡',
      title: '我的折價券',
      notes: ['目前沒有可以用的折價券。早到、步行、騎車到校一次 1 點，集滿 ' + PT.COUPON_POINTS + ' 點就能換一張 ' + PT.COUPON_VALUE + ' 元學餐折價券。'],
      buttons: user.points >= PT.COUPON_POINTS ? [{ label: '兌換學餐折價券', text: '兌換折價券' }] : [],
    });
  }
  const cards = usable.slice(0, 10).map(c => ptCouponCard_(user, c).contents);
  return { type: 'flex', altText: '我的折價券：' + usable.length + ' 張可以用', contents: cards.length === 1 ? cards[0] : { type: 'carousel', contents: cards } };
}

/** 點「查看此券」打開的網頁。代碼和券號都要對得上這個人，才看得到 */
function ptCouponPage_(token, code) {
  const user = cpUserByToken_(token); // 共乘.gs
  const c = user && ptCoupons_(user.id).filter(x => x.code === code)[0];
  const esc = v => String(v).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  let body;
  if (!c) {
    body = '<div class="card alone"><h2>找不到這張券</h2><p>請回 LINE 傳「我的折價券」再打開一次。</p></div>';
  } else {
    const state = c.status !== '未使用' ? '已使用' : c.expired ? '已過期' : '可以使用';
    body = '<div class="face"><small>東吳通勤達人</small><div class="big">' + esc(c.value) + '<span> 元</span></div><div>學餐折價券</div></div>'
      + '<div class="card"><h2>' + esc(c.value) + ' 元學餐折價券</h2>'
      + '<p class="date">' + esc(Utilities.formatDate(c.at, TZ, 'yyyy/MM/dd')) + ' ～ ' + esc(c.until) + '</p>'
      + '<p class="state ' + (state === '可以使用' ? 'ok' : 'off') + '">' + state + '</p>'
      + '<h3>券號</h3><p class="code">' + esc(c.code) + '</p>'
      + '<h3>優惠內容</h3><p>✦ 東吳學餐折抵 ' + esc(c.value) + ' 元</p>'
      + '<h3>使用方法</h3><ul>'
      + '<li>結帳時出示此頁面給學餐人員。</li>'
      + '<li>一張折價券限用一次。</li>'
      + '<li>請於 ' + esc(c.until) + ' 前使用，逾期失效。</li>'
      + '<li>本券為通勤集點兌換，不得兌換現金或找零。</li>'
      + '</ul></div>';
  }
  return HtmlService.createHtmlOutput(PT_COUPON_HTML.replace('__BODY__', body))
    .setTitle('學餐折價券')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

const PT_COUPON_HTML = `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><base target="_top">
<style>
  body { margin:0; padding:16px; background:#EFE7DB; color:#1B1D22; font:16px/1.6 -apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif; }
  .face, .card { max-width:440px; margin:0 auto; box-sizing:border-box; }
  .face { background:#A63A2B; color:#fff; border-radius:16px 16px 0 0; padding:22px; font-weight:700; font-size:20px; }
  .face small { color:#F7DCD5; font-weight:400; font-size:13px; }
  .face .big { font-size:48px; line-height:1.1; } .face .big span { font-size:22px; }
  .card { background:#FBF7F0; border-radius:0 0 16px 16px; padding:20px 22px; }
  .card.alone { border-radius:16px; }
  h2 { margin:0; font-size:22px; } h3 { margin:18px 0 4px; font-size:15px; color:#6B6257; }
  .date { margin:2px 0 0; color:#6B6257; } .code { font-size:20px; font-weight:700; letter-spacing:1px; margin:0; }
  .state { display:inline-block; margin:10px 0 0; padding:2px 10px; border-radius:999px; font-size:14px; font-weight:700; }
  .ok { background:#E7F1E4; color:#2E6B2A; } .off { background:#EDE6DD; color:#6B6257; }
  ul { margin:0; padding-left:20px; } li { margin:2px 0; }
</style></head>
<body>__BODY__</body></html>`;

/** 「全校減碳」（51）：全部人的加總，對應 SDG 11、SDG 13 */
function ptSchool_() {
  const rows = cpSheet_('通勤紀錄', PT_LOG_HEAD).getDataRange().getValues().slice(1);
  const count = mode => rows.filter(r => r[2] === mode).length;
  const total = rows.reduce((sum, r) => sum + (Number(r[4]) || 0), 0);
  const people = Object.keys(rows.reduce((set, r) => { set[r[1]] = 1; return set; }, {})).length;
  const board = PROPS.getProperty('LOOKER_URL');
  return card_({ // 卡片.gs
    badge: '🌱 全校減碳看板',
    title: '大家一起少排放了 ' + (total / 1000).toFixed(2) + ' 公斤 CO₂',
    rows: [
      { label: '參與人數', value: people + ' 人', best: true },
      { label: '步行（進校＋出校）', value: (count('步行') + count(PT_WALK_OUT)) + ' 次' },
      { label: '騎車到校', value: count('騎車') + ' 次' },
    ],
    footer: '少搭的公車距離 × 市區公車每人每公里 ' + PT.BUS_G_PER_KM + ' 公克 CO₂e（環境部產品碳足跡資訊網）',
    buttons: board ? [{ label: '看完整看板', uri: board }] : [],
  });
}

/**
 * 「騎車到校」：還車後把 YouBike App 的騎乘紀錄（或還車成功畫面）截圖傳給 Bot。
 * AI 讀出日期、借車站、還車站、還車時間：日期要是今天、還車站要在學校附近，
 * 同一筆騎乘紀錄只能用一次，一天只算一次。GPS 打卡分不出是不是騎車，所以改看 YouBike 自己的紀錄。
 */
const PT_BIKE_WAIT_MIN = 10;
const PT_BIKE_STATIONS = ['東吳大學', '至善臨溪路口', '國立故宮博物院', '梅林新村']; // 校內 557 站 700 公尺內的正式站名

/** 去掉截圖站名前的 YouBike2.0_ 與空白，再跟清單完全比對 */
function ptBikeStop_(name) {
  return String(name || '').replace(/YouBike2\.0_/g, '').replace(/[\s\u3000]+/g, '');
}

/** 還車時間（ride.date + HH:MM，台北時間）。看不懂回傳 null */
function ptBikeWhen_(ride) {
  const m = String(ride.time || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(ride.date || '')) return null;
  const stamp = new Date(ride.date + 'T' + ('0' + m[1]).slice(-2) + ':' + m[2] + ':00+08:00');
  return isNaN(stamp.getTime()) ? null : stamp;
}

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
  if (PT_BIKE_STATIONS.indexOf(ptBikeStop_(ride.to)) < 0) return '🚲 還車站是「' + ride.to + '」，要在學校附近還車才算騎車到校。';
  const returned = ptBikeWhen_(ride);
  if (!returned) return '🚲 看不出還車時間，請截圖有寫還車時間的紀錄再傳一次。';
  const lagMin = (cpNow_().getTime() - returned.getTime()) / 60000;
  if (lagMin < -5) return '🚲 還車時間是 ' + ride.time + '，比現在晚了超過 5 分鐘，不能用這張截圖。';
  if (lagMin > PT.BIKE_MAX_LAG_MIN) return '🚲 還車時間是 ' + ride.time + '，離現在超過 ' + PT.BIKE_MAX_LAG_MIN + ' 分鐘，請用剛還車的紀錄。';
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

function ptDay_(date) {
  return Utilities.formatDate(new Date(date), TZ, 'yyyy-MM-dd');
}

/** 1 →「1」、1.901 →「1.9」 */
function ptShowMin_(m) {
  const v = Math.round(m * 10) / 10;
  return Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1);
}

/** 兩次定位都要是數字、範圍正確。格式不對時不消耗代碼 */
function ptFixesOk_(fixes) {
  if (!Array.isArray(fixes) || fixes.length !== 2) return false;
  return fixes.every(f => {
    if (!f || typeof f !== 'object') return false;
    const num = v => typeof v === 'number' && isFinite(v);
    return num(f.lat) && num(f.lng) && num(f.accuracy) && num(f.ts) && Math.abs(f.lat) <= 90 && Math.abs(f.lng) <= 180 && f.accuracy >= 0;
  });
}

/**
 * 打卡頁回報兩次位置。這是公開網頁能呼叫的函式，所以每個參數都檢查格式。
 * fixes = [{ lat, lng, accuracy, ts }, { … }]，ts 是瀏覽器的 position.timestamp（毫秒）。
 * 回傳 { ok, title, lines }，打卡頁直接顯示。距離用第二次定位。
 */
function ptCheckin(code, fixes) {
  if (!/^[0-9a-f-]{36}$/.test(String(code || ''))) return { ok: false, title: '連結失效', lines: ['請回 LINE 再傳一次「打卡」。'] };
  if (!ptFixesOk_(fixes)) return { ok: false, title: '定位資料不正確', lines: ['請再試一次。'] };
  return cpLocked_(() => {
    const cache = CacheService.getScriptCache();
    const uid = cache.get(ptOnceKey_(code));
    if (!uid) return { ok: false, title: '連結失效', lines: ['請回 LINE 再傳一次「打卡」。連結 10 分鐘內有效，而且只能用一次。'] };
    cache.remove(ptOnceKey_(code)); // 用過即失效
    if (cache.get('checkin_' + uid)) return { ok: false, title: '剛剛打過了', lines: ['一分鐘後再試。'] };
    cache.put('checkin_' + uid, '1', 60);
    return ptCheckinAt_(uid, fixes);
  });
}

function ptCheckinAt_(uid, fixes) {
  const sheet = cpSheet_('打卡紀錄', PT_CHECKIN_HEAD);
  const now = cpNow_();
  const second = fixes[1];
  const here = [second.lat, second.lng];
  const accuracy = second.accuracy;
  const record = (spot, dist, result, reason) => sheet.appendRow([now, uid, spot, Math.round(dist), Math.round(accuracy), result, reason || '']);

  if (fixes.some(f => now.getTime() - f.ts > PT.FIX_MAX_AGE_SEC * 1000)) {
    record('', 0, '定位太舊', '定位時間比送出早超過 ' + PT.FIX_MAX_AGE_SEC + ' 秒');
    return { ok: false, title: '定位太舊', lines: ['定位時間超過 ' + PT.FIX_MAX_AGE_SEC + ' 秒，請重新定位再打卡。'] };
  }
  const a = fixes[0];
  if (a.lat === second.lat && a.lng === second.lng && a.accuracy === second.accuracy) {
    record('', 0, '定位重複', '兩次定位的座標與誤差完全相同');
    return { ok: false, title: '兩次定位相同', lines: ['兩次定位的座標與誤差完全一樣，請到室外重新定位再打卡。'] };
  }
  if (accuracy > PT.MAX_ACCURACY_M) {
    record('', 0, '誤差太大', '定位誤差超過 ' + PT.MAX_ACCURACY_M + ' 公尺');
    return { ok: false, title: '定位不夠準', lines: ['誤差約 ' + Math.round(accuracy) + ' 公尺。走到室外、打開 GPS 再試一次。'] };
  }
  const dStart = ptMeters_(here, GEO_POINTS[PT_START]);
  const [campusSpot, dCampus, campusRange] = ptNearestCampus_(here);

  if (dStart <= PT.NEAR_M) return ptAtStart_(uid, sheet, now, dStart, record);
  if (dCampus <= campusRange) return ptArrive_(uid, sheet, now, dCampus, record, campusSpot);
  if (dCampus >= PT.DEPART_MIN_M) {
    record('出門', dCampus, '出門', '');
    const need = dCampus / 1000 * PT.DEPART_MIN_PER_KM;
    return { ok: true, title: '出門打卡成功', lines: ['已記錄出門，離學校大約 ' + Math.round(dCampus) + ' 公尺（只記距離，不記地點）。', '7:30 前到校再打卡就有早到點。這段約 ' + (dCampus / 1000).toFixed(1) + ' 公里，中間至少要隔 ' + ptShowMin_(need) + ' 分鐘。'] };
  }
  const nearer = dStart < dCampus ? [PT_START, dStart] : [campusSpot, dCampus];
  record('', nearer[1], '不在打卡點', '離' + nearer[0] + '還有大約 ' + Math.round(nearer[1]) + ' 公尺');
  return { ok: false, title: '不在打卡點附近', lines: ['離最近的打卡點「' + nearer[0] + '」還有大約 ' + Math.round(nearer[1]) + ' 公尺。',
    '打卡點：錢穆故居站，校內 557 站和 A、B、D、G、H、M、N、R 棟（' + PT.CAMPUS_M + ' 公尺內，B 棟 40 公尺）。離學校 ' + PT.DEPART_MIN_M + ' 公尺以外可以打出門卡。'] };
}

/** 人在錢穆故居站：
 *  - 今天 6～20 分鐘前在校內打過卡 → 出校步行完成（放學走到校外搭車，分散校內 557 站的人潮）
 *  - 不管有沒有完成出校，這次打卡也是「進校步行」的起點 */
function ptAtStart_(uid, sheet, now, dStart, record) {
  const lines = ['📍 ' + PT_START];
  const reasons = [];
  let fresh = [];
  let added = false;
  const today = ptDay_(now);
  if (!ptDoneToday_(uid, PT_WALK_OUT)) {
    const left = sheet.getDataRange().getValues().slice(1)
      .filter(r => r[1] === uid && PT_CAMPUS_POINTS[r[2]] && ptDay_(r[0]) === today && new Date(r[0]) <= now).pop();
    const elapsedMin = left ? (now - new Date(left[0])) / 60000 : Infinity;
    if (elapsedMin < PT.WALK_MIN_MIN) {
      reasons.push('出校少於 ' + PT.WALK_MIN_MIN + ' 分');
      lines.push('🚶 離開校內打卡才 ' + Math.max(1, Math.round(elapsedMin)) + ' 分鐘，出校步行要 ' + PT.WALK_MIN_MIN + '～' + PT.WALK_MAX_MIN + ' 分鐘，這次沒有步行點。');
    } else if (elapsedMin <= PT.WALK_MAX_MIN && ptMinSinceWalkIn_(uid, now) < PT.STAY_MIN_MIN) {
      reasons.push('進校後不到 ' + PT.STAY_MIN_MIN + ' 分');
      lines.push('🚶 今天拿過進校步行點，要在學校待滿 ' + PT.STAY_MIN_MIN + ' 分鐘（一節課）以後走出來，才有出校步行點。');
    } else if (elapsedMin <= PT.WALK_MAX_MIN) {
      const minutes = Math.round(elapsedMin);
      const co2 = PT.WALK_KM * PT.BUS_G_PER_KM;
      fresh = ptAdd_(uid, PT_WALK_OUT, PT.WALK, co2, minutes + ' 分鐘');
      added = true;
      lines.push('🚶 從學校走出來 ' + minutes + ' 分鐘，出校步行 +' + PT.WALK + ' 點');
      lines.push('少排放 ' + Math.round(co2) + ' 公克 CO₂');
    } else if (elapsedMin <= 60) {
      reasons.push('出校超過 ' + PT.WALK_MAX_MIN + ' 分');
      lines.push('🚶 離開校內打卡已經 ' + Math.round(elapsedMin) + ' 分鐘，超過 ' + PT.WALK_MAX_MIN + ' 分鐘，這次沒有出校步行點。');
    }
  }
  if (!ptDoneToday_(uid, '步行') && !ptDoneToday_(uid, '騎車')) {
    lines.push('要進學校的話：' + PT.WALK_MIN_MIN + '～' + PT.WALK_MAX_MIN + ' 分鐘內在校內打卡點再打一次，就完成進校步行（' + PT.WALK + ' 點）。');
  }
  if (fresh.length) lines.push('🏅 解鎖成就：' + fresh.join('、'));
  record(PT_START, dStart, added ? '加分' : '起點', reasons.join('；'));
  if (added) lines.push('目前積分：' + cpUser_(uid).points + ' 點（' + PT.COUPON_POINTS + ' 點換 ' + PT.COUPON_VALUE + ' 元學餐折價券）');
  return { ok: true, title: added ? '出校步行完成' : '錢穆故居站打卡成功', lines: lines };
}

/** 今天拿到進校步行點到現在幾分鐘；今天沒拿過就是 Infinity */
function ptMinSinceWalkIn_(uid, now) {
  const today = ptDay_(now);
  const last = cpSheet_('通勤紀錄', PT_LOG_HEAD).getDataRange().getValues().slice(1)
    .filter(r => r[1] === uid && r[2] === '步行' && ptDay_(r[0]) === today).pop();
  return last ? (now - new Date(last[0])) / 60000 : Infinity;
}

/** 人在校內：步行（同一天 6～20 分鐘）和早到（當天先有出門卡、間隔夠久）分開判斷。
 *  這次有呼叫 ptAdd_（步行或早到）結果寫「加分」，都沒加才寫「到校」。
 *  新規則沒給點（不是今天、少於 6 分、超過 20 分、沒有出門卡、間隔太短）把簡短原因用「；」寫進原因欄。 */
function ptArrive_(uid, sheet, now, dCampus, record, campusSpot) {
  const lines = [];
  const reasons = [];
  let fresh = [];
  let added = false;
  const today = ptDay_(now);
  const rows = sheet.getDataRange().getValues().slice(1);
  const started = rows.filter(r => r[1] === uid && r[2] === PT_START && new Date(r[0]) <= now).pop();
  if (started && !ptDoneToday_(uid, '步行') && !ptDoneToday_(uid, '騎車')) {
    const elapsedMin = (now - new Date(started[0])) / 60000;
    const sameDay = ptDay_(started[0]) === today;
    if (!sameDay && elapsedMin <= PT.WALK_MAX_MIN) {
      reasons.push('不是今天');
      lines.push('🚶 錢穆故居站的打卡不是今天，步行要同一天完成，這次沒有步行點。');
    } else if (sameDay && elapsedMin < PT.WALK_MIN_MIN) {
      reasons.push('少於 ' + PT.WALK_MIN_MIN + ' 分');
      lines.push('🚶 只隔了 ' + Math.max(1, Math.round(elapsedMin)) + ' 分鐘，步行要 ' + PT.WALK_MIN_MIN + '～' + PT.WALK_MAX_MIN + ' 分鐘，這次沒有步行點。');
    } else if (sameDay && elapsedMin > PT.WALK_MAX_MIN) {
      reasons.push('超過 ' + PT.WALK_MAX_MIN + ' 分');
      lines.push('🚶 隔了 ' + Math.round(elapsedMin) + ' 分鐘，超過 ' + PT.WALK_MAX_MIN + ' 分鐘，這次沒有步行點。');
    } else if (sameDay) {
      const minutes = Math.max(1, Math.round(elapsedMin));
      const co2 = PT.WALK_KM * PT.BUS_G_PER_KM;
      fresh = fresh.concat(ptAdd_(uid, '步行', PT.WALK, co2, minutes + ' 分鐘'));
      added = true;
      lines.push('🚶 走了 ' + minutes + ' 分鐘，步行 +' + PT.WALK + ' 點');
      lines.push('少排放 ' + Math.round(co2) + ' 公克 CO₂');
    }
  }
  const hhmm = Utilities.formatDate(now, TZ, 'HH:mm');
  if (hhmm < PT.EARLY_BEFORE && !ptDoneToday_(uid, '早到')) {
    const departed = rows.filter(r => r[1] === uid && r[2] === '出門' && ptDay_(r[0]) === today && new Date(r[0]) <= now).pop();
    if (!departed) {
      reasons.push('沒有出門卡');
      lines.push('🌅 現在是 ' + hhmm + '，可是今天還沒有出門打卡，所以沒有早到點。出門要在離學校 ' + PT.DEPART_MIN_M + ' 公尺以外先打。');
    } else {
      const elapsedMin = (now - new Date(departed[0])) / 60000;
      const distM = Number(departed[3]) || 0;
      const needMin = distM / 1000 * PT.DEPART_MIN_PER_KM;
      if (elapsedMin < needMin) {
        reasons.push('間隔太短');
        lines.push('🌅 出門到到校只隔了 ' + ptShowMin_(elapsedMin) + ' 分鐘，這段約 ' + (distM / 1000).toFixed(1) + ' 公里至少要隔 ' + ptShowMin_(needMin) + ' 分鐘，所以沒有早到點。');
      } else {
        fresh = fresh.concat(ptAdd_(uid, '早到', PT.EARLY, 0, hhmm));
        added = true;
        lines.push('🌅 ' + hhmm + ' 到校，早到 +' + PT.EARLY + ' 點');
      }
    }
  }
  // 人已經在學校：下一步是走出去，不是叫他回錢穆故居站重來
  if (!added && !ptDoneToday_(uid, PT_WALK_OUT)) {
    lines.push('等一下要走出學校的話：' + PT.WALK_MIN_MIN + '～' + PT.WALK_MAX_MIN + ' 分鐘內在錢穆故居站再打一次，就完成出校步行（' + PT.WALK + ' 點）。');
  }
  if (fresh.length) lines.push('🏅 解鎖成就：' + fresh.join('、'));
  const spot = campusSpot || PT_CAMPUS;
  record(spot, dCampus, added ? '加分' : '到校', reasons.join('；'));
  return { ok: true, title: '到校打卡成功', lines: ['📍 ' + spot].concat(lines, ['目前積分：' + cpUser_(uid).points + ' 點（' + PT.COUPON_POINTS + ' 點換 ' + PT.COUPON_VALUE + ' 元學餐折價券）']) };
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
  <p>站在錢穆故居站或校內打卡點附近，按下面的「打卡」。手機問要不要允許定位，請按允許。</p>
  <div class="sub">只看你離哪個打卡點最近，不會記錄你的位置。</div>
  <button id="go" onclick="run()">打卡</button>
</div>
<div class="card" id="out" style="display:none"></div>
<script>
var TOKEN = '__TOKEN__', BOT = '__BOT__';
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function show(ok, title, lines, retry) {
  var out = document.getElementById('out');
  out.style.display = 'block';
  out.innerHTML = '<div class="big ' + (ok ? 'ok' : 'bad') + '">' + esc(title) + '</div>'
    + lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('')
    + '<a class="btn" href="https://line.me/R/oaMessage/' + encodeURIComponent(BOT) + '/?' + encodeURIComponent('我的紀錄') + '">回 LINE 看我的紀錄</a>';
  var btn = document.getElementById('go');
  if (retry) { btn.disabled = false; btn.textContent = '再打一次'; }
  else if (ok) { btn.disabled = true; btn.textContent = '✓ 已打卡，可以關掉這頁'; }
  else { btn.disabled = true; btn.textContent = '這個連結用過了，要再打請回 LINE 傳「打卡」'; }
}
function locate(done, fail) {
  navigator.geolocation.getCurrentPosition(done, fail, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
}
function onGeoError(err) {
  var why = { 1: '沒有允許定位。請到手機設定打開 LINE 的定位權限。', 2: '手機抓不到位置，走到室外再試一次。', 3: '等太久了，再試一次。' }[err.code] || '不明原因';
  show(false, '拿不到定位', [why], true);
}
function run() {
  var btn = document.getElementById('go');
  if (!('geolocation' in navigator)) return show(false, '拿不到定位', ['這個瀏覽器不支援定位。'], true);
  btn.disabled = true; btn.textContent = '定位中…（約 3 秒，抓兩次）';
  locate(function (first) {
    btn.textContent = '再定位一次…';
    setTimeout(function () {
      locate(function (second) {
        var fixes = [first, second].map(function (pos) {
          return { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, ts: pos.timestamp };
        });
        google.script.run
          .withSuccessHandler(function (r) { show(r.ok, r.title, r.lines, false); })
          .withFailureHandler(function () { show(false, '連線失敗', ['請回 LINE 再傳一次「打卡」。'], false); })
          .ptCheckin(TOKEN, fixes);
      }, onGeoError);
    }, 3000);
  }, onGeoError);
}
</script>
</body>
</html>`;
