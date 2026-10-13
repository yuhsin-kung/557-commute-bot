/**
 * 課表熱度地圖（8）：外雙溪校區每一節有多少人開始上課，推算哪個時段最擠
 *
 * 資料在 課表熱度資料.gs（tools/抓課表.js 從公開的全校課表產生，換學期要重跑）。
 * 每一格是「這一節開始上課的人數」：連上三節的課只算在第一節；單、雙週的課算一半。
 * 早八最準（大家都是從校外來）；下午的節次會高估，因為很多人早就在學校了。
 *
 * 學生傳「幾點最擠」→ 今天（放學後看明天）每一節的人數；「幾點最擠 明天」「幾點最擠 三」看其他天。
 * 比較器的出門建議也會用 heatAt_ 加一句「這一節有多少人開始上課」。
 * 用到 Code.gs 的 TZ，卡片.gs 的 card_，比較器.gs 的 PERIODS、addMin_。
 */
const HEAT_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
const HEAT_HIGH = 0.66; // 佔全週最高那一格的比例，超過算「很擠」
const HEAT_MID = 0.33;

/** 全週最高的那一格，用來算每一格擠不擠 */
function heatMax_() {
  let max = 0;
  Object.keys(HEAT_DATA).forEach(d => Object.keys(HEAT_DATA[d]).forEach(p => { max = Math.max(max, HEAT_DATA[d][p]); }));
  return max;
}

function heatLevel_(count) {
  const share = heatMax_() ? count / heatMax_() : 0;
  return share >= HEAT_HIGH ? '很擠' : share >= HEAT_MID ? '普通' : '人少';
}

/**
 * 某個上課時間的熱度：{ count, level, period }。那個時間沒有對應的節次或沒有資料就回傳 null。
 * when 是上課時間（例如早八就是當天 08:10）。
 */
function heatAt_(when) {
  const day = HEAT_DAYS[Number(Utilities.formatDate(when, TZ, 'u')) - 1];
  const hm = Utilities.formatDate(when, TZ, 'HH:mm');
  // 「8 點上課」這種整點的說法，算在十分鐘內開始的那一節
  const period = Object.keys(PERIODS).filter(p => PERIODS[p] >= hm && PERIODS[p] <= Utilities.formatDate(addMin_(when, 15), TZ, 'HH:mm'))[0];
  const count = period && HEAT_DATA[day] && HEAT_DATA[day][period];
  if (!count) return null;
  return { count: count, level: heatLevel_(count), period: period };
}

/** 「幾點最擠」「幾點最擠 明天」「幾點最擠 三」 */
function heatReply_(text) {
  if (typeof HEAT_DATA === 'undefined') { // 課表熱度資料.gs 還沒產生（tools/抓課表.js）
    return card_({ badge: '課表熱度', title: '幾點最擠', notes: ['課表資料還在整理，過幾天再來看。'], buttons: [{ label: '排出門時間', text: '出門時間' }] });
  }
  const arg = String(text || '').trim().split(/\s+/)[1] || '';
  const now = new Date();
  let when = now;
  let label = '今天';
  if (arg === '明天') { when = addMin_(now, 24 * 60); label = '明天'; }
  else if (HEAT_DAYS.indexOf(arg.replace(/^(星期|週|周|禮拜)/, '')) >= 0) {
    const want = HEAT_DAYS.indexOf(arg.replace(/^(星期|週|周|禮拜)/, '')) + 1;
    const today = Number(Utilities.formatDate(now, TZ, 'u'));
    when = addMin_(now, ((want - today + 7) % 7) * 24 * 60);
    label = '星期' + HEAT_DAYS[want - 1];
  } else if (Number(Utilities.formatDate(now, TZ, 'H')) >= 18) {
    when = addMin_(now, 24 * 60); // 晚上問，看的是明天
    label = '明天';
  }
  const dayIndex = Number(Utilities.formatDate(when, TZ, 'u'));
  const day = HEAT_DAYS[dayIndex - 1];
  const slots = HEAT_DATA[day] || {};
  const periods = Object.keys(PERIODS).filter(p => slots[p]).sort((a, b) => PERIODS[a].localeCompare(PERIODS[b]));
  const other = [['明天', '幾點最擠 明天']].concat(HEAT_DAYS.slice(0, 5).filter(d => d !== day).map(d => ['星期' + d, '幾點最擠 ' + d]));

  if (!periods.length) {
    return card_({
      badge: '課表熱度', title: label + '（星期' + day + '）',
      notes: ['這一天外雙溪校區沒有排課資料。'],
      buttons: other.slice(0, 3).map(b => ({ label: b[0], text: b[1] })),
    });
  }
  const max = heatMax_();
  const top = periods.slice().sort((a, b) => slots[b] - slots[a])[0];
  const bar = n => '▮'.repeat(Math.max(1, Math.round(n / max * 8)));
  return card_({ // 卡片.gs
    badge: '課表熱度',
    title: label + '幾點最擠',
    subtitle: '星期' + day + '・外雙溪校區',
    rows: periods.map(p => ({
      label: '第 ' + p + ' 節 ' + PERIODS[p],
      value: slots[p] + ' 人',
      sub: bar(slots[p]) + ' ' + heatLevel_(slots[p]),
      best: p === top,
    })),
    notes: ['最多人的是第 ' + top + ' 節（' + PERIODS[top] + '）：約 ' + slots[top] + ' 人要在這之前到教室，'
      + Utilities.formatDate(addMin_(timeOnDay_(when, PERIODS[top]), -40), TZ, 'HH:mm') + '～' + PERIODS[top] + ' 的 557 最擠。'],
    footer: HEAT_SOURCE.year + ' 學年第 ' + HEAT_SOURCE.term + ' 學期公開課表・每一節「開始上課」的人數，下午會高估',
    buttons: [{ label: '排出門時間', text: '出門時間 ' + (label === '明天' ? '明天' : '今天') }]
      .concat(other.slice(0, 2).map(b => ({ label: '看' + b[0], text: b[1] }))),
  });
}

function timeOnDay_(date, hhmm) {
  return new Date(Utilities.formatDate(date, TZ, 'yyyy-MM-dd') + 'T' + hhmm + ':00+08:00');
}
