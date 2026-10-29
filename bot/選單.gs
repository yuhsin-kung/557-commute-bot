/**
 * 主選單和「用點的」流程：每個功能都有按鈕，不用記關鍵字、不用打字
 *
 * 按鈕都做在訊息裡（卡片.gs 的 choices_），不用輸入框上面那排快速回覆。
 *   「選單」        → 一則訊息，四個分類的按鈕（照專案的模組分）
 *   按一個分類      → Bot 把那一類的功能按鈕傳到聊天室
 *   「出門時間」    → 點哪一天 → 點第幾節 → 點哪一棟 → 出門建議（原本要打「明天早八 D 棟」）
 *   加好友          → 新生須知（新生.gs）＋選單；看不懂的句子 → 回選單
 *
 * 要加新功能的按鈕：在 MENU 對應的分類加一列 [按鈕上的字, 按了傳出的字]。
 * tests/選單.test.js 會檢查每一顆按鈕傳出去的字 Bot 都認得。
 * 用到 卡片.gs 的 choices_，比較器.gs 的 PERIODS、BUILDINGS、ORIGINS、compareQuery_、timeOn_。
 */
// 分類照《557 通勤平台：專案整理》的模組：學生會直接用到的是模組二、三、五，積分（模組四）另外一類
const MENU = [
  {
    name: '出門前提醒',
    hint: '幾點出門才不會趕？選好上課時間和教室，我幫你安排通勤時間。',
    buttons: [['比較所有路線', '比較所有路線'], ['出門時間建議', '出門時間'], ['557 即時動態', '557 即時動態'],
      ['降雨查詢', '降雨查詢'], ['雨天與考試週訂閱提醒', '訂閱提醒設定']],
  },
  {
    name: '557 以外的選擇',
    hint: '557 太擠，還有別條路！看看其他公車、共乘等替代方式，找到適合自己的通勤選擇。',
    buttons: [['計程車共乘', '共乘'], ['YouBike 車數', 'YouBike'], ['共享雨傘', '共享雨傘'], ['包車意願調查', '包車']],
  },
  {
    // 只有一顆按鈕：按了直接傳上車地點＋排隊禮儀短片（新生.gs 的 nbStopQueue_），不再多跳一層。
    // 圖文選單的圖如果還印舊名稱「公車站牌與排隊」，傳舊名稱一樣認得
    name: '公車站牌與排隊禮儀',
    alias: '公車站牌與排隊',
    open: () => nbStopQueue_(),
  },
  {
    name: '積分與打卡',
    hint: '早到、步行都能集點！累積 5 點，就能兌換 30 元學餐折價券。',
    buttons: [['到校打卡（早到、步行）', '打卡'], ['騎車到校', '騎車到校'], ['我的紀錄', '我的紀錄'],
      ['兌換學餐折價券', '兌換折價券'], ['我的折價券', '我的折價券'], ['全校減碳', '全校減碳']],
  },
];

// 一則訊息裡的按鈕排成兩欄，節次放 13 個（中午的第 E 節很少排課，要用打的）
const MENU_PERIODS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D'];
// 有教室的大樓 12 棟，加上「不指定」
const MENU_BUILDINGS = ['B', 'D', 'R', 'H', 'G', 'F', 'C', 'N', 'M', 'P', 'Q', 'L'];

/** 「選單」：四個分類。按了分類，Bot 再傳那一類的功能按鈕 */
function menuCard_() {
  return choices_('今天要怎麼去學校？\n\n查出門時間、找其他交通方式，或看看怎麼避開 557 尖峰人潮。👇', // 卡片.gs
    MENU.map(c => [c.name, c.name]),
    { title: '東吳通勤達人', badge: '選單', primary: false, menu: false });
}

/** 按了分類：把這一類的功能按鈕傳到聊天室（只有一個功能的分類直接打開它）。不是分類名稱就回傳 null */
function menuCategory_(name) {
  const c = MENU.filter(x => x.name === name || x.alias === name)[0];
  if (!c) return null;
  if (c.open) return c.open();
  return choices_(c.hint, c.buttons, { title: c.name, badge: '選單', primary: false });
}

/** 加好友時：打招呼、新生須知（新生.gs）、選單 */
function menuWelcome_() {
  return [['嗨！我是東吳通勤達人 🚌', '', '每天擠 557 擠到懷疑人生？讓我幫你找更適合的通勤方式！', '', '📍 查出門時間', '🚌 找替代路線', '🎁 通勤集點換學餐折價券', '', '第一次來外雙溪校區？可以先看看新生須知，再從下方選單開始使用 👇'].join('\n'), nbIntro_(), menuCard_()];
}

/** 看不懂的句子：不要讓人卡住，直接給按鈕 */
function menuUnknown_() {
  return ['這個問題我看不太懂 😅\n\n你可以試試這樣問：\n・我明天 8 點在 D 棟上課\n・我想找 557 以外的通勤方式\n\n也可以直接點下方選單，快速找到需要的功能！👇', menuCard_()];
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
    return choices_('哪一天要去學校？', [['今天', '出門時間 今天'], ['明天', '出門時間 明天']], { title: '出門時間建議', badge: '第 1 步', primary: false });
  }
  if (!/^\d{2}:\d{2}$/.test(time || '')) {
    // 今天只列還沒開始的節次
    const periods = MENU_PERIODS.filter(k => day === '明天' || timeOn_(now, PERIODS[k]) > now);
    if (!periods.length) return choices_('今天的課都已經開始了，要改看明天的上課時間嗎？', [['看明天的', '出門時間 明天']]);
    return choices_('你' + day + '第幾節有課？\n\n例如：第一節、第二節', periods.map(k => ['第 ' + k + ' 節 ' + PERIODS[k], '出門時間 ' + day + ' ' + PERIODS[k]]), { title: '出門時間建議', badge: '第 2 步' });
  }
  if (!BUILDINGS[building] && building !== '不指定') {
    const items = MENU_BUILDINGS.map(k => [k + ' ' + menuBuildingName_(k), '出門時間 ' + day + ' ' + time + ' ' + k]);
    return choices_('你在哪一棟上課？\n\n我會幫你估算從下車地點走到教室需要的時間。', items.concat([['不指定', '出門時間 ' + day + ' ' + time + ' 不指定']]), { title: '出門時間建議', badge: '第 3 步' });
  }
  if (origin === '選出發站') {
    const base = ['出門時間', day, time, building].join(' ');
    return choices_('要從哪一個捷運站出發？', Object.keys(ORIGINS).map(name => [name, base + ' ' + name]), { title: '出門時間建議', badge: '換出發站', primary: false });
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
