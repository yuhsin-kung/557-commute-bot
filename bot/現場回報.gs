/**
 * 557 現場回報：學生在站牌回報「等到第幾班才擠上」
 *
 * 網站（臺北市公車動態）看得到車上人數，看不到誰沒擠上。到校時間預測要估的正是「這時候去要等幾班」
 * （到校時間預測.md 第七、九節），所以直接問學生等了幾班，不問排隊人數（人數在現場很難數）。
 *
 * 用點的，兩步，按鈕傳出的字把前面選過的帶著（跟出門時間一樣，Bot 不用記誰點到哪）：
 *   回報現場          → 在哪一站？
 *   回報現場 士林站    → 等到第幾班才上車？
 *   回報現場 士林站 2  → 記下來、謝謝
 * 不記定位、不給點數（避免為了點數亂回報）。同一個人 3 分鐘內再回報，蓋掉前一筆。
 * 哪一班車：用回報時間對 557 監測資料（同一站、回報前離站的那班），不用學生自己填車號。
 * 用到 卡片.gs 的 choices_，共乘.gs 的 cpSheet_、cpLocked_、cpNow_，Code.gs 的 TZ。
 */
const RP_STOPS = { 士林站: '捷運士林站', 士林國中: '士林國中', 校內站: '校內 557 站（回家）' };
const RP_WAIT = { '1': '第一班就上了', '2': '等到第 2 班才上', '3+': '等到第 3 班以上才上', 放棄: '放棄了，改搭別的' };
const RP_REPLACE_MIN = 3;
const RP_HEAD = ['時間', '使用者 ID', '站牌', '第幾班才上'];

/** 「回報現場 …」。不是這個開頭就回傳 null */
function rpText_(uid, text) {
  if (!/^回報現場(\s|$)/.test(text)) return null;
  const p = text.trim().split(/\s+/);
  const stop = p[1], wait = p[2];

  if (!RP_STOPS[stop]) {
    return choices_('你在哪一站搭 557？\n\n上車後回報等了幾班，可以幫我們把「幾點要等很多班」預測得更準。不會記錄你的位置。', // 卡片.gs
      Object.keys(RP_STOPS).map(k => [RP_STOPS[k], '回報現場 ' + k]), { title: '回報 557 現場', badge: '第 1 步', primary: false });
  }
  if (!RP_WAIT[wait]) {
    return choices_(RP_STOPS[stop] + '：你等到第幾班才擠上車？',
      Object.keys(RP_WAIT).map(k => [RP_WAIT[k], '回報現場 ' + stop + ' ' + k]), { title: '回報 557 現場', badge: '第 2 步', primary: false });
  }
  return cpLocked_(() => { // 共乘.gs
    const sheet = cpSheet_('現場回報', RP_HEAD);
    const now = cpNow_();
    const rows = sheet.getDataRange().getValues();
    // 同一個人 3 分鐘內又回報：多半是按錯重來，蓋掉前一筆，不要變成兩筆
    let row = -1;
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][1] === uid && now - new Date(rows[i][0]) <= RP_REPLACE_MIN * 60000) { row = i + 1; break; }
    }
    const values = [now, uid, RP_STOPS[stop], RP_WAIT[wait]];
    if (row > 0) sheet.getRange(row, 1, 1, values.length).setValues([values]);
    else sheet.appendRow(values);
    const hhmm = Utilities.formatDate(now, TZ, 'HH:mm');
    const lines = ['🙏 謝謝回報！', '', hhmm + '｜' + RP_STOPS[stop] + '｜' + RP_WAIT[wait]];
    const helpful = wait !== '1';
    if (helpful) lines.push('', '下次可以先查即時動態，或改搭其他公車到錢穆故居站。');
    return choices_(lines.join('\n'), helpful ? [['557 即時動態', '557 即時動態'], ['比較所有路線', '比較所有路線']] : [],
      { title: '回報 557 現場', badge: '已記錄', primary: false });
  });
}
