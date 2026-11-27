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

/** LINE 裡傳「到校預估」→ 按鈕打開 LINE 的傳送位置畫面（line.me/R/nv/location/，LINE 內建，不是外部網頁） */
function etaButton_() {
  return choices_('按下面的按鈕，選你現在的位置傳給我，我幫你算：走到哪個捷運站、搭哪班捷運、走去哪個 557 站牌，幾點到東吳。\n\n也可以按輸入框左邊的「＋」→「位置資訊」。位置只用來算時間，不會記錄。', // 卡片.gs
    [{ label: '傳送我的位置', uri: 'https://line.me/R/nv/location/' }], { title: '🚇 從我這裡出發幾點到校', badge: '出門前提醒' });
}

/** 收到 LINE 位置訊息：算好直接回一張卡片 */
function etaFromLocation_(lat, lng) {
  const r = mrtPlan_(lat, lng, cpNow_().getTime()); // 捷運到站牌.gs；時間用共乘.gs 的時鐘（測試可以調）
  const again = [['再查一次', '到校預估'], ['557 即時動態', '557 即時動態']];
  if (!r.ok || !r.school) return choices_(r.lines.join('\n'), again, { title: '🚇 算不出來', badge: '從我這裡出發幾點到校' });
  const head = `建議走去${r.school.stop}站牌\n${r.school.late ? r.school.early + '–' + r.school.late : '約 ' + r.school.early} 到東吳`;
  return choices_(head + '\n\n' + r.lines.map(l => '・' + l).join('\n'), again, { title: '🚇 幾點到東吳', badge: '從我這裡出發幾點到校' });
}
