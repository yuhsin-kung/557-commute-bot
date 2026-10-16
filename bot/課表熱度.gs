/**
 * 課表熱度地圖（8）：外雙溪校區每一節有多少人到校、離校，推算 557 哪個時段最擠
 *
 * 資料在 課表熱度資料.gs（tools/抓課表.js 產生，換學期要重跑）：
 *   HEAT_DATA[星期][節次] = [至少到校, 開始上課, 上課中, 下課後至少離校]
 * 「至少到校」＝這一節上課中的人數比上一節多出來的。我們不知道每個學生的課表，所以只能算「至少」：
 *   早八最準（全部都是從校外來的）；之後的節次，有人下課離開、同時有人剛到，會互相抵掉，實際只會更多。
 * 「至少離校」＝下一節少掉的人數，用來看回程（東吳 → 士林）什麼時候最擠。
 * 午休不算離校（大家是在學校吃飯）。
 *
 * 學生傳「幾點最擠」→ 今天（傍晚以後看明天）；「幾點最擠 明天」「幾點最擠 三」看其他天。
 * 比較器的出門建議用 heatAt_ 加一句「這一節至少多少人到校」。
 * 用到 Code.gs 的 TZ，卡片.gs 的 card_，比較器.gs 的 PERIODS、addMin_。
 */
const HEAT_DAYS = ['一', '二', '三', '四', '五', '六', '日'];
const HEAT_ENDS = { 1: '09:00', 2: '10:00', 3: '11:00', 4: '12:00', E: '13:00', 5: '14:00', 6: '15:00', 7: '16:00', 8: '17:00', 9: '18:20', A: '19:15', B: '20:10', C: '21:10', D: '22:05' }; // 節次.csv
const HEAT_HIGH = 0.66; // 佔全週到校最多那一格的比例，超過算「很擠」
const HEAT_MID = 0.33;
const HEAT_SHOW = 100;  // 到校、離校不到這個人數的節次不列，卡片才不會太長

/** 全週到校最多的那一格，用來算每一格擠不擠 */
function heatMax_() {
  let max = 0;
  Object.keys(HEAT_DATA).forEach(d => Object.keys(HEAT_DATA[d]).forEach(p => { max = Math.max(max, HEAT_DATA[d][p][0]); }));
  return max;
}

function heatLevel_(arrive) {
  const share = heatMax_() ? arrive / heatMax_() : 0;
  return share >= HEAT_HIGH ? '很擠' : share >= HEAT_MID ? '普通' : '人少';
}

/**
 * 某個上課時間的熱度：{ arrive, starts, level, period }。那個時間沒有對應的節次、或沒什麼人到校就回傳 null。
 * when 是上課時間（例如早八就是當天 08:10）。
 */
function heatAt_(when) {
  const day = HEAT_DAYS[Number(Utilities.formatDate(when, TZ, 'u')) - 1];
  const hm = Utilities.formatDate(when, TZ, 'HH:mm');
  // 「8 點上課」這種整點的說法，算在十五分鐘內開始的那一節
  const until = Utilities.formatDate(addMin_(when, 15), TZ, 'HH:mm');
  const period = Object.keys(PERIODS).filter(p => PERIODS[p] >= hm && PERIODS[p] <= until)[0];
  const cell = period && HEAT_DATA[day] && HEAT_DATA[day][period];
  if (!cell || cell[0] < HEAT_SHOW) return null;
  return { arrive: cell[0], starts: cell[1], level: heatLevel_(cell[0]), period: period };
}

