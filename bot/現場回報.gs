/**
 * 557 現場回報：學生按一下「我現在在哪一站排隊」，用來統計各站、各時段有多少人在等
 *
 * 網站（臺北市公車動態）看得到車上人數，看不到站上排了幾個人。回報的筆數就是「至少有這麼多人在排」，
 * 給到校時間預測（到校時間預測.md 第七、九節）核對每分鐘來排隊的人數。
 *
 *   回報現場          → 你現在在哪裡排隊？（四個站）
 *   回報現場 士林站    → 記下來，告訴他最近 RP_COUNT_MIN 分鐘有幾位同學也回報在這裡排
 * 不用 GPS、不給點數（避免為了點數亂回報）。同一個人 RP_ONCE_MIN 分鐘內再按，算同一次排隊，
 * 只留最後一筆（按錯站可以重按），統計才不會一個人算兩次。
 * 用到 卡片.gs 的 choices_，共乘.gs 的 cpSheet_、cpLocked_、cpNow_，Code.gs 的 TZ。
 */
const RP_STOPS = { 士林站: '捷運士林站', 士林國中: '士林國中', 校內站: '校內 557 站', 錢穆故居站: '錢穆故居站' };
const RP_ONCE_MIN = 15;  // 一次排隊大概多久：這段時間內同一個人只算一次
const RP_COUNT_MIN = 10; // 告訴學生「最近幾分鐘有幾人回報」
const RP_HEAD = ['時間', '使用者 ID', '站牌'];

/** 「回報現場 …」。不是這個開頭就回傳 null */
function rpText_(uid, text) {
  if (!/^回報現場(\s|$)/.test(text)) return null;
  const stop = text.trim().split(/\s+/)[1];
  if (!RP_STOPS[stop]) {
    return choices_('你現在在哪裡排隊等車？\n\n按一下就好，幫我們統計各站有多少人在等。只記你按的站，不用 GPS 定位。', // 卡片.gs
      Object.keys(RP_STOPS).map(k => [RP_STOPS[k], '回報現場 ' + k]), { title: '回報排隊', badge: '557 現場', primary: false });
  }
  return cpLocked_(() => { // 共乘.gs
    const sheet = cpSheet_('現場回報', RP_HEAD);
    const now = cpNow_();
    const rows = sheet.getDataRange().getValues();
    // 同一個人 15 分鐘內又按：算同一次排隊（可能是按錯站重按），蓋掉前一筆
    let row = -1;
    for (let i = rows.length - 1; i >= 1; i--) {
      if (rows[i][1] === uid && now - new Date(rows[i][0]) <= RP_ONCE_MIN * 60000) { row = i + 1; break; }
    }
    const values = [now, uid, RP_STOPS[stop]];
    if (row > 0) sheet.getRange(row, 1, 1, values.length).setValues([values]);
    else sheet.appendRow(values);
    // 最近 10 分鐘在這一站回報的人數（含自己）
    const since = now.getTime() - RP_COUNT_MIN * 60000;
    const others = sheet.getDataRange().getValues().slice(1)
      .filter(r => r[2] === RP_STOPS[stop] && new Date(r[0]).getTime() >= since).length;
    const hhmm = Utilities.formatDate(now, TZ, 'HH:mm');
    return choices_(['🙏 謝謝回報！', '', hhmm + '｜' + RP_STOPS[stop],
      '最近 ' + RP_COUNT_MIN + ' 分鐘有 ' + others + ' 位同學回報在這裡排隊（只算有按的人）。'].join('\n'),
      [['557 即時動態', '557 即時動態'], ['比較所有路線', '比較所有路線']], { title: '回報排隊', badge: '已記錄', primary: false });
  });
}
