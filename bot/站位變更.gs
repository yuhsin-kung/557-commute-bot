/**
 * 站位變更推播（30）
 *
 * 每 6 小時檢查一次德育中心的「557、300、通勤30等路線公車及劍南路站師生專車」頁面，
 * 內容有變就用 Gemini 寫兩三句摘要，推播給有訂閱提醒的人，並記到「站位變更紀錄」。
 * 學生問「557 在哪裡搭」時，回覆最新的摘要（回覆不用額度）。
 *
 * 第一次使用：在編輯器執行一次「設定站位檢查排程」，它也會先記下現在的頁面當作比對基準。
 */
const STATION_PAGE_URL = 'https://web-ch.scu.edu.tw/life/web_page/2440';
const CHECK_EVERY_HOURS = 6;

// ===== 排程每 6 小時執行 =====

function 檢查站位變更() {
  const now = fetchStationPage_();
  const hash = md5_(now);
  const lastHash = PROPS.getProperty('STATION_PAGE_HASH');
  if (hash === lastHash) return;

  const sheet = stationSheet_();
  if (!lastHash) {
    saveStation_(sheet, now, hash, summarizeStation_(now), '建立比對基準', '');
    return;
  }

  const before = sheet.getRange(sheet.getLastRow(), 3).getValue();
  const diff = diffSummary_(before, now);
  const summary = summarizeStation_(now);
  if (!diff) {
    saveStation_(sheet, now, hash, summary, '頁面有改，但不是站位或時刻的變更', '');
    return;
  }

  const message = '📢 557 站位／搭車資訊有更新\n\n' + diff
    + '\n\n詳細：' + STATION_PAGE_URL + '\n\n（傳「557 在哪裡搭」可以看最新的上車地點）';
  sendToSubscribers_({ message: message, reason: '站位變更' }, '站位變更'); // 晚上提醒.gs
  saveStation_(sheet, now, hash, summary, '已推播', diff);
}

/** 抓頁面，只留內文（標題列、側邊選單、頁尾的「最後更新時間」都不算） */
function fetchStationPage_() {
  const html = UrlFetchApp.fetch(STATION_PAGE_URL).getContentText();
  const start = html.indexOf("content-txtbox-noshade");
  const end = html.indexOf('回到頁首', start);
  if (start < 0 || end < 0) throw new Error('德育中心頁面改版了，找不到內文，要更新 fetchStationPage_');
  const body = html.slice(start, end);
  // 附件和圖片的網址也算內容：換了時刻表 PDF 或排隊示意圖也要知道
  const links = [];
  body.replace(/(?:href|src)=["']([^"']+\.(?:pdf|jpe?g|png))["']/gi, (m, url) => links.push(url));
  const text = body
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split('\n').map(s => s.trim()).filter(Boolean).join('\n');
  return text.replace(/^[^\n]*\n/, '') + '\n\n附件：\n' + links.join('\n'); // 第一行是 class 名稱的殘渣
}

// ===== Gemini 摘要 =====

/** 比較新舊內容，有站位、排隊、時刻的實質變更才回摘要，否則回空字串 */
function diffSummary_(before, after) {
  const answer = gemini_(
    '以下是東吳大學德育中心公告「557 等公車上車資訊」的舊版和新版內容。'
    + '請用 2～3 句繁體中文，說明對學生搭車有影響的變更（上車站牌位置、排隊方式、班次時刻、停駛）。'
    + '如果只是排版、錯字、日期格式這種不影響搭車的修改，只回「無實質變更」四個字。\n\n'
    + '【舊版】\n' + before + '\n\n【新版】\n' + after
  );
  if (!answer) return '頁面內容有更新，請點連結查看。'; // Gemini 不能用時，寧可多通知一次
  return /無實質變更/.test(answer) ? '' : answer.trim();
}

/** 把整頁整理成學生看得懂的上車地點說明 */
function summarizeStation_(text) {
  const answer = gemini_(
    '以下是東吳大學德育中心公告的公車上車資訊。請整理成給學生看的 LINE 訊息，繁體中文，不超過 250 字，'
    + '分成「士林站」「士林國中站」「校內」三段，寫出 557 的上車地點和排隊方式；300、通勤30、劍南路站師生專車各用一行帶過。'
    + '不要用 Markdown 的 ** 或 #，可以用 📍 開頭。\n\n' + text
  );
  return answer ? answer.trim() : '';
}

function gemini_(prompt) {
  const key = PROPS.getProperty('GEMINI_API_KEY');
  if (!key) return '';
  const call = model => UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': key },
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    muteHttpExceptions: true,
  });
  // 摘要要寫得好，先用 flash；免費版每分鐘只有 5 次，超過就換 lite
  let res = call('gemini-3.5-flash');
  if (res.getResponseCode() !== 200) res = call('gemini-3.5-flash-lite');
  if (res.getResponseCode() !== 200) {
    console.error('Gemini ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
    return '';
  }
  return JSON.parse(res.getContentText()).candidates[0].content.parts[0].text;
}

// ===== 學生問「在哪裡搭」 =====

function stationReply_() {
  const summary = PROPS.getProperty('STATION_SUMMARY');
  const checked = PROPS.getProperty('STATION_CHECKED_AT');
  return '🚏 557 上車地點\n\n'
    + (summary || '・捷運士林站：中正路 205 號（大成安心購）前\n・士林國中站：中正路 341 號（富邦銀行士林分行）前，尖峰建議來這裡排\n・校內：操場側站牌後，依藍線排隊')
    + '\n\n（來源：德育中心' + (checked ? '，' + checked + ' 更新' : '') + '）\n' + STATION_PAGE_URL;
}

// ===== 紀錄 =====

function saveStation_(sheet, text, hash, summary, status, diff) {
  sheet.appendRow([new Date(), status, text, diff, summary]);
  PROPS.setProperty('STATION_PAGE_HASH', hash);
  if (summary) PROPS.setProperty('STATION_SUMMARY', summary);
  PROPS.setProperty('STATION_CHECKED_AT', Utilities.formatDate(new Date(), TZ, 'M/d HH:mm'));
}

function stationSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('站位變更紀錄');
  if (!sheet) {
    sheet = ss.insertSheet('站位變更紀錄');
    sheet.appendRow(['時間', '狀態', '頁面內容', '變更摘要（推播內容）', '上車地點摘要']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function md5_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, text, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

// ===== 在編輯器裡手動執行 =====

/** 執行一次就好：每 6 小時檢查一次，並先記下現在的頁面當基準 */
function 設定站位檢查排程() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === '檢查站位變更')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('檢查站位變更').timeBased().everyHours(CHECK_EVERY_HOURS).create();
  檢查站位變更();
  console.log('✅ 已設定：每 ' + CHECK_EVERY_HOURS + ' 小時檢查一次德育中心頁面');
  console.log(stationReply_());
}

/** 不推播：假裝頁面改了，看 Gemini 會寫出什麼摘要 */
function 測試站位變更() {
  const now = fetchStationPage_();
  const fake = now.replace('中正路２０５號', '中正路２２１號').replace('大成安心購', '全家便利商店');
  console.log('【假裝 557 站牌搬到全家前】\n' + (diffSummary_(now, fake) || '（判斷為無實質變更）'));
  console.log('\n【只改排版】\n' + (diffSummary_(now, now.replace(/。/g, '.')) || '（判斷為無實質變更）'));
  console.log('\n【學生問 557 在哪裡搭】\n' + stationReply_());
}
