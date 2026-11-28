/**
 * 積分帳本（模組四）：步行積分（11）、早到獎勵（4）、碳足跡看板（51）、通勤成就（35）
 * 步行、騎車、早到一次都是 1 點；集滿 5 點換一張 30 元學餐折價券（傳「兌換折價券」）。
 *
 * 打卡不用 QR code（會被拍照外流），改用手機定位：
 *   選單有三顆打卡按鈕（傳「打卡 進校／出校／早到」），先說步驟 → 打開打卡頁（一次性代碼，10 分鐘、用過即失效，記住是哪一種卡）
 *   → 手機間隔約 3 秒回報兩次位置 → 伺服器用第二次定位算距離。每種卡都要打兩次：
 *   - 走路進學校：錢穆故居站 → 6～20 分鐘內校內打卡點，+1（通勤紀錄寫「步行」）
 *   - 走路出學校：校內打卡點 → 6～20 分鐘內錢穆故居站，+1（「步行出校」，放學分流）。當天拿過進校點的，要在學校待滿 50 分鐘才算
 *   - 早到：離校 500 公尺外打出門卡 → 7:30 前校內打卡點，+1
 *   每種一天一次，全部加起來（含騎車、共乘獨行）一天最多 PT.DAILY_MAX 點。
 *   同方向走路和騎車都拿（例如走路進學校又騎車到校）不擋、也不跟學生講，交給異常偵測（打卡防弊改善.md 第五節）。
 *   打卡紀錄的「結果」欄記第一次是哪一種（進校起點、出校起點、出門），第二次只找同一種的第一次。
 *   騎車到校是另一個按鈕（傳 YouBike 騎乘紀錄截圖），在下面的 ptBike_。
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
  DAILY_MAX: 3,         // 一天最多拿幾點（走路、騎車、早到、共乘獨行加起來；新生測驗只有一次，不算）
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
    else if (r[2] === PT_BIKE_OUT) s.騎車 += 1; // 騎車回士林也算騎車
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

// 算進一天上限的方式（通勤紀錄的「方式」欄）
const PT_DAILY_MODES = ['步行', '步行出校', '早到', '騎車', '騎車出校'];

/** 今天已經拿了幾點：打卡、騎車，加上共乘獨行（記在共乘用戶的「上次獨行獎勵」） */
function ptPointsToday_(uid) {
  const today = Utilities.formatDate(cpNow_(), TZ, 'yyyy-MM-dd');
  const logged = cpSheet_('通勤紀錄', PT_LOG_HEAD).getDataRange().getValues().slice(1)
    .filter(r => r[1] === uid && PT_DAILY_MODES.indexOf(r[2]) >= 0 && Utilities.formatDate(new Date(r[0]), TZ, 'yyyy-MM-dd') === today)
    .reduce((sum, r) => sum + (Number(r[3]) || 0), 0);
  return logged + (cpUser_(uid).soloDay === today ? CP.SOLO_POINTS : 0); // 共乘.gs
}

/** 今天拿滿了沒 */
function ptFull_(uid) {
  return ptPointsToday_(uid) >= PT.DAILY_MAX;
}

const PT_FULL_TEXT = '今天已經拿滿 ' + PT.DAILY_MAX + ' 點了（一天最多 ' + PT.DAILY_MAX + ' 點），明天再來 🙂';

function ptBadgeText_(fresh) {
  return fresh.length ? '\n\n🏅 解鎖成就：' + fresh.join('、') : '';
}

// ===== LINE 訊息 =====

/** 「打卡」：發一組 10 分鐘、用過即失效的代碼，打開打卡頁。優惠券頁仍用 user.token。 */
function ptOnceKey_(code) {
  return 'pt_once_' + code;
}

