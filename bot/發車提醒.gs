/**
 * 557 發車提醒：出門建議卡片按「557 發車前提醒我」，該出門的時候推播 557 下一班多久到士林站
 *
 * 按鈕傳「出門提醒 明天 07:35」：07:35 是建議到士林站的時間，提前 LV_BEFORE_MIN 分鐘推播。
 * 推播的那一刻才查一次 557 在捷運士林站的即時到站（TDX），不是每分鐘都查，不會多用 TDX 額度。
 * 一個人同時只留一個提醒，再設一次會蓋掉舊的；傳「取消出門提醒」取消。每一筆記在「發車提醒」分頁。
 * 排程跟共乘一起：共乘.gs 的「共乘每分鐘檢查」順便呼叫 lvTick_。推播額度快用完（cpQuotaLeft_）就不推。
 * 用到比較器.gs 的 etaAtStop_、ORIGINS、timeOn_、addMin_、fmt_，共乘.gs 的 cpSheet_、cpNow_、cpQuotaLeft_、CP，卡片.gs 的 choices_。
 */
const LV_BEFORE_MIN = 15; // 建議到士林站的時間前幾分鐘提醒
const LV_LATE_MIN = 30;   // 排程停過、超過這麼久才檢查到就不推了，標成過期
const LV_HEAD = ['建立時間', '使用者 ID', '提醒時間', '建議到站時間', '狀態'];

/** 「出門提醒 今天|明天 HH:MM」設定、「取消出門提醒」取消。不是這兩種就回傳 null */
function lvText_(uid, text) {
  const set = text.match(/^出門提醒 (今天|明天) (\d{2}:\d{2})$/);
  if (!set && text !== '取消出門提醒') return null;
  return cpLocked_(() => { // 共乘.gs
    const sheet = cpSheet_('發車提醒', LV_HEAD);
    const mine = sheet.getDataRange().getValues()
      .map((r, i) => ({ r: r, row: i + 1 }))
      .filter(x => x.row > 1 && x.r[1] === uid && x.r[4] === '等待中');
    const cancel = () => mine.forEach(x => sheet.getRange(x.row, 5).setValues([['取消']]));

    if (!set) {
      cancel();
      return mine.length ? '已取消出門提醒。' : '你目前沒有設定出門提醒。';
    }
    const now = cpNow_();
    const arrive = timeOn_(set[1] === '明天' ? addMin_(now, 24 * 60) : now, set[2]);
    const at = addMin_(arrive, -LV_BEFORE_MIN);
    if (at <= now) return choices_('快到出門時間了，直接看現在的車比較準。', [['比較所有路線', '比較所有路線']]);
    cancel();
    sheet.appendRow([now, uid, at, arrive, '等待中']);
    return choices_('⏰ 已設定出門提醒\n\n' + set[1] + ' ' + fmt_(at) + '，我會告訴你 557 下一班多久到士林站。\n建議 ' + set[2] + ' 前到士林站。',
      [['取消出門提醒', '取消出門提醒']]);
  });
}

/** 每分鐘：到時間的提醒推播出去 */
function lvTick_(now) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('發車提醒');
  if (!sheet) return; // 還沒有人設過提醒
  const due = sheet.getDataRange().getValues()
    .map((r, i) => ({ r: r, row: i + 1 }))
    .filter(x => x.row > 1 && x.r[4] === '等待中' && new Date(x.r[2]) <= now);
  if (!due.length) return;

  const fresh = due.filter(x => now - new Date(x.r[2]) <= LV_LATE_MIN * 60000);
  due.filter(x => fresh.indexOf(x) < 0).forEach(x => sheet.getRange(x.row, 5).setValues([['過期']]));
  if (!fresh.length) return;
  if (cpQuotaLeft_() - fresh.length < CP.PUSH_KEEP) { // 共乘.gs：額度留給雨天、考試週提醒
    fresh.forEach(x => sheet.getRange(x.row, 5).setValues([['推播額度不足']]));
    return;
  }
  const next = lvNext557_();
  fresh.forEach(x => {
    const text = '⏰ 該出門了！\n\n建議 ' + fmt_(new Date(x.r[3])) + ' 前到士林站。\n'
      + (next == null ? '現在查不到 557 的即時到站，按下面看所有路線。' : next <= 1 ? '557 下一班即將到士林站。' : '557 下一班約 ' + next + ' 分鐘後到士林站。');
    sheet.getRange(x.row, 5).setValues([[lvPush_(x.r[1], text) ? '已提醒' : '推播失敗']]);
  });
}

/** 557 往東吳方向，下一班幾分鐘後到捷運士林站；查不到回傳 null */
function lvNext557_() {
  try {
    const waits = etaAtStop_(ORIGINS.士林站.stop) // 比較器.gs
      .filter(e => e.RouteName.Zh_tw === '557' && e.Direction === 0 && e.EstimateTime != null)
      .map(e => Math.round(e.EstimateTime / 60));
    return waits.length ? Math.min.apply(null, waits) : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

function lvPush_(uid, text) {
  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
      payload: JSON.stringify({ to: uid, messages: [choices_(text, [['比較所有路線', '比較所有路線'], ['557 即時動態', '557 即時動態']])] }),
    });
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}
