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
    hint: '怎麼去最快、幾點出門、會不會下雨',
    buttons: [['比較所有公車路線', '比較所有公車路線'], ['出門時間建議', '出門時間'], ['557 即時動態', '557 即時動態'],
      ['降雨查詢', '降雨查詢'], ['雨天與考試週訂閱提醒', '訂閱提醒設定']],
  },
  {
    name: '557 以外的選擇',
    hint: '共乘、YouBike、雨傘、包車',
    buttons: [['計程車共乘', '共乘'], ['YouBike 車數', 'YouBike'], ['共享雨傘', '共享雨傘'], ['包車意願調查', '包車']],
  },
  {
    name: '公車站牌與排隊',
    hint: '最新的上車地點、怎麼排隊',
    buttons: [['557 站牌資訊', '557 站牌資訊'], ['排隊禮儀', '排隊禮儀']],
  },
  {
    name: '積分與打卡',
    hint: '早到、步行、騎車，一次 1 點；3 點換 30 元學餐折價券',
    buttons: [['到校打卡（早到、步行）', '打卡'], ['騎車到校', '騎車到校'], ['我的紀錄', '我的紀錄'],
      ['兌換學餐折價券', '兌換折價券'], ['全校減碳', '全校減碳']],
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

/** 按了分類：把這一類的功能按鈕傳到聊天室。不是分類名稱就回傳 null */
function menuCategory_(name) {
  const c = MENU.filter(x => x.name === name)[0];
  if (!c) return null;
  return choices_(c.hint, c.buttons, { title: c.name, badge: '選單', primary: false });
}

/** 加好友時：打招呼、新生須知（新生.gs）、選單 */
function menuWelcome_() {
  return ['嗨！我是東吳通勤達人。\n每個功能都有按鈕，不用打字。第一次搭 557 先看新生須知，再從選單選一類 👇', nbIntro_(), menuCard_()];
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
    return choices_('要排哪一天的出門時間？', [['今天', '出門時間 今天'], ['明天', '出門時間 明天']], { title: '出門時間建議', badge: '第 1 步', primary: false });
  }
  if (!/^\d{2}:\d{2}$/.test(time || '')) {
    // 今天只列還沒開始的節次
    const periods = MENU_PERIODS.filter(k => day === '明天' || timeOn_(now, PERIODS[k]) > now);
    if (!periods.length) return choices_('今天的課都開始了，要排明天的嗎？', [['排明天的', '出門時間 明天']]);
    return choices_(day + '第幾節上課？', periods.map(k => ['第 ' + k + ' 節 ' + PERIODS[k], '出門時間 ' + day + ' ' + PERIODS[k]]), { title: '出門時間建議', badge: '第 2 步' });
  }
  if (!BUILDINGS[building] && building !== '不指定') {
    const items = MENU_BUILDINGS.map(k => [k + ' ' + menuBuildingName_(k), '出門時間 ' + day + ' ' + time + ' ' + k]);
    return choices_(day + ' ' + time + ' 上課，在哪一棟？', items.concat([['不指定', '出門時間 ' + day + ' ' + time + ' 不指定']]), { title: '出門時間建議', badge: '第 3 步' });
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
