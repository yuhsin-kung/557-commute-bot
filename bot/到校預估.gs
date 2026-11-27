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

/** 給學生看的幾行字 */
function p557Lines_(atStop) {
  const r = p557Both_(atStop);
  if (!r) return ['這個時間還沒有 557 的預測（目前只有平常日 07:00–18:30）'];
  const lines = [`建議走去${r.best.stop}站牌：${r.best.text}`];
  r.all.filter(e => e !== r.best).forEach(e => lines.push(`（${e.stop}站牌：${e.text}）`));
  return lines;
}

// ===== 在 LINE 裡完成：按按鈕 → LINE 自己的「傳送位置」畫面 → Bot 收到位置訊息 → 直接回幾點到東吳（不開外部網頁） =====

/** 主打功能的入口：「幾點出門、幾點到東吳」。兩種問法：現在出發（傳位置）、趕課倒推（選節次再傳位置） */
function etaButton_() {
  return choices_('現在出發幾點到？按「傳送我的位置」（LINE 內建的傳位置畫面）。\n要趕課？選第幾節、哪一棟，我倒推你最晚幾點出門。\n\n位置只用來算時間，不會記錄。', // 卡片.gs
    [{ label: '傳送我的位置', uri: 'https://line.me/R/nv/location/' }, ['我要趕課：幾點要出門', '出門時間'], ['我已經在士林站', '到校預估 士林站']],
    { title: '🚇 幾點出門、幾點到東吳', badge: '出門前提醒' });
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
  const again = [['再查一次', '到校預估'], ['我要趕課：幾點要出門', '出門時間']];
  if (!r.ok || !r.school) return choices_(r.lines.join('\n'), again, { title: '🚇 算不出來', badge: '幾點出門、幾點到東吳' });
  const head = `建議走去${r.school.stop}站牌\n${r.school.late ? r.school.early + '–' + r.school.late : '約 ' + r.school.early} 到東吳`;
  return choices_(head + '\n\n' + r.lines.map(l => '・' + l).join('\n'), again, { title: '🚇 幾點到東吳', badge: '幾點出門、幾點到東吳' });
}

// ===== 合併「出門時間建議」：趕課 → 倒推最晚幾點出門（11/28 團隊決定兩個功能合成一個） =====

const ETA_CLASS_WAIT_MIN = 30; // 選好課以後，幾分鐘內傳位置都算這堂課
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
  return choices_([`從捷運士林站走到 557 站牌約 ${MRT_EXIT_TO_STOP_MIN} 分鐘，約 ${hm(atStop)} 到站牌`].concat(p557Lines_(atStop)).join('\n'),
    [['再查一次', '到校預估'], ['我要趕課：幾點要出門', '出門時間']], { title: '🚇 幾點到東吳', badge: '我已經在士林站' });
}
