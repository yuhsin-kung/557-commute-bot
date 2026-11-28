/**
 * 到校預估：幾點到 557 站牌（捷運到站牌.gs 算的）→ 幾點到東吳。
 * 用 預測表557.gs（監測資料整理的歷史統計，tools/匯出Bot預測表557.py 產生）：
 *   離峰：到站牌＋第一台到東吳的中位數，給一個時間
 *   尖峰（07:30–08:00、09:15–10:00）：一律給範圍，第一台中位數 ～ 照排隊規則最晚到東吳的 P80（團隊規定尖峰不准只推公車時間）
 * 兩個站牌（捷運士林站、士林國中）出捷運站都約走 5 分鐘，兩個都算，推薦比較早到的：
 *   尖峰比「最晚」，離峰比「第一台」。09:30–10:00 多半是國中（士林站排最兇）
 */

const P557_STOPS = ['捷運士林站', '士林國中'];

function p557InPeak_(minute) {
  return P557_PEAKS.some(p => p[0] <= minute && minute < p[1]);
}

/** 這個時刻最接近的那一格（前後 5 分鐘內），沒有就 null */
function p557Row_(stop, minute) {
  let best = null;
  (P557_TABLE[stop] || []).forEach(r => {
    if (Math.abs(r[0] - minute) <= 5 && (!best || Math.abs(r[0] - minute) < Math.abs(best[0] - minute))) best = r;
  });
  return best;
}

/**
 * 從這個站牌、atStop 這一刻開始等車，幾點到東吳。
 * 回傳 { stop, peak, early, late, queuePct, text }（early、late 是 Date；離峰 late＝null），查不到回 null
 */
function p557Estimate_(stop, atStop) {
  const wd = Number(Utilities.formatDate(atStop, TZ, 'u'));
  if (wd >= 6) return null;
  const minute = mrtMinuteOfDay_(atStop); // 捷運到站牌.gs
  const row = p557Row_(stop, minute);
  if (!row) return null;
  const hm = d => Utilities.formatDate(d, TZ, 'HH:mm');
  const early = new Date(atStop.getTime() + Math.round(row[1]) * 60000);
  const peak = p557InPeak_(minute);
  if (!peak) return { stop, peak, early, late: null, queuePct: row[3], text: `約 ${hm(early)} 到東吳` };
  const late = new Date(atStop.getTime() + Math.ceil(Math.max(row[4], row[2])) * 60000);
  return { stop, peak, early, late, queuePct: row[3],
    text: `${hm(early)}–${hm(late)} 到東吳（尖峰` + (row[3] >= 10 ? `，第一台要排隊的機率約 ${row[3]}%）` : '，這站通常不用排）') };
}

/** 兩個站牌都算，排出推薦的那個（尖峰比最晚、離峰比第一台；一樣就捷運站） */
function p557Both_(atStop) {
  const all = P557_STOPS.map(s => p557Estimate_(s, atStop)).filter(Boolean);
  if (!all.length) return null;
  const key = e => (e.peak ? e.late : e.early).getTime();
  const best = all.reduce((a, b) => (key(b) < key(a) ? b : a));
  return { best, all };
}

/**
 * 以車為主（11/28 團隊建議）：同一台車在國中或捷運站上車，到東吳的時間一樣，所以不列兩個站牌，改講
 * 「幾點會來一台、要不要排、搭上幾點到、下一台幾點來、錯過幾點到」。時間用捷運士林站當基準（P557_BUS，P20～P80）。
 * 回傳 { lines, early, late, peak }（early／late：搭上這台最早、錯過改搭下一台最晚，記錄用），沒有預測回 null
 */