/** 三種打卡：按鈕名稱、LINE 要傳的字、步驟說明。騎車到校是另一個流程（傳 YouBike 截圖） */
const PT_MODES = {
  進校: {
    name: '🚶 走路進學校', text: '打卡 進校',
    steps: () => '從錢穆故居站走進學校，一天 ' + PT.WALK + ' 點。\n\n'
      + '① 在錢穆故居站：按下面「打開打卡頁」打第一次\n'
      + '② 走進學校（' + PT.WALK_MIN_MIN + '～' + PT.WALK_MAX_MIN + ' 分鐘內）\n'
      + '③ 到了校內打卡點，再按一次「走路進學校」打第二次\n\n'
      + '校內打卡點：557 站、A、B、D、G、H、M、N、R 棟',
  },
  出校: {
    name: '🚶 走路出學校', text: '打卡 出校',
    steps: () => '放學走到錢穆故居站搭車，幫忙分散校內 557 站的人潮，一天 ' + PT.WALK + ' 點。\n\n'
      + '① 在校內打卡點：按下面「打開打卡頁」打第一次\n'
      + '② 走到錢穆故居站（' + PT.WALK_MIN_MIN + '～' + PT.WALK_MAX_MIN + ' 分鐘內）\n'
      + '③ 到了錢穆故居站，再按一次「走路出學校」打第二次\n\n'
      + '校內打卡點：557 站、A、B、D、G、H、M、N、R 棟。今天拿過進校點的話，要在學校待滿 ' + PT.STAY_MIN_MIN + ' 分鐘才算。',
  },
  早到: {
    name: '🌅 早到', text: '打卡 早到',
    steps: () => PT.EARLY_BEFORE + ' 前到學校，一天 ' + PT.EARLY + ' 點。\n\n'
      + '① 出門時（離學校 ' + PT.DEPART_MIN_M + ' 公尺以外）：按下面「打開打卡頁」打第一次\n'
      + '② ' + PT.EARLY_BEFORE + ' 前到了校內打卡點，再按一次「早到」打第二次\n\n'
      + '校內打卡點：557 站、A、B、D、G、H、M、N、R 棟',
  },
};

