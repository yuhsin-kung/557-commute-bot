/**
 * 557 現場回報：學生在站牌回報「排隊大概幾人」「剛剛那班有沒有擠上」
 *
 * 網站（臺北市公車動態）看得到車上人數，看不到站上排了幾個人、誰沒擠上。
 * 到校時間預測（到校時間預測.md 第九節）要用這些回報核對「剩幾個位置才上得去」的門檻。
 *
 * 用點的，三步，每一步把前面選過的帶在按鈕傳出的字裡（跟出門時間一樣，Bot 不用記誰點到哪）：
 *   回報現場                  → 在哪一站？
 *   回報現場 士林站            → 排隊大概幾人？
 *   回報現場 士林站 10-30      → 剛剛那班有沒有擠上？
 *   回報現場 士林站 10-30 沒擠上 → 記下來、謝謝
 * 不記定位、不給點數（避免為了點數亂回報）。同一個人 3 分鐘內再回報，蓋掉前一筆。
 * 哪一班車：用回報時間對 557 監測資料（同一站、回報前後離站的那班），不用學生自己填車號。
 * 用到 卡片.gs 的 choices_，共乘.gs 的 cpSheet_、cpLocked_、cpNow_，Code.gs 的 TZ。
 */
const RP_STOPS = { 士林站: '捷運士林站', 士林國中: '士林國中', 校內站: '校內 557 站（回家）' };
const RP_QUEUE = { '0-10': '10 人以內', '10-30': '10–30 人', '30-60': '30–60 人', '60+': '60 人以上' };
const RP_RESULT = { 擠上了: '擠上了', 沒擠上: '沒擠上，等下一班', 還沒來: '還沒有車來' };
const RP_REPLACE_MIN = 3;
const RP_HEAD = ['時間', '使用者 ID', '站牌', '排隊人數', '有沒有擠上'];

/** 「回報現場 …」。不是這個開頭就回傳 null */
function rpText_(uid, text) {
  if (!/^回報現場(\s|$)/.test(text)) return null;
  const p = text.trim().split(/\s+/);
  const stop = p[1], queue = p[2], result = p[3];
  const base = ['回報現場', stop, queue].filter(Boolean).join(' ');

  if (!RP_STOPS[stop]) {
    return choices_('你現在在哪一站等 557？\n\n回報排隊人數、有沒有擠上，可以幫我們把「幾點會擠」預測得更準。不會記錄你的位置。', // 卡片.gs
      Object.keys(RP_STOPS).map(k => [RP_STOPS[k], '回報現場 ' + k]), { title: '回報 557 現場', badge: '第 1 步', primary: false });
  }
  if (!RP_QUEUE[queue]) {
    return choices_(RP_STOPS[stop] + '：現在排隊大概幾個人？\n\n算你前面的人就好，大概就可以。',
      Object.keys(RP_QUEUE).map(k => [RP_QUEUE[k], base + ' ' + k]), { title: '回報 557 現場', badge: '第 2 步', primary: false });
  }
  if (!RP_RESULT[result]) {
    return choices_(RP_STOPS[stop] + '：剛剛那班 557 有沒有擠上？',
      Object.keys(RP_RESULT).map(k => [RP_RESULT[k], base + ' ' + k]), { title: '回報 557 現場', badge: '第 3 步', primary: false });
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
    const values = [now, uid, RP_STOPS[stop], RP_QUEUE[queue], RP_RESULT[result]];
    if (row > 0) sheet.getRange(row, 1, 1, values.length).setValues([values]);
    else sheet.appendRow(values);
    const hhmm = Utilities.formatDate(now, TZ, 'HH:mm');
    const lines = ['🙏 謝謝回報！', '', hhmm + '｜' + RP_STOPS[stop] + '｜排隊 ' + RP_QUEUE[queue] + '｜' + RP_RESULT[result]];
    if (result === '沒擠上') lines.push('', '看看下一班多久到，或改搭其他公車到錢穆故居站。');
    return choices_(lines.join('\n'), result === '擠上了' ? [] : [['557 即時動態', '557 即時動態'], ['比較所有路線', '比較所有路線']],
      { title: '回報 557 現場', badge: '已記錄', primary: false });
  });
}