function p557Bus_(atStop) {
  const wd = Number(Utilities.formatDate(atStop, TZ, 'u'));
  if (wd >= 6) return null;
  const minute = mrtMinuteOfDay_(atStop); // 捷運到站牌.gs
  let row = null;
  P557_BUS.forEach(r => { if (Math.abs(r[0] - minute) <= 5 && (!row || Math.abs(r[0] - minute) < Math.abs(row[0] - minute))) row = r; });
  if (!row) return null;
  const at = m => new Date(atStop.getTime() + m * 60000);
  const hm = d => Utilities.formatDate(d, TZ, 'HH:mm');
  const span = (a, b) => { const x = hm(at(Math.floor(a))), y = hm(at(Math.ceil(b))); return x === y ? '約 ' + x : x + '–' + y; };
  const peak = p557InPeak_(minute);
  const qm = (p557Row_('捷運士林站', minute) || [])[3] || 0;
  const qj = (p557Row_('士林國中', minute) || [])[3] || 0;
  const lines = [
    `🚌 ${span(row[1], row[2])} 之間會來一台 557`,
    '　' + (peak && qm >= 10 ? `排隊：這個時段第一台常常要排（約 ${qm}%），排不上就搭下一台` : '排隊：這個時段通常不用排'),
    `🏫 搭上這台：${span(row[3], row[4])} 到東吳`,
    `⏭️ 下一台 ${span(row[5], row[6])} 來；錯過這台，${span(row[7], row[8])} 到東吳`,
  ];
  const tip = peak && qm - qj >= 15;
  if (tip) lines.push(`💡 建議走去士林國中站牌排：同一台車，國中先上車，比較不用排（國中約 ${qj}%）`);
  return { lines, early: at(Math.floor(row[3])), late: at(Math.ceil(row[8])), peak, qm, qj, tip,
    first: span(row[1], row[2]), arrive: span(row[3], row[4]), next: span(row[5], row[6]), nextArrive: span(row[7], row[8]) };
}

// ===== 預估到達時間的卡片（11/28 團隊的設計稿：預計抵達、01 前往士林站、02 557 搭乘建議、03 更推薦的上車地點） =====

const ETA_UI = { green: '#16A34A', greenSoft: '#DCFCE7', greenBg: '#ECFDF3', greenInk: '#15803D', ink: '#111827', muted: '#6B7280',
  line: '#E5E7EB', panel: '#EEF2F7', track: '#CBD5E1', orange: '#F59E0B' };

function etaTx_(text, size, color, extra) {
  return Object.assign({ type: 'text', text: String(text), size: size, color: color || ETA_UI.ink, wrap: true }, extra || {});
}

/** 左邊標籤、右邊數值的一列 */
function etaRow_(label, value) {
  return { type: 'box', layout: 'horizontal', margin: 'md', contents: [
    etaTx_(label, 'sm', ETA_UI.muted, { flex: 1 }),
    etaTx_(value, 'md', ETA_UI.ink, { weight: 'bold', align: 'end', flex: 0 }),
  ] };
}

/**
 * spec：{ origin: '從石牌站出發', leg: { title, note, rows: [[標籤, 時間]] }, bus: p557Bus_ 的結果, alt: 純文字版（訊息紀錄、通知預覽） }
 */