/** 「打卡」：沒選種類先問要打哪一種（mode 是「到校」只列到校的三種）；選了就說步驟，發一組 10 分鐘、用過即失效的代碼 */
function ptCheckinButton_(uid, mode) {
  const m = PT_MODES[mode];
  if (!m) {
    const bike = ['🚲 騎車到校', '騎車到校'];
    const pick = k => [PT_MODES[k].name, PT_MODES[k].text];
    const bikeOut = ['🚲 騎車回士林', '騎車回士林'];
    if (mode === '到校') {
      return choices_('怎麼來學校的？每種一天 1 點，一天最多 ' + PT.DAILY_MAX + ' 點。', [pick('進校'), pick('早到'), bike], // 卡片.gs
        { title: '到校打卡', badge: '積分', primary: false });
    }
    if (mode === '離校') {
      return choices_('怎麼離開學校？每種一天 1 點，一天最多 ' + PT.DAILY_MAX + ' 點。', [pick('出校'), bikeOut],
        { title: '出校打卡', badge: '積分', primary: false });
    }
    return choices_('要打哪一種卡？每種一天 1 點，集滿 ' + PT.COUPON_POINTS + ' 點換 ' + PT.COUPON_VALUE + ' 元學餐折價券。',
      [pick('進校'), pick('早到'), bike, pick('出校'), bikeOut],
      { title: '打卡', badge: '積分', primary: false });
  }
  const code = Utilities.getUuid();
  CacheService.getScriptCache().put(ptOnceKey_(code), uid + '|' + mode, 10 * 60);
  return choices_(m.steps(), [{ label: '打開打卡頁', uri: cpWebAppUrl_() + '?page=checkin&t=' + code }],
    { title: m.name.replace(/^\S+\s/, ''), badge: '打卡' });
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
      badge: '通勤集點與校園回饋',
      title: '兌換學餐折價券',
      rows: [{ label: '目前積分', value: user.points + ' 點' }, { label: '還差', value: (PT.COUPON_POINTS - user.points) + ' 點', best: true }],
      notes: ['集滿 ' + PT.COUPON_POINTS + ' 點換一張 ' + PT.COUPON_VALUE + ' 元學餐折價券。早到、步行、騎車到校，一次都是 1 點。'],
      buttons: [{ label: '到校打卡', text: '打卡' }, { label: '騎車到校', text: '騎車到校' }],
    });
  }
  return card_({
    badge: '通勤集點與校園回饋',
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
      badge: '通勤集點與校園回饋',
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
      { label: '騎車（到校＋回士林）', value: (count('騎車') + count(PT_BIKE_OUT)) + ' 次' },
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
// 捷運士林站 400 公尺內的正式站名（跟 YouBike.gs 的 YB_NEAR_MRT_M 同一個距離；2026-11-26 從臺北市 YouBike 2.0 開放資料查）
const PT_BIKE_MRT_STATIONS = ['中山中正路口', '福林公園', '捷運士林站(1號出口)', '捷運士林站(2號出口)',
  '中山北路五段698巷口', '中山北路五段505巷口', '志成中正路口', '捷運線型公園(後街)'];
const PT_BIKE_OUT = '騎車出校'; // 通勤紀錄的方式：學校借車、士林站附近還車。進校叫「騎車」

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

/** 「騎車回士林」：學校借 YouBike，騎到士林站附近還車，傳騎乘紀錄截圖 */
function ptBikeOut_(uid) {
  if (ptDoneToday_(uid, PT_BIKE_OUT)) return '今天已經記過騎車回士林了，明天繼續 🚲';
  if (ptFull_(uid)) return PT_FULL_TEXT;
  CacheService.getScriptCache().put('bike_wait_' + uid, '回士林', PT_BIKE_WAIT_MIN * 60);
  return card_({ // 卡片.gs
    badge: '出校打卡',
    title: '騎車回士林',
    rows: [
      { label: '1', value: '在學校附近的站借 YouBike（東吳大學、至善臨溪路口、故宮、梅林新村）' },
      { label: '2', value: '騎到捷運士林站附近的站還車' },
      { label: '3', value: '打開 YouBike App，截圖這次的騎乘紀錄，直接傳給我' },
    ],
    notes: ['我會確認是今天、從學校附近借、在士林站附近還，就加 ' + PT.BIKE + ' 點。' + PT_BIKE_WAIT_MIN + ' 分鐘內傳就可以。'],
  });
}

function ptBike_(uid) {
  if (ptDoneToday_(uid, '騎車')) return '今天已經記過騎車到校了，明天繼續 🚲';
  if (ptFull_(uid)) return PT_FULL_TEXT;
  CacheService.getScriptCache().put('bike_wait_' + uid, '到校', PT_BIKE_WAIT_MIN * 60);
  return card_({ // 卡片.gs
    badge: '通勤集點與校園回饋',
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
  const waiting = cache.get('bike_wait_' + uid);
  if (!waiting) return null;
  const out = waiting === '回士林'; // 舊的等待標記是 '1'，當作到校
  const ride = ptReadRide_(messageId);
  if (ride === null) return '🚲 暫時沒辦法辨識截圖，請過一分鐘再傳一次。';
  if (!ride) return '🚲 看不出這是 YouBike 的騎乘紀錄，請截圖 App 裡這次騎乘的紀錄再傳一次。';
  const today = Utilities.formatDate(cpNow_(), TZ, 'yyyy-MM-dd');
  if (ride.date !== today) return '🚲 這筆紀錄是 ' + ride.date + ' 的，要用今天的騎乘紀錄喔。';
  if (out) {
    if (PT_BIKE_STATIONS.indexOf(ptBikeStop_(ride.from)) < 0) return '🚲 借車站是「' + ride.from + '」，要從學校附近借車才算騎車回士林。';
    if (PT_BIKE_MRT_STATIONS.indexOf(ptBikeStop_(ride.to)) < 0) return '🚲 還車站是「' + ride.to + '」，要在捷運士林站附近還車才算騎車回士林。';
  } else if (PT_BIKE_STATIONS.indexOf(ptBikeStop_(ride.to)) < 0) return '🚲 還車站是「' + ride.to + '」，要在學校附近還車才算騎車到校。';
  const returned = ptBikeWhen_(ride);
  if (!returned) return '🚲 看不出還車時間，請截圖有寫還車時間的紀錄再傳一次。';
  const lagMin = (cpNow_().getTime() - returned.getTime()) / 60000;
  if (lagMin < -5) return '🚲 還車時間是 ' + ride.time + '，比現在晚了超過 5 分鐘，不能用這張截圖。';
  if (lagMin > PT.BIKE_MAX_LAG_MIN) return '🚲 還車時間是 ' + ride.time + '，離現在超過 ' + PT.BIKE_MAX_LAG_MIN + ' 分鐘，請用剛還車的紀錄。';
  const key = [ride.date, ride.time, ride.from, ride.to].join('｜');
  return cpLocked_(() => { // 共乘.gs
    if (ptDoneToday_(uid, out ? PT_BIKE_OUT : '騎車')) {
      cache.remove('bike_wait_' + uid);
      return out ? '今天已經記過騎車回士林了，明天繼續 🚲' : '今天已經記過騎車到校了，明天繼續 🚲';
    }
    if (ptFull_(uid)) { cache.remove('bike_wait_' + uid); return PT_FULL_TEXT; }
    const used = cpSheet_('通勤紀錄', PT_LOG_HEAD).getDataRange().getValues().slice(1)
      .some(r => (r[2] === '騎車' || r[2] === PT_BIKE_OUT) && r[5] === key);
    if (used) return '🚲 這筆騎乘紀錄已經用過了，一筆紀錄只能領一次。';
    cache.remove('bike_wait_' + uid);
    const co2 = PT.BIKE_KM * PT.BUS_G_PER_KM;
    const fresh = ptAdd_(uid, out ? PT_BIKE_OUT : '騎車', PT.BIKE, co2, key);
    return '🚲 ' + (out ? '騎車回士林' : '騎車到校') + ' +' + PT.BIKE + ' 點\n' + ride.from + ' → ' + ride.to + '\n少排放 ' + Math.round(co2) + ' 公克 CO₂' + ptBadgeText_(fresh);
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
 * 回傳 { ok, title, lines, next }，打卡頁直接顯示；next 是第二次打卡要回 LINE 傳的字。距離用第二次定位。
 */
function ptCheckin(code, fixes) {
  if (!/^[0-9a-f-]{36}$/.test(String(code || ''))) return { ok: false, title: '連結失效', lines: ['請回 LINE 重新按一次打卡按鈕。'] };
  if (!ptFixesOk_(fixes)) return { ok: false, title: '定位資料不正確', lines: ['請再試一次。'] };
  return cpLocked_(() => {
    const cache = CacheService.getScriptCache();
    const [uid, mode] = String(cache.get(ptOnceKey_(code)) || '').split('|');
    if (!uid || !PT_MODES[mode]) return { ok: false, title: '連結失效', lines: ['請回 LINE 重新按一次打卡按鈕。連結 10 分鐘內有效，而且只能用一次。'] };
    cache.remove(ptOnceKey_(code)); // 用過即失效
    if (cache.get('checkin_' + uid)) return { ok: false, title: '剛剛打過了', lines: ['一分鐘後再試。'] };
    cache.put('checkin_' + uid, '1', 60);
    return ptCheckinAt_(uid, fixes, mode);
  });
}

/** 打卡頁的標題用：這組代碼是哪一種卡（不會用掉代碼） */
function ptModeOfCode_(code) {
  const mode = String(CacheService.getScriptCache().get(ptOnceKey_(code)) || '').split('|')[1];
  return PT_MODES[mode] ? mode : '';
}

function ptCheckinAt_(uid, fixes, mode) {
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
  const at = { now, record, sheet, uid, mode, dStart, dCampus, campusSpot,
    atStart: dStart <= PT.NEAR_M, atCampus: !(dStart <= PT.NEAR_M) && dCampus <= campusRange };

  if (mode === '進校') {
    if (at.atStart) return ptWalkInStart_(at);
    if (at.atCampus) return ptWalkInEnd_(at);
  } else if (mode === '出校') {
    if (at.atCampus) return ptWalkOutStart_(at);
    if (at.atStart) return ptWalkOutEnd_(at);
  } else if (mode === '早到') {
    if (dCampus >= PT.DEPART_MIN_M) return ptEarlyStart_(at);
    if (at.atCampus) return ptEarlyEnd_(at);
  }
  return ptWrongPlace_(at);
}

const PT_CAMPUS_LIST = '557 站、A、B、D、G、H、M、N、R 棟';

/** 不在這種卡該打的地方：說這種卡兩次各在哪裡打、現在離多遠 */
function ptWrongPlace_(at) {
  const km = m => (m < 1000 ? Math.round(m) + ' 公尺' : (m / 1000).toFixed(1) + ' 公里');
  const campus = '最近的校內打卡點「' + at.campusSpot + '」' + km(at.dCampus);
  let lines;
  if (at.mode === '進校') {
    lines = ['走路進學校：第一次在錢穆故居站打，第二次在校內打卡點打。', '你現在離錢穆故居站 ' + km(at.dStart) + '，離' + campus + '。'];
  } else if (at.mode === '出校') {
    lines = ['走路出學校：第一次在校內打卡點打，第二次在錢穆故居站打。', '你現在離' + campus + '，離錢穆故居站 ' + km(at.dStart) + '。'];
  } else {
    lines = ['早到：第一次要在離學校 ' + PT.DEPART_MIN_M + ' 公尺以外打（出門時），第二次在校內打卡點打。', '你現在離' + campus + '。'];
  }
  lines.push('校內打卡點：' + PT_CAMPUS_LIST + '（' + PT.CAMPUS_M + ' 公尺內，B 棟 40 公尺）；錢穆故居站 ' + PT.NEAR_M + ' 公尺內。');
  at.record('', Math.min(at.dStart, at.dCampus), '不在打卡點', PT_MODES[at.mode].name.replace(/^\S+\s/, '') + '：離錢穆故居站 ' + Math.round(at.dStart) + ' 公尺、離' + at.campusSpot + ' ' + Math.round(at.dCampus) + ' 公尺');
  return { ok: false, title: '不在打卡點附近', lines: lines };
}

function ptPointsLine_(uid) {
  return '目前積分：' + cpUser_(uid).points + ' 點（' + PT.COUPON_POINTS + ' 點換 ' + PT.COUPON_VALUE + ' 元學餐折價券）';
}

/** 第一次打卡成功：記下起點，告訴他第二次要去哪裡打 */
function ptFirstDone_(at, spot, dist, result, lines) {
  at.record(spot, dist, result, '');
  return { ok: true, title: '第一次打卡完成 ✓', lines: ['📍 ' + spot].concat(lines), next: PT_MODES[at.mode].text, nextLabel: '到了以後，回 LINE 打第二次' };
}

/** 今天已經拿過這種點：第一次、第二次都直接說，不用白走 */
function ptAlreadyDone_(at, spot, dist, text) {
  at.record(spot, dist, '今天拿過了', text);
  return { ok: false, title: '今天拿過了', lines: ['📍 ' + spot, text, ptPointsLine_(at.uid)] };
}

/** 第二次打卡：找今天最近一次第一次打卡（打卡紀錄的「結果」欄） */
function ptLastStart_(at, results) {
  const today = ptDay_(at.now);
  return at.sheet.getDataRange().getValues().slice(1)
    .filter(r => r[1] === at.uid && results.indexOf(r[5]) >= 0 && new Date(r[0]) <= at.now && ptDay_(r[0]) === today).pop();
}

/** 走路的第二次：檢查 6～20 分鐘，給點。extraCheck 回傳不給點的原因（或空字串） */
function ptWalkEnd_(at, spot, dist, opt) {
  const start = ptLastStart_(at, opt.startResults);
  if (!start) {
    at.record(spot, dist, '沒有第一次', opt.noStart);
    return { ok: false, title: '還沒打第一次', lines: ['📍 ' + spot, opt.noStart] };
  }
  const elapsedMin = (at.now - new Date(start[0])) / 60000;
  let why = '';
  let line = '';
  if (elapsedMin < PT.WALK_MIN_MIN) {
    why = '少於 ' + PT.WALK_MIN_MIN + ' 分';
    line = '只隔了 ' + Math.max(1, Math.round(elapsedMin)) + ' 分鐘，走路要 ' + PT.WALK_MIN_MIN + '～' + PT.WALK_MAX_MIN + ' 分鐘，這次沒有點數。';
  } else if (elapsedMin > PT.WALK_MAX_MIN) {
    why = '超過 ' + PT.WALK_MAX_MIN + ' 分';
    line = '隔了 ' + Math.round(elapsedMin) + ' 分鐘，超過 ' + PT.WALK_MAX_MIN + ' 分鐘，這次沒有點數。要重新從第一次打起。';
  } else if (opt.extraCheck) {
    [why, line] = opt.extraCheck();
  }
  if (why) {
    at.record(spot, dist, '沒加分', why);
    return { ok: false, title: '這次沒有點數', lines: ['📍 ' + spot, '🚶 ' + line, ptPointsLine_(at.uid)] };
  }
  const minutes = Math.max(1, Math.round(elapsedMin));
  const co2 = PT.WALK_KM * PT.BUS_G_PER_KM;
  const fresh = ptAdd_(at.uid, opt.logMode, PT.WALK, co2, minutes + ' 分鐘');
  at.record(spot, dist, '加分', '');
  const lines = ['📍 ' + spot, '🚶 走了 ' + minutes + ' 分鐘，+' + PT.WALK + ' 點', '少排放 ' + Math.round(co2) + ' 公克 CO₂'];
  if (fresh.length) lines.push('🏅 解鎖成就：' + fresh.join('、'));
  return { ok: true, title: opt.doneTitle, lines: lines.concat([ptPointsLine_(at.uid)]) };
}

// ----- 走路進學校：錢穆故居站 → 校內 -----

function ptWalkInStart_(at) {
  if (ptDoneToday_(at.uid, '步行')) return ptAlreadyDone_(at, PT_START, at.dStart, '今天已經拿過走路進學校的點了，明天再來 🙂');
  if (ptFull_(at.uid)) return ptAlreadyDone_(at, PT_START, at.dStart, PT_FULL_TEXT);
  return ptFirstDone_(at, PT_START, at.dStart, '進校起點',
    ['現在走進學校，' + PT.WALK_MIN_MIN + '～' + PT.WALK_MAX_MIN + ' 分鐘內到校內打卡點（' + PT_CAMPUS_LIST + '），再按一次「走路進學校」打第二次。']);
}

function ptWalkInEnd_(at) {
  if (ptDoneToday_(at.uid, '步行')) return ptAlreadyDone_(at, at.campusSpot, at.dCampus, '今天已經拿過走路進學校的點了，明天再來 🙂');
  if (ptFull_(at.uid)) return ptAlreadyDone_(at, at.campusSpot, at.dCampus, PT_FULL_TEXT);
  return ptWalkEnd_(at, at.campusSpot, at.dCampus, {
    startResults: ['進校起點', '起點'], // 「起點」是改版前的紀錄
    noStart: '今天還沒在錢穆故居站打第一次。走路進學校要先在錢穆故居站打卡，再走進來。',
    logMode: '步行',
    doneTitle: '走路進學校完成',
  });
}

// ----- 走路出學校：校內 → 錢穆故居站（放學分流） -----

function ptWalkOutStart_(at) {
  if (ptDoneToday_(at.uid, PT_WALK_OUT)) return ptAlreadyDone_(at, at.campusSpot, at.dCampus, '今天已經拿過走路出學校的點了，明天再來 🙂');
  if (ptFull_(at.uid)) return ptAlreadyDone_(at, at.campusSpot, at.dCampus, PT_FULL_TEXT);
  return ptFirstDone_(at, at.campusSpot, at.dCampus, '出校起點',
    ['現在走到錢穆故居站，' + PT.WALK_MIN_MIN + '～' + PT.WALK_MAX_MIN + ' 分鐘內再按一次「走路出學校」打第二次。']);
}

function ptWalkOutEnd_(at) {
  if (ptDoneToday_(at.uid, PT_WALK_OUT)) return ptAlreadyDone_(at, PT_START, at.dStart, '今天已經拿過走路出學校的點了，明天再來 🙂');
  if (ptFull_(at.uid)) return ptAlreadyDone_(at, PT_START, at.dStart, PT_FULL_TEXT);
  return ptWalkEnd_(at, PT_START, at.dStart, {
    startResults: ['出校起點'],
    noStart: '今天還沒在學校打第一次。走路出學校要先在校內打卡點打卡，再走出來。',
    logMode: PT_WALK_OUT,
    doneTitle: '走路出學校完成',
    // 進校馬上走出去不算：當天拿過進校點的，要在學校待滿一節課
    extraCheck: () => (ptMinSinceWalkIn_(at.uid, at.now) < PT.STAY_MIN_MIN + PT.WALK_MIN_MIN
      ? ['進校後不到 ' + PT.STAY_MIN_MIN + ' 分', '今天拿過走路進學校的點，要在學校待滿 ' + PT.STAY_MIN_MIN + ' 分鐘（一節課）以後走出來，才有走路出學校的點。']
      : ['', '']),
  });
}

/** 今天拿到進校步行點到現在幾分鐘；今天沒拿過就是 Infinity */
function ptMinSinceWalkIn_(uid, now) {
  const today = ptDay_(now);
  const last = cpSheet_('通勤紀錄', PT_LOG_HEAD).getDataRange().getValues().slice(1)
    .filter(r => r[1] === uid && r[2] === '步行' && ptDay_(r[0]) === today).pop();
  return last ? (now - new Date(last[0])) / 60000 : Infinity;
}

// ----- 早到：離校 500 公尺外打出門卡 → 7:30 前到校 -----

function ptEarlyStart_(at) {
  const hhmm = Utilities.formatDate(at.now, TZ, 'HH:mm');
  const spot = '出門（離學校約 ' + Math.round(at.dCampus) + ' 公尺）';
  if (ptDoneToday_(at.uid, '早到')) return ptAlreadyDone_(at, '出門', at.dCampus, '今天已經拿過早到的點了，明天再來 🙂');
  if (ptFull_(at.uid)) return ptAlreadyDone_(at, '出門', at.dCampus, PT_FULL_TEXT);
  if (hhmm >= PT.EARLY_BEFORE) {
    at.record('出門', at.dCampus, '太晚', '已經 ' + hhmm);
    return { ok: false, title: '已經過 ' + PT.EARLY_BEFORE + ' 了', lines: ['現在 ' + hhmm + '，今天來不及拿早到的點了。明天 ' + PT.EARLY_BEFORE + ' 前到校再試試看。'] };
  }
  const need = at.dCampus / 1000 * PT.DEPART_MIN_PER_KM;
  // 打卡點欄位寫「出門」、距離欄記離校距離：第二次用距離算最少要隔多久。只記距離，不記地點
  at.record('出門', at.dCampus, '出門', '');
  return { ok: true, title: '第一次打卡完成 ✓', next: PT_MODES.早到.text, nextLabel: '到學校以後，回 LINE 打第二次',
    lines: ['📍 ' + spot + '（只記距離，不記地點）', PT.EARLY_BEFORE + ' 前到校內打卡點（' + PT_CAMPUS_LIST + '），再按一次「早到」打第二次。這段約 ' + (at.dCampus / 1000).toFixed(1) + ' 公里，兩次中間至少要隔 ' + ptShowMin_(need) + ' 分鐘。'] };
}

function ptEarlyEnd_(at) {
  const hhmm = Utilities.formatDate(at.now, TZ, 'HH:mm');
  const spot = at.campusSpot;
  if (ptDoneToday_(at.uid, '早到')) return ptAlreadyDone_(at, spot, at.dCampus, '今天已經拿過早到的點了，明天再來 🙂');
  if (ptFull_(at.uid)) return ptAlreadyDone_(at, spot, at.dCampus, PT_FULL_TEXT);
  const departed = ptLastStart_(at, ['出門']);
  if (!departed) {
    at.record(spot, at.dCampus, '沒有第一次', '沒有出門卡');
    return { ok: false, title: '還沒打第一次', lines: ['📍 ' + spot, '今天還沒打出門卡。早到要先在出門時（離學校 ' + PT.DEPART_MIN_M + ' 公尺以外）打第一次。'] };
  }
  if (hhmm >= PT.EARLY_BEFORE) {
    at.record(spot, at.dCampus, '沒加分', '超過 ' + PT.EARLY_BEFORE);
    return { ok: false, title: '這次沒有點數', lines: ['📍 ' + spot, '🌅 現在 ' + hhmm + '，超過 ' + PT.EARLY_BEFORE + ' 了，這次沒有早到的點。', ptPointsLine_(at.uid)] };
  }
  const elapsedMin = (at.now - new Date(departed[0])) / 60000;
  const distM = Number(departed[3]) || 0;
  const needMin = distM / 1000 * PT.DEPART_MIN_PER_KM;
  if (elapsedMin < needMin) {
    at.record(spot, at.dCampus, '沒加分', '間隔太短');
    return { ok: false, title: '這次沒有點數', lines: ['📍 ' + spot, '🌅 出門到到校只隔了 ' + ptShowMin_(elapsedMin) + ' 分鐘，這段約 ' + (distM / 1000).toFixed(1) + ' 公里至少要隔 ' + ptShowMin_(needMin) + ' 分鐘，這次沒有點數。', ptPointsLine_(at.uid)] };
  }
  const fresh = ptAdd_(at.uid, '早到', PT.EARLY, 0, hhmm);
  at.record(spot, at.dCampus, '加分', '');
  const lines = ['📍 ' + spot, '🌅 ' + hhmm + ' 到校，+' + PT.EARLY + ' 點'];
  if (fresh.length) lines.push('🏅 解鎖成就：' + fresh.join('、'));
  return { ok: true, title: '早到完成', lines: lines.concat([ptPointsLine_(at.uid)]) };
}

function ptMeters_(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function ptCheckinPage_(token) {
  const mode = ptModeOfCode_(token);
  const title = mode ? PT_MODES[mode].name : '打卡';
  return HtmlService.createHtmlOutput(PT_CHECKIN_HTML.replace('__TOKEN__', token).replace('__BOT__', CP_BOT_ID).replace('__TITLE__', title))
    .setTitle(title.replace(/^\S+\s/, ''))
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
  a.btn.primary { background:#0b6e4f; color:#fff; }
  button:disabled { opacity:.5; }
  .big { font-size:24px; font-weight:700; margin:0 0 6px; }
  .ok { color:#0b6e4f; } .bad { color:#b42318; }
  .sub { color:#667085; font-size:14px; }
  p { margin:4px 0; }
</style>
</head>
<body>
<div class="card">
  <h1>__TITLE__</h1>
  <p>站在打卡點附近，按下面的「打卡」。手機問要不要允許定位，請按允許。</p>
  <div class="sub">只看你離哪個打卡點最近，不會記錄你的位置。</div>
  <button id="go" onclick="run()">打卡</button>
</div>
<div class="card" id="out" style="display:none"></div>
<script>
var TOKEN = '__TOKEN__', BOT = '__BOT__';
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function toLine(text) { return 'https://line.me/R/oaMessage/' + encodeURIComponent(BOT) + '/?' + encodeURIComponent(text); }
function show(ok, title, lines, retry, next, nextLabel) {
  var out = document.getElementById('out');
  out.style.display = 'block';
  // 第一次打完：主要按鈕是「回 LINE 打第二次」（會幫你填好要傳的字）；其他情況是看紀錄
  var link = next
    ? '<a class="btn primary" href="' + toLine(next) + '">' + esc(nextLabel || '回 LINE 打第二次') + '</a>'
    : '<a class="btn" href="' + toLine('我的紀錄') + '">回 LINE 看我的紀錄</a>';
  out.innerHTML = '<div class="big ' + (ok ? 'ok' : 'bad') + '">' + esc(title) + '</div>'
    + lines.map(function (l) { return '<p>' + esc(l) + '</p>'; }).join('') + link;
  var btn = document.getElementById('go');
  if (retry) { btn.disabled = false; btn.textContent = '再打一次'; }
  else if (ok) { btn.disabled = true; btn.textContent = '✓ 已送出，結果在下面'; }
  else { btn.disabled = true; btn.textContent = '這個連結用過了，要再打請回 LINE 按打卡按鈕'; }
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
          .withSuccessHandler(function (r) { show(r.ok, r.title, r.lines, false, r.next, r.nextLabel); })
          .withFailureHandler(function () { show(false, '連線失敗', ['請回 LINE 重新按一次打卡按鈕。'], false); })
          .ptCheckin(TOKEN, fixes);
      }, onGeoError);
    }, 3000);
  }, onGeoError);
}
</script>
</body>
</html>`;
