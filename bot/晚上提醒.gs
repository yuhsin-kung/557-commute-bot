/**
 * 晚上提醒：雨天預警（6）＋考試週預警（7）
 *
 * 每晚 9 點檢查明天早上會不會下雨、是不是考試週，有一項成立就推播給有訂閱的人。
 * LINE 免費方案每月只能主動推播 200 則（以人次計算），所以：
 *   - 只發給傳過「訂閱提醒」的人
 *   - 雨天和考試週合併成一則
 *   - 明天是週末、放假就不發；額度不夠也不發
 *
 * 第一次使用：在編輯器執行一次「設定晚上提醒排程」。
 */
const RAIN_ALERT_POP = 60;    // 降雨機率 ≥ 這個數字才提醒
const REMIND_HOUR = 21;       // 每晚幾點檢查

// ===== 排程每晚執行 =====

function 晚上提醒() {
  // 一天只跑一次：這個函式公開網頁也呼叫得到（見 Code.gs 的 tooSoon_），不能讓人重複觸發把推播額度用光
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  if (PROPS.getProperty('REMIND_LAST_DAY') === today) return;
  PROPS.setProperty('REMIND_LAST_DAY', today);

  const result = buildReminder_(addMin_(new Date(), 24 * 60));
  if (!result.message) {
    logPush_('不用提醒', result.pop, result.event, 0, result.reason);
    return;
  }
  sendToSubscribers_(result, '晚上提醒');
}

/** 檢查某一天要不要提醒，回傳 { message, pop, event, reason } */
function buildReminder_(day) {
  const weekday = Number(Utilities.formatDate(day, TZ, 'u')); // 1=週一 … 7=週日
  const dateText = Utilities.formatDate(day, TZ, 'M/d');
  if (weekday >= 6) return { reason: dateText + ' 是週末' };

  const event = calendarEvent_(day); // 比較器.gs：[開始, 結束, 類型, 名稱, 影響]
  if (event && event[2] === '放假') return { reason: dateText + ' ' + event[3] + '放假', event: event[3] };

  const pop = rainPop_(timeOn_(day, '07:30')); // 比較器.gs：上學尖峰那一格的降雨機率
  const isRain = pop >= RAIN_ALERT_POP;
  const isExam = event && event[2] === '考試';
  if (!isRain && !isExam) {
    return { reason: '降雨機率 ' + pop + '%，不是考試週', pop: pop, event: event ? event[3] : '' };
  }

  const lines = ['🔔 明天（' + dateText + '）上學提醒', ''];
  if (isRain) {
    lines.push('☔ 早上降雨機率 ' + pop + '%');
    lines.push('下雨天 557 會比平常擠，建議早 20 分鐘出門、記得帶傘。');
  }
  if (isExam) {
    if (isRain) lines.push('');
    lines.push('📝 ' + event[3] + '期間，搭車的人會比較集中。');
  }
  lines.push('');
  lines.push('💡 士林站有 13 條公車跟 557 走一樣的路到錢穆故居站，不一定要等 557。');

  return {
    title: '明天（' + dateText + '）上學提醒',
    message: lines.slice(2).join('\n'),
    buttons: [['排明天的出門時間', '出門時間 明天'], ['預約共乘', '共乘 去學校 預約'], ['不想收提醒', '取消提醒']],
    pop: pop, event: isExam ? event[3] : '', reason: isRain && isExam ? '下雨＋考試週' : isRain ? '下雨' : '考試週',
  };
}

// ===== 訂閱 =====

function subscribe_(userId, on) {
  const sheet = subscriberSheet_();
  const rows = sheet.getDataRange().getValues();
  const i = rows.findIndex(r => r[0] === userId);
  if (i > 0) {
    sheet.getRange(i + 1, 2, 1, 2).setValues([[on ? '訂閱中' : '已取消', new Date()]]);
  } else {
    sheet.appendRow([userId, on ? '訂閱中' : '已取消', new Date()]);
  }
  return on
    ? '✅ 訂閱成功！\n\n明天早上會下雨、或是考試週的時候，我會在前一晚 9 點提醒你。\n沒事的晚上不會打擾你 🙂\n\n不想收了就傳「取消提醒」。'
    : '已取消提醒 👋\n想再收的話傳「訂閱提醒」就好。';
}

function subscribers_() {
  return subscriberSheet_().getDataRange().getValues().slice(1)
    .filter(r => r[1] === '訂閱中')
    .map(r => r[0]);
}

function subscriberSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('訂閱');
  if (!sheet) {
    sheet = ss.insertSheet('訂閱');
    sheet.appendRow(['使用者 ID', '狀態', '更新時間']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ===== 推播 =====

function sendToSubscribers_(result, kind) {
  const to = subscribers_();
  if (!to.length) {
    logPush_(kind, result.pop, result.event, 0, '沒有人訂閱');
    return;
  }
  const left = pushQuotaLeft_();
  if (left < to.length) {
    logPush_(kind, result.pop, result.event, 0, '額度不夠：剩 ' + left + ' 則，要發 ' + to.length + ' 人');
    return;
  }

  // multicast 一次最多 500 人
  for (let i = 0; i < to.length; i += 500) {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
      payload: JSON.stringify({
        to: to.slice(i, i + 500),
        messages: [choices_(result.message, result.buttons || [['全部功能', '選單']], { title: result.title, menu: false })], // 卡片.gs
      }),
    });
  }
  logPush_(kind, result.pop, result.event, to.length, result.reason + '，已發送（剩 ' + (left - to.length) + ' 則）');
}

/** 這個月還能主動推播幾則 */
function pushQuotaLeft_() {
  const get = path => JSON.parse(UrlFetchApp.fetch('https://api.line.me/v2/bot/message/' + path, {
    headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
  }).getContentText());
  const quota = get('quota');
  if (quota.type === 'none') return Infinity;
  return quota.value - get('quota/consumption').totalUsage;
}

/** 每晚的檢查結果都記一筆，之後可以跟現場計數對照：下雨天到底有沒有比較擠 */
function logPush_(kind, pop, event, count, note) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('推播紀錄');
  if (!sheet) {
    sheet = ss.insertSheet('推播紀錄');
    sheet.appendRow(['時間', '類型', '明早降雨機率', '行事曆', '發送人數', '說明']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), kind, pop == null ? '' : pop, event || '', count, note]);
}

// ===== 在編輯器裡手動執行 =====

/** 執行一次就好：設定每晚 9 點自動執行「晚上提醒」（重複執行不會重複設定） */
function 設定晚上提醒排程() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === '晚上提醒')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('晚上提醒').timeBased().everyDays(1).atHour(REMIND_HOUR).inTimezone(TZ).create();
  console.log('✅ 已設定：每天 ' + REMIND_HOUR + ':00～' + (REMIND_HOUR + 1) + ':00 之間執行「晚上提醒」');
}

/** 只印出來、不發送：看看未來幾天各會不會提醒 */
function 測試晚上提醒() {
  if (tooSoon_('測試晚上提醒', 60)) return; // Code.gs：公開網頁也呼叫得到，一分鐘只跑一次
  for (let d = 1; d <= 3; d++) {
    const day = addMin_(new Date(), d * 24 * 60);
    const r = buildReminder_(day);
    console.log('【' + Utilities.formatDate(day, TZ, 'M/d（E）') + '】' + (r.message ? '會提醒（' + r.reason + '）\n' + r.message : '不提醒：' + r.reason));
  }
  // 11/9 期中考第一天，確認考試週的訊息
  const exam = buildReminder_(new Date('2026-11-09T12:00:00+08:00'));
  console.log('【11/9 期中考】' + (exam.message ? '\n' + exam.message : exam.reason));
  console.log('目前訂閱人數：' + subscribers_().length + '，本月剩餘推播額度：' + pushQuotaLeft_());
}

/** 不管有沒有下雨，強制發一則測試訊息給所有訂閱的人（會用掉額度，測試時才用） */
function 試發給訂閱者() {
  // 要先在指令碼屬性把 ALLOW_TEST_PUSH 設成 1 才會發，發完自動關掉，避免被公開網頁拿來刷推播額度
  if (PROPS.getProperty('ALLOW_TEST_PUSH') !== '1') {
    console.log('沒有發送。要試發的話：專案設定 → 指令碼屬性 → 新增 ALLOW_TEST_PUSH，值填 1，再執行一次。');
    return;
  }
  PROPS.setProperty('ALLOW_TEST_PUSH', '0');
  sendToSubscribers_({
    message: '🧪 這是測試訊息\n\n如果你收到這則，代表晚上提醒可以正常推播 🎉',
    reason: '手動測試',
  }, '手動測試');
}