function etaCard_(spec) {
  const b = spec.bus;
  const pct = Math.max(0, Math.min(100, Math.round(b.qm)));
  const busy = b.peak && b.qm >= 10;
  const body = [
    etaTx_('今日通勤預測', 'xs', ETA_UI.muted),
    etaTx_('預計抵達東吳', 'md', ETA_UI.ink, { weight: 'bold', margin: 'sm' }),
    etaTx_(b.arrive.replace(/^約 /, ''), 'xxl', ETA_UI.green, { weight: 'bold', margin: 'sm' }),
    etaTx_(spec.origin, 'xs', ETA_UI.muted, { margin: 'sm' }),
    { type: 'separator', margin: 'lg', color: ETA_UI.line },
    etaTx_(spec.leg.title, 'md', ETA_UI.ink, { weight: 'bold', margin: 'lg' }),
  ].concat(spec.leg.note ? [etaTx_(spec.leg.note, 'xs', ETA_UI.muted, { margin: 'xs' })] : [])
    .concat(spec.leg.rows.map(r => etaRow_(r[0], r[1])))
    .concat([
      { type: 'separator', margin: 'lg', color: ETA_UI.line },
      { type: 'box', layout: 'horizontal', margin: 'lg', alignItems: 'center', contents: [
        etaTx_('02 557 搭乘建議', 'md', ETA_UI.ink, { weight: 'bold', flex: 1 }),
        { type: 'box', layout: 'vertical', flex: 0, backgroundColor: ETA_UI.greenSoft, cornerRadius: '12px', paddingAll: '4px', paddingStart: '8px', paddingEnd: '8px',
          contents: [etaTx_('首選班次', 'xxs', ETA_UI.greenInk, { wrap: false })] },
      ] },
      etaTx_(b.first.replace(/^約 /, ''), 'xl', ETA_UI.green, { weight: 'bold', margin: 'md' }),
      etaTx_('預計公車進站時間', 'xs', ETA_UI.muted, { margin: 'xs' }),
      { type: 'box', layout: 'vertical', margin: 'md', backgroundColor: ETA_UI.panel, cornerRadius: '12px', paddingAll: '12px', contents: [
        { type: 'box', layout: 'horizontal', contents: [
          etaTx_('排隊機率', 'sm', ETA_UI.muted, { flex: 1 }),
          etaTx_(pct + '%', 'md', ETA_UI.ink, { weight: 'bold', align: 'end', flex: 0 }),
        ] },
        { type: 'box', layout: 'vertical', margin: 'sm', height: '8px', cornerRadius: '4px', backgroundColor: ETA_UI.track,
          contents: [{ type: 'box', layout: 'vertical', width: Math.max(pct, 1) + '%', height: '8px', cornerRadius: '4px',
            backgroundColor: busy ? ETA_UI.orange : ETA_UI.green, contents: [{ type: 'filler' }] }] },
        etaTx_((busy ? '常常要排，排不上就搭下一班。' : '這個時段通常不用排。') + '搭上後約 ' + b.arrive.replace(/^約 /, '') + ' 抵達', 'xs', ETA_UI.muted, { margin: 'sm' }),
      ] },
      etaTx_('下一班備選', 'md', ETA_UI.ink, { weight: 'bold', margin: 'lg' }),
      etaRow_('進站時間', b.next.replace(/^約 /, '')),
      etaRow_('抵達東吳', b.nextArrive.replace(/^約 /, '')),
    ]);
  if (b.tip) {
    body.push({ type: 'separator', margin: 'lg', color: ETA_UI.line });
    body.push({ type: 'box', layout: 'vertical', margin: 'lg', backgroundColor: ETA_UI.greenBg, cornerRadius: '12px', paddingAll: '14px', contents: [
      etaTx_('💡 03 更推薦的上車地點', 'md', ETA_UI.ink, { weight: 'bold' }),
      etaTx_('士林國中站', 'md', ETA_UI.ink, { weight: 'bold', margin: 'md' }),
      { type: 'box', layout: 'baseline', margin: 'sm', contents: [
        etaTx_(Math.round(b.qj) + '%', 'xl', ETA_UI.greenInk, { weight: 'bold', flex: 0 }),
        etaTx_('預估排隊機率', 'xs', ETA_UI.greenInk, { margin: 'sm', flex: 0 }),
      ] },
      etaTx_('同一班 557，建議改至士林國中站上車，排隊機率較低。', 'sm', ETA_UI.greenInk, { margin: 'sm' }),
    ] });
  }
  const chip = (label, text) => ({ type: 'box', layout: 'vertical', flex: 1, backgroundColor: ETA_UI.panel, cornerRadius: '8px', paddingAll: '12px',
    action: { type: 'message', label: label.slice(0, 20), text: text },
    contents: [etaTx_(label, 'sm', ETA_UI.ink, { weight: 'bold', align: 'center' })] });
  return {
    type: 'flex',
    altText: spec.alt.slice(0, 400),
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: '#FFFFFF', contents: body },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', paddingTop: '0px', backgroundColor: '#FFFFFF', contents: [
        chip('再查一次', '到校預估'),
        chip('⏰ 出發時間規劃', '出門時間'),
        menuLink_(), // 卡片.gs
      ] },
    },
  };
}

/** 給學生看的幾行字 */
function p557Lines_(atStop) {
  const b = p557Bus_(atStop);
  return b ? b.lines : ['這個時間還沒有 557 的預測（目前只有平常日 07:00–18:30）'];
}

// ===== 在 LINE 裡完成：按按鈕 → LINE 自己的「傳送位置」畫面 → Bot 收到位置訊息 → 直接回幾點到東吳（不開外部網頁） =====

/** 「預估到達時間」的入口：現在出發，幾點到東吳（趕課倒推是另一顆按鈕「⏰ 出發時間規劃」） */
function etaButton_() {
  return choices_('現在出發，幾點到東吳？\n按「傳送我的位置」（LINE 內建的傳位置畫面），我幫你算走到哪個捷運站、搭哪班捷運、走去哪個 557 站牌、幾點到東吳。\n\n要趕課、想知道最晚幾點出門，請按「⏰ 出發時間規劃」。位置只用來算時間，不會記錄。', // 卡片.gs
    [{ label: '傳送我的位置', uri: 'https://line.me/R/nv/location/' }, ['我已經在士林站', '到校預估 士林站'], ['⏰ 出發時間規劃', '出門時間']],
    { title: '🚇 預估到達時間', badge: '出門前提醒' });
}