/** 「幾點最擠」「幾點最擠 明天」「幾點最擠 三」 */
function heatReply_(text) {
  if (typeof HEAT_DATA === 'undefined') { // 課表熱度資料.gs 還沒產生（tools/抓課表.js）
    return card_({ badge: '課表熱度', title: '幾點最擠', notes: ['課表資料還在整理，過幾天再來看。'], buttons: [{ label: '排出門時間', text: '出門時間' }] });
  }
  const arg = (String(text || '').trim().split(/\s+/)[1] || '').replace(/^(星期|週|周|禮拜)/, '');
  const now = new Date();
  let when = now;
  let label = '今天';
  if (arg === '明天') { when = addMin_(now, 24 * 60); label = '明天'; }
  else if (HEAT_DAYS.indexOf(arg) >= 0) {
    const want = HEAT_DAYS.indexOf(arg) + 1;
    const today = Number(Utilities.formatDate(now, TZ, 'u'));
    when = addMin_(now, ((want - today + 7) % 7) * 24 * 60);
    label = '星期' + arg;
  } else if (Number(Utilities.formatDate(now, TZ, 'H')) >= 18) {
    when = addMin_(now, 24 * 60); // 傍晚以後問，看的是明天
    label = '明天';
  }
  const day = HEAT_DAYS[Number(Utilities.formatDate(when, TZ, 'u')) - 1];
  const slots = HEAT_DATA[day] || {};
  const byTime = (a, b) => PERIODS[a].localeCompare(PERIODS[b]);
  const arriving = Object.keys(slots).filter(p => slots[p][0] >= HEAT_SHOW).sort(byTime);
  const leaving = Object.keys(slots).filter(p => slots[p][3] >= HEAT_SHOW);
  const other = [['明天', '幾點最擠 明天']].concat(HEAT_DAYS.slice(0, 5).filter(d => d !== day).map(d => ['星期' + d, '幾點最擠 ' + d]));

  if (!arriving.length) {
    return card_({
      badge: '課表熱度', title: label + '（星期' + day + '）',
      notes: ['這一天外雙溪校區幾乎沒有排課，557 不會擠。'],
      buttons: other.slice(0, 3).map(b => ({ label: '看' + b[0], text: b[1] })),
    });
  }
  const max = heatMax_();
  const top = arriving.slice().sort((a, b) => slots[b][0] - slots[a][0])[0];
  const bar = n => '▮'.repeat(Math.max(1, Math.round(n / max * 8)));
  const hm = (period, minutes) => Utilities.formatDate(addMin_(new Date(Utilities.formatDate(when, TZ, 'yyyy-MM-dd') + 'T' + PERIODS[period] + ':00+08:00'), minutes), TZ, 'HH:mm');
  const notes = ['去學校：' + hm(top, -40) + '～' + PERIODS[top] + ' 最擠，至少 ' + slots[top][0] + ' 人要在第 ' + top + ' 節前到校。'];
  if (leaving.length) {
    const out = leaving.slice().sort((a, b) => slots[b][3] - slots[a][3])[0];
    notes.push('回士林：第 ' + out + ' 節下課（' + HEAT_ENDS[out] + '）後最擠，至少 ' + slots[out][3] + ' 人離校。');
  }
  return card_({ // 卡片.gs
    badge: '課表熱度',
    title: label + '幾點最擠',
    subtitle: '星期' + day + '・外雙溪校區',
    rows: arriving.map(p => ({
      label: '第 ' + p + ' 節 ' + PERIODS[p],
      value: '至少 ' + slots[p][0] + ' 人到校',
      sub: bar(slots[p][0]) + ' ' + heatLevel_(slots[p][0]) + '・共 ' + slots[p][1] + ' 人開始上課',
      best: p === top,
    })),
    notes: notes,
    footer: HEAT_SOURCE.year + ' 學年第 ' + HEAT_SOURCE.term + ' 學期課表和' + HEAT_SOURCE.count + '推算・「至少」是因為有人離開、有人剛到會互相抵掉',
    buttons: [{ label: '排出門時間', text: '出門時間 ' + (label === '明天' ? '明天' : '今天') }]
      .concat(other.slice(0, 2).map(b => ({ label: '看' + b[0], text: b[1] }))),
  });
}
