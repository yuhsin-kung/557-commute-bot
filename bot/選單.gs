/**
 * 主選單和「用點的」流程：每個功能都有按鈕，不用記關鍵字、不用打字
 *
 *   「選單」      → 四張可以左右滑的卡片，每個功能一顆按鈕
 *   「出門時間」  → 點哪一天 → 點第幾節 → 點哪一棟 → 出門建議（原本要打「明天早八 D 棟」）
 *   加好友、看不懂的句子 → 也是回主選單
 *
 * 要加新功能的按鈕：在 MENU_CARDS 加一列 [按鈕上的字, 按了傳出的字]。
 * tests/選單.test.js 會檢查每一顆按鈕傳出去的字 Bot 都認得。
 * 用到 卡片.gs 的 cards_，共乘.gs 的 cpQuick_，比較器.gs 的 PERIODS、BUILDINGS、ORIGINS、compareQuery_、timeOn_。
 */
const MENU_CARDS = [
  {
    badge: '出門前',
    title: '怎麼去學校',
    text: '比較 557 和其他公車，算幾點出門。',
    buttons: [['現在最快的車', '幫我比較路線'], ['排出門時間', '出門時間'], ['557 到站', '557 去學校'], ['557 回家', '557 回家'], ['557 在哪裡搭', '557 在哪裡搭']],
  },
  {
    badge: '557 以外',
    title: '換個方式到校',
    text: '557 太擠的時候，還有這些選擇。',
    buttons: [['計程車共乘', '共乘'], ['YouBike 車數', 'YouBike'], ['共享雨傘', '共享雨傘'], ['包車意願調查', '包車']],
  },
  {
    badge: '積分',
    title: '我的通勤紀錄',
    text: '走路、騎車、共乘、早到都能拿分。',
    buttons: [['到校打卡', '打卡'], ['我的紀錄', '我的紀錄'], ['全校減碳', '全校減碳'], ['騎車到校', '騎車到校']],
  },
  {
    badge: '提醒與新生',
    title: '天氣、提醒、新生教學',
    text: '下雨和考試週的前一晚可以提醒你。',
    buttons: [['明天會下雨嗎', '明天會下雨嗎'], ['開啟提醒', '訂閱提醒'], ['關閉提醒', '取消提醒'], ['新生教學', '新生教學'], ['排隊禮儀', '排隊禮儀']],
  },
];

// 快速回覆一次最多 13 顆按鈕：節次放 13 個（中午的第 E 節很少排課，要用打的）
const MENU_PERIODS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D'];
// 有教室的大樓 12 棟，加上「不指定」剛好 13 顆
const MENU_BUILDINGS = ['B', 'D', 'R', 'H', 'G', 'F', 'C', 'N', 'M', 'P', 'Q', 'L'];

function menuCard_() {
  const alt = '全部功能（往左滑還有更多）\n' + MENU_CARDS.map(c => '【' + c.title + '】' + c.buttons.map(b => b[0]).join('、')).join('\n');
  return cards_(MENU_CARDS.map(c => ({ // 卡片.gs
    badge: c.badge,
    title: c.title,
    notes: [c.text],
    buttons: c.buttons.map(([label, text]) => ({ label: label, text: text })),
  })), alt);
}

/** 加好友時 */
function menuWelcome_() {
  return ['嗨！我是東吳通勤達人。\n每個功能都有按鈕，點下面的卡片就能用，往左滑還有更多 👇', menuCard_()];
}

/** 看不懂的句子：不要讓人卡住，直接給按鈕 */
function menuUnknown_() {
  return ['我看不懂這句話 🙏\n點下面的按鈕試試，往左滑還有更多功能 👇', menuCard_()];
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
    return cpQuick_('要排哪一天的出門時間？', [['今天', '出門時間 今天'], ['明天', '出門時間 明天']]); // 共乘.gs
  }
  if (!/^\d{2}:\d{2}$/.test(time || '')) {
    // 今天只列還沒開始的節次
    const periods = MENU_PERIODS.filter(k => day === '明天' || timeOn_(now, PERIODS[k]) > now);
    if (!periods.length) return cpQuick_('今天的課都開始了，要排明天的嗎？', [['排明天的', '出門時間 明天']]);
    return cpQuick_(day + '第幾節上課？', periods.map(k => ['第 ' + k + ' 節 ' + PERIODS[k], '出門時間 ' + day + ' ' + PERIODS[k]]));
  }
  if (!BUILDINGS[building] && building !== '不指定') {
    const items = MENU_BUILDINGS.map(k => [k + ' ' + menuBuildingName_(k), '出門時間 ' + day + ' ' + time + ' ' + k]);
    return cpQuick_(day + ' ' + time + ' 上課，在哪一棟？', items.concat([['不指定', '出門時間 ' + day + ' ' + time + ' 不指定']]));
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