/** 收到 LINE 位置訊息：剛選好課就倒推幾點出門，不然就是「現在出發幾點到」 */
function etaFromLocation_(lat, lng, uid) {
  const now = cpNow_(); // 共乘.gs：時間用共乘的時鐘（測試可以調）
  const pending = etaPendingClass_(uid);
  if (pending) {
    CacheService.getScriptCache().remove('eta_class_' + uid);
    return etaClassFromHere_(lat, lng, pending, now);
  }
  const r = mrtPlan_(lat, lng, now.getTime()); // 捷運到站牌.gs
  const again = [['再查一次', '到校預估'], ['⏰ 出發時間規劃', '出門時間']];
  const bus = r.ok && p557Bus_(r.atStopAt);
  if (!bus) return choices_(r.lines.join('\n'), again, { title: '🚇 算不出來', badge: '預估到達時間' });
  etaLog_('現在出發', '', r.atStopAt, { stop: '捷運士林站（基準）', early: bus.early, late: bus.late, peak: bus.peak });
  const nm = /站$/.test(r.station) ? r.station : r.station + '站';
  const leg = r.trainAtShilin
    ? { title: '01 前往士林站', note: `走到${nm}約 ${r.walkMin} 分鐘（${r.walkSource}）`, rows: [['抵達士林捷運站', r.trainAtShilin], ['抵達 557 站牌', r.atStop]] }
    : { title: '01 走到 557 站牌', note: `你就在士林站附近，走過去約 ${r.walkMin} 分鐘（${r.walkSource}）`, rows: [['抵達 557 站牌', r.atStop]] };
  return etaCard_({ origin: '從' + nm + '出發', leg, bus,
    alt: '🚇 幾點到東吳\n' + r.steps.map(l => '・' + l).join('\n') + '\n\n' + bus.lines.join('\n') });
}

// ===== 出發時間規劃：趕課 → 倒推最晚幾點出門（11/28：跟預估到達時間同一套算法，按鈕分開） =====

const ETA_CLASS_WAIT_MIN = 30; // 選好課以後，幾分鐘內傳位置都算這堂課
let etaLastClass_ = null;      // 這次回覆的出門建議卡片是哪一堂課（比較器.gs 的 planReply_ 設定，Code.gs 回覆後記到這個人身上）
const ETA_SEARCH_MIN = 180;    // 最多往前找幾分鐘

/** 從東吳站牌下車的時間：有預測就回 { best, at }（尖峰用最晚、離峰用第一台），沒有預測回 null */
function etaArriveSchool_(atStop) {
  const r = p557Both_(atStop);
  if (!r) return null;
  return { best: r.best, at: r.best.peak ? r.best.late : r.best.early };
}

/**
 * 倒推：最晚幾點出發，557 還能在 mustArrive 前到東吳。
 * atStopOf(出發時刻) → 幾點到 557 站牌（Date，搭不到捷運回 null）。
 * 回傳 { depart, atStop, school }；這段時間都沒有 557 預測回 { noData: true }；找不到回 null
 */
function etaLatestDepart_(mustArrive, atStopOf) {
  let sawNoData = false;
  for (let back = 0; back <= ETA_SEARCH_MIN; back++) {
    const depart = new Date(mustArrive.getTime() - back * 60000);
    const atStop = atStopOf(depart);
    if (!atStop) continue;
    const school = etaArriveSchool_(atStop);
    if (!school) { sawNoData = true; continue; }
    if (school.at <= mustArrive) return { depart, atStop, school };
  }
  return sawNoData ? { noData: true } : null;
}

/** 選好「哪天第幾節哪棟」：記下來，接著傳位置就倒推 */
function etaRememberClass_(uid, day, time, building) {
  if (!uid) return;
  CacheService.getScriptCache().put('eta_class_' + uid, JSON.stringify({ day, time, building }), ETA_CLASS_WAIT_MIN * 60);
}

