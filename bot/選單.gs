/**
 * 主選單和「用點的」流程：每個功能都有按鈕，不用記關鍵字、不用打字
 *
 * 按鈕都做在訊息裡（卡片.gs 的 choices_），不用輸入框上面那排快速回覆。
 *   「選單」        → 一則訊息，四個分類的按鈕（照專案的模組分）
 *   按一個分類      → Bot 把那一類的功能按鈕傳到聊天室
 *   「出門時間」    → 一張卡片選哪一天、最早第幾節 → 出門建議（原本要打「明天早八 D 棟」）
 *   加好友          → 新生須知（新生.gs）＋選單；看不懂的句子 → 回選單
 *
 * 要加新功能的按鈕：在 MENU 對應的分類加一列 [按鈕上的字, 按了傳出的字]。
 * tests/選單.test.js 會檢查每一顆按鈕傳出去的字 Bot 都認得。
 * 用到 卡片.gs 的 choices_，比較器.gs 的 PERIODS、BUILDINGS、ORIGINS、compareQuery_、timeOn_。
 */
// 四格（跟簡報一樣）。11/28：主要功能「預估到達時間」放在出門前提醒第一顆；回報排隊、新生須知放進公車站牌與排隊禮儀
const MENU = [
  {
    name: '出門前提醒',
    emoji: '🔔',
    hint: '想知道現在出發幾點到東吳？或是想提前規劃出門時間？也可以查詢 557 即時動態、其他公車路線及天氣資訊。',
    // 11/28 團隊設計稿（圖五）：按鈕傳出的字跟按鈕上的字一樣（去掉表情符號）
    buttons: [['📍 預估到達時間', '預估到達時間'], ['⏰ 出發時間規劃', '出發時間規劃'], ['🚌 557 即時動態', '557 即時動態'], ['🗺️ 比較所有路線', '比較所有路線'],
      ['🌧️ 降雨查詢', '降雨查詢'], ['🔔 雨天與考試週提醒', '雨天與考試週提醒']],
  },
  {
    name: '557 以外的選擇',
    emoji: '🔀',
    hint: '557 太擠，還有別條路！看看其他公車、共乘及替代交通方式，找到適合自己的通勤選擇。',
    buttons: [['🚕 計程車共乘', '計程車共乘'], ['🚲 YouBike 查詢', 'YouBike 查詢'], ['☂️ 共享雨傘', '共享雨傘'], ['🚐 包車調查', '包車調查']],
  },
  {
    // 圖文選單的圖如果還印舊名稱「公車站牌與排隊」，傳舊名稱一樣認得
    name: '公車站牌與排隊禮儀',
    emoji: '🚏',
    alias: '公車站牌與排隊',
    hint: '557 現在在哪裡上車、怎麼排隊？也可以回報你在哪一站排隊，一起改善通勤體驗。',
    // 11/28 團隊設計稿（圖七）：回報我在哪裡排隊排第一顆
    buttons: [['💬 回報我在哪裡排隊', '回報我在哪裡排隊'], ['📍 557 上車地點', '557 上車地點'], ['🎬 排隊禮儀短片', '排隊禮儀短片'], ['🎒 新生須知', '新生須知']],
  },
  {
    name: '積分與打卡',
    emoji: '🏅',
    hint: '到校、出校打卡都能集點！每天最多 3 點，累積 5 點即可兌換 30 元學餐折價券。',
    // 到校打卡 → 再選走路、早到、騎車；出校打卡 → 再選走路、騎車回士林（積分.gs 的 ptCheckinButton_）
    buttons: [['🏫 到校打卡', '到校打卡'], ['🏠 出校打卡', '出校打卡'], ['📒 我的紀錄', '我的紀錄'],
      ['🎟️ 兌換學餐折價券', '兌換學餐折價券'], ['🎫 我的折價券', '我的折價券'], ['🌱 全校減碳', '全校減碳']],
  },
  {
    // 主要功能：放在「出門前提醒」第一顆；傳名稱（含舊名稱）直接打開入口卡片（傳送我的位置／我已經在士林站）
    name: '預估到達時間',
    alias: '幾點出門、幾點到東吳',
    hidden: true,
    open: () => etaButton_(), // 到校預估.gs
  },
];

// 節次按鈕排兩欄，第 1～C 節（11/28 團隊設計稿拿掉第 D 節；中午的第 E 節很少排課，要用打的）
const MENU_PERIODS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C'];
// 有教室的大樓 12 棟，加上「不指定」
const MENU_BUILDINGS = ['B', 'D', 'R', 'H', 'G', 'F', 'C', 'N', 'M', 'P', 'Q', 'L'];

/** 「選單」：四個分類。按了分類，Bot 再傳那一類的功能按鈕 */
function menuCard_() {
  return choices_('今天要怎麼去學校？\n\n查出門時間、找其他交通方式，或看看怎麼避開 557 尖峰人潮。👇', // 卡片.gs
    MENU.filter(c => !c.hidden).map(c => [c.emoji + ' ' + c.name, c.name]), // 按鈕上有表情符號，傳出的字不變（跟圖文選單一樣）
    { title: '東吳通勤達人', badge: '選單', primary: false, menu: false });
}