function etaPendingClass_(uid) {
  const raw = uid && CacheService.getScriptCache().get('eta_class_' + uid);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/** 收到位置、而且剛選好課：從這個位置倒推最晚幾點出門 */
function etaClassFromHere_(lat, lng, pending, now) {
  const hm = d => Utilities.formatDate(d, TZ, 'HH:mm');
  const base = pending.day === '明天' ? addMin_(now, 24 * 60) : now; // 比較器.gs
  const classAt = timeOn_(base, pending.time);                        // 比較器.gs
  const building = BUILDINGS[pending.building] ? pending.building : '';
  const extra = crowdExtra_(classAt);
  const mustArrive = addMin_(classAt, -(BUFFER_MIN + walkMin_(building, CAMPUS) + extra.min));
  const title = pending.day + ' ' + pending.time + ' 上課';
  const subtitle = building ? building + ' 棟 ' + BUILDINGS[building][0] : '';
  const again = [{ label: '換一個時間', text: '出門時間' }];

  const leg = mrtLeg_([Number(lat), Number(lng)]); // 捷運到站牌.gs：最近的站＋走路時間（只問一次 Google）
  if (!leg) return card_({ badge: '出門建議', title, subtitle, notes: ['定位格式不對，請再傳一次位置。'], buttons: again });
  const res = etaLatestDepart_(mustArrive, d => mrtAtStop_(leg, d));
  if (!res || res.noData) {
    return card_({ badge: '出門建議', title, subtitle, buttons: again,
      notes: [res && res.noData ? '這個時間還沒有 557 的預測（目前只有平常日 07:00–18:30）。' : '往前找了 3 小時都趕不上，請確認上課時間。'] });
  }
  const s = res.school.best;
  etaLog_('趕課（從位置倒推）', pending.day + ' ' + pending.time, res.atStop, s, res.depart);
  const steps = mrtSteps_(leg, res.depart, res.atStop).concat([
    `走去${s.stop}站牌，557 預計 ${s.late ? hm(s.early) + '–' + hm(s.late) : hm(s.early)} 到東吳` + (s.peak ? '（尖峰，已把排隊、等下一台算進去）' : ''),
  ]).concat(building ? ['下車走到 ' + building + ' 棟約 ' + walkMin_(building, CAMPUS) + ' 分鐘'] : []);
  return card_({
    badge: '出門建議',
    title,
    subtitle,
    rows: [{ label: '從你這裡出發', value: hm(res.depart) + ' 前出門', best: true }],
    notes: steps,
    warns: extra.reasons.length ? [extra.reasons.join('、') + '，已多算 ' + extra.min + ' 分鐘。'] : [],
    footer: '位置只用來算時間，不會記錄',
    buttons: again.concat([{ label: '出門前提醒我', text: '出門提醒 ' + pending.day + ' ' + hm(res.atStop) + ' 出門 ' + hm(res.depart) }]),
  });
}

/** 「到校預估 士林站」：人已經在捷運士林站，走 5 分鐘到站牌 */
function etaFromShilin_() {
  const atStop = new Date(cpNow_().getTime() + MRT_EXIT_TO_STOP_MIN * 60000); // 共乘.gs、捷運到站牌.gs
  const hm = d => Utilities.formatDate(d, TZ, 'HH:mm');
  const bus = p557Bus_(atStop);
  etaLog_('已經在士林站', '', atStop, bus && { stop: '捷運士林站（基準）', early: bus.early, late: bus.late, peak: bus.peak });
  const walk = `從捷運士林站走到 557 站牌約 ${MRT_EXIT_TO_STOP_MIN} 分鐘，約 ${hm(atStop)} 到站牌`;
  if (!bus) return choices_([walk].concat(p557Lines_(atStop)).join('\n'),
    [['再查一次', '到校預估'], ['⏰ 出發時間規劃', '出門時間']], { title: '🚇 幾點到東吳', badge: '我已經在士林站' });
  return etaCard_({ origin: '從捷運士林站出發', leg: { title: '01 走到 557 站牌', note: `出站走過去約 ${MRT_EXIT_TO_STOP_MIN} 分鐘`, rows: [['抵達 557 站牌', hm(atStop)]] }, bus,
    alt: '🚇 幾點到東吳\n' + walk + '\n' + bus.lines.join('\n') });
}

// ===== 測試模式：假日也能試「預估到達時間」（只影響傳指令的那個人，10 分鐘後自動結束） =====
// 「測試時間 週三 09:05」→ 接下來 10 分鐘，這個人傳的訊息都當成「最近的週三 09:05」處理；「測試時間 結束」提早結束

const ETA_REAL_DATE = Date;   // 載入時的真正 Date（測試模式會暫時換掉 Date）
const ETA_TEST_MIN = 10;
const ETA_WEEKDAYS = { 週一: 1, 週二: 2, 週三: 3, 週四: 4, 週五: 5, 週六: 6, 週日: 7 };
let etaTestLabel_ = null;     // 這次訊息在測試模式的話：「週三 09:05」

/** 「測試時間 …」。不是這個開頭回傳 null */
function etaTestText_(uid, text) {
  if (!/^測試時間(\s|$)/.test(text)) return null;
  const cache = CacheService.getScriptCache();
  if (/結束$/.test(text)) {
    cache.remove('eta_test_' + uid);
    return '🧪 測試模式結束，回到現在的時間。';
  }
  const m = text.match(/^測試時間 (週[一二三四五六日]) (\d{1,2}):(\d{2})$/);
  if (!m) return '🧪 測試模式的用法：\n測試時間 週三 09:05\n\n接下來 ' + ETA_TEST_MIN + ' 分鐘，你查「預估到達時間」、趕課倒推，我都當成那個時間來算（只影響你自己）。傳「測試時間 結束」可以提早結束。';
  const now = new ETA_REAL_DATE();
  const today = Number(Utilities.formatDate(now, TZ, 'u'));
  const ahead = (ETA_WEEKDAYS[m[1]] - today + 7) % 7;
  const day = Utilities.formatDate(new ETA_REAL_DATE(now.getTime() + ahead * 86400000), TZ, 'yyyy-MM-dd');
  const fake = new ETA_REAL_DATE(day + 'T' + ('0' + m[2]).slice(-2) + ':' + m[3] + ':00+08:00');
  cache.put('eta_test_' + uid, JSON.stringify({ offset: fake.getTime() - now.getTime(), label: m[1] + ' ' + ('0' + m[2]).slice(-2) + ':' + m[3] }), ETA_TEST_MIN * 60);
  return choices_('🧪 測試模式開始\n\n接下來 ' + ETA_TEST_MIN + ' 分鐘，你查的都當成「' + m[1] + ' ' + ('0' + m[2]).slice(-2) + ':' + m[3] + '」（' + day + '）來算，只影響你自己。\n傳「測試時間 結束」可以提早結束。', // 卡片.gs
    [['🚇 預估到達時間', '預估到達時間'], ['⏰ 出發時間規劃', '出門時間']], { title: '🧪 測試模式', badge: '預估到達時間' });
}

/** 這個人在測試模式嗎：{ offset, label } 或 null */
function etaTestOf_(uid) {
  const raw = uid && CacheService.getScriptCache().get('eta_test_' + uid);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

/** 在測試模式裡執行：這段期間 new Date()、Date.now() 都是假裝的時間，結束一定換回來 */
function etaWithTestTime_(test, fn) {
  const Real = ETA_REAL_DATE;
  class Fake extends Real {
    constructor(...a) { if (a.length) super(...a); else super(Real.now() + test.offset); }
    static now() { return Real.now() + test.offset; }
  }
  Date = Fake; // eslint-disable-line no-global-assign
  etaTestLabel_ = test.label;
  try { return fn(); } finally { Date = Real; etaTestLabel_ = null; } // eslint-disable-line no-global-assign
}

// ===== 預估紀錄：每次預估都記下來，平常日拿去跟 557 實際到站對答案（不記使用者、不記位置） =====

const ETA_LOG_HEAD = ['記錄時間', '測試模式（假裝的時間）', '類型', '上課時間', '出發／到站牌', '推薦站牌', '預估到東吳（最早）', '預估到東吳（最晚）', '尖峰'];

function etaLog_(kind, classTime, atStop, best, depart) {
  try {
    const hm = d => (d ? Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm') : '');
    cpSheet_('預估紀錄', ETA_LOG_HEAD).appendRow([new ETA_REAL_DATE(), etaTestLabel_ || '', kind, classTime || '',
      (depart ? '出門 ' + hm(depart) + '／' : '') + '到站牌 ' + hm(atStop), best ? best.stop : '', best ? hm(best.early) : '', best && best.late ? hm(best.late) : '', best && best.peak ? '是' : '']); // 共乘.gs
  } catch (e) {
    console.error('預估紀錄寫不進去：' + e);
  }
}