/** 按了分類：把這一類的功能按鈕傳到聊天室（只有一個功能的分類直接打開它）。不是分類名稱就回傳 null */
function menuCategory_(name) {
  const c = MENU.filter(x => x.name === name || x.alias === name)[0];
  if (!c) return null;
  if (c.open) return c.open();
  // 11/28 團隊設計稿（圖五～八）：左上「選單」、標題、灰字說明、分隔線，下面一顆一顆整行寬的按鈕，第一顆是磚紅
  return dsCard_({ kicker: '選單', title: c.name, blocks: [{ text: c.hint, muted: true }, { hr: true }], buttons: c.buttons }); // 卡片.gs
}

/** 加好友時：打招呼、新生須知（新生.gs）、選單 */
function menuWelcome_() {
  return [['嗨！我是東吳通勤達人 🚌', '', '每天擠 557 擠到懷疑人生？讓我幫你找更適合的通勤方式！', '', '📍 查出門時間', '🚌 找替代路線', '🎁 通勤集點換學餐折價券', '', '第一次來外雙溪校區？可以先看看新生須知，再從下方選單開始使用 👇'].join('\n'), nbIntro_(), menuCard_()];
}

/** 看不懂的句子：不要讓人卡住，直接給按鈕 */
function menuUnknown_() {
  // 一張卡片：先說看不懂、教兩種問法，下面直接放四個分類的按鈕
  return choices_('這個問題我看不太懂 😅\n\n你可以試試這樣問：\n・我明天 8 點在 D 棟上課\n・我想找 557 以外的通勤方式\n\n也可以直接點下面的分類 👇', // 卡片.gs
    MENU.filter(c => !c.hidden).map(c => [c.emoji + ' ' + c.name, c.name]), { title: '東吳通勤達人', badge: '看不懂這句話', primary: false, menu: false });
}

/**
 * 「出門時間」：11/28 團隊設計稿，一張卡片選完——上面選哪一天，下面選最早第幾節，按了節次直接出通勤預測（不再問大樓）。
 *   出門時間 [今天|明天]         → 同一張卡片，選的那天是磚紅；節次按鈕帶著這一天
 *   出門時間 今天|明天 HH:MM [大樓代號|不指定] [出發站] → 出門建議（舊按鈕帶大樓、出發站也還認得）
 */
function menuFlow_(text, uid) {
  const p = text.trim().split(/\s+/);
  let day = p[1], time = p[2], building = p[3], origin = p[4];
  const now = new Date();
  const left = MENU_PERIODS.filter(k => timeOn_(now, PERIODS[k]) > now); // 今天還沒開始的節次

  if (!/^\d{2}:\d{2}$/.test(time || '')) {
    if (day !== '今天' && day !== '明天') day = left.length ? '今天' : '明天'; // 沒選過就先選今天（今天的課都開始了就選明天）
    const periods = day === '明天' ? MENU_PERIODS : left;
    const blocks = [
      { hr: true },
      { h: '你哪一天要去學校？', first: true },
      { chips: ['今天', '明天'].map(d => ({ label: d, text: '出門時間 ' + d, selected: d === day })) },
      { hr: true },
      { h: '你最早第幾節有課？', first: true },
    ];
    if (periods.length) {
      blocks.push({ text: '請選擇當天最早需要到校的節次。', muted: true },
        { chips: periods.map(k => ({ label: '第 ' + k + ' 節 ' + PERIODS[k], text: '出門時間 ' + day + ' ' + PERIODS[k] })) });
    } else {
      blocks.push({ text: '今天的課都已經開始了，請改選明天。', muted: true });
    }
    blocks.push({ panel: { title: 'ⓘ 小提醒', lines: ['選擇當天最早的上課節次，系統將依照課程時間，幫你估算建議出門時間及預計抵達時間。'], quiet: true } });
    return dsCard_({ kicker: '出門前提醒', title: '⏰ 出發時間規劃', blocks: blocks }); // 卡片.gs
  }
  // 日期和節次已確定：先查放假／考試週。放假就不出建議卡。
  if (day !== '今天' && day !== '明天') day = '今天';
  if (ORIGINS[building]) { origin = building; building = ''; } // 出門時間 明天 08:10 劍南路站
  const ctx = classContext_({ day: day, arriveTime: time, building: BUILDINGS[building] ? building : '' });
  if (ctx.holiday) return holidayReply_(ctx);
  if (origin === '選出發站') {
    const base = ['出門時間', day, time, building || '不指定'].join(' ');
    return choices_('要從哪一個捷運站出發？', Object.keys(ORIGINS).map(name => [name, base + ' ' + name]), { title: '⏰ 出發時間規劃', badge: '換出發站', primary: false });
  }
  return compareQuery_({ // 比較器.gs：不問大樓，直接出通勤預測（走進校園的時間用一般情況）
    intent: '去學校',
    arriveTime: time,
    building: BUILDINGS[building] ? building : '',
    day: day,
    origin: ORIGINS[origin] ? origin : '',
  }, BUILDINGS[building] || / 不指定( |$)/.test(text) ? text : text + ' 不指定'); // 沒選大樓＝不指定（compareQuery_ 看到「不指定」就不再問大樓）
}

/** 按鈕上的大樓名稱：大家習慣叫簡稱的用簡稱，其他用全名 */
function menuBuildingName_(code) {
  return { B: '綜大', D: '二教', R: '一教' }[code] || BUILDINGS[code][0];
}
