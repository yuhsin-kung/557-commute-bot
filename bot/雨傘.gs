/**
 * 共享雨傘（20）：錢穆故居站和校門口各放幾把，借了走到另一端再還
 *
 * 借和還都要拍一張照片才算完成（像共享機車還車要拍照）：
 *   傳「借傘」→ 選在哪裡借 → Bot 給一把傘號 → 拍那把傘傳過來 → 借出
 *   傳「還傘」→ 選在哪裡還 → 把傘放回傘架 → 拍一張傳過來 → 歸還
 * 選完地點 10 分鐘內要傳照片，超過就要重選。
 *
 * 照片：
 *   - 存在隊伍 Google 雲端硬碟的「共享雨傘照片」資料夾（不公開），連結記在「雨傘紀錄」
 *   - 有 Gemini 金鑰時會先看一眼縮圖：沒拍到雨傘、或拍到人臉，就請同學重拍（平台不拍攝任何人）
 *     Gemini 不能用（沒金鑰、額度用完）就直接收，不會卡住借還
 *
 * 一個人一次只能借一把。歸還有積分（積分.gs），一天只給一次。
 * 「雨傘」分頁是每把傘現在的狀態；「雨傘紀錄」是每一次借還（測試數據：借傘次數、歸還率）。
 * 雨傘清單要先建立：在編輯器執行一次「建立雨傘清單」（之後可以直接在試算表加傘號）。
 * 第一次用到照片時，Google 會要求授權雲端硬碟。
 * 用到 Code.gs 的 PROPS，卡片.gs 的 choices_，共乘.gs 的 cpSheet_、cpLocked_、cpNow_，積分.gs 的 ptAdd_、ptDoneToday_、PT。
 */
const UM_SPOTS = ['錢穆故居站', '校門口'];
const UM_HEAD = ['傘號', '狀態', '借用人', '地點', '借出時間', '歸還時間'];
const UM_LOG_HEAD = ['時間', '使用者 ID', '動作', '傘號', '地點', '照片', '照片檢查'];
const UM_PER_SPOT = 3;        // 建立清單時每個點放幾把
const UM_PHOTO_WAIT_MIN = 10; // 選完地點後幾分鐘內要傳照片
const UM_FOLDER_NAME = '共享雨傘照片';

/** 文字訊息開頭是「借傘」「還傘」「共享雨傘」時由 Code.gs 轉過來 */
function umText_(uid, text) {
  const p = text.trim().split(/\s+/);
  if (p[0] === '共享雨傘') return umHelp_(uid);
  if (UM_SPOTS.indexOf(p[1]) < 0) {
    return choices_(p[0] === '借傘' ? '在哪裡借傘？' : '在哪裡還傘？', UM_SPOTS.map(s => [s, p[0] + ' ' + s]));
  }
  return cpLocked_(() => (p[0] === '借傘' ? umAskBorrow_(uid, p[1]) : umAskReturn_(uid, p[1])));
}

function umHelp_(uid) {
  const mine = umRows_().filter(u => u.status === '借出' && u.user === uid)[0];
  const left = UM_SPOTS.map(s => s + ' ' + umRows_().filter(u => u.status === '在架' && u.spot === s).length + ' 把').join('、');
  return choices_([
    '☂️ 共享雨傘',
    '',
    '傘架放在錢穆故居站和校門口。下雨天借一把，走到另一端再還。',
    '借和還都要拍一張雨傘的照片。',
    '現在可以借：' + left,
    mine ? '你目前借了 ' + mine.id + '，記得歸還。' : '歸還有 ' + PT.UMBRELLA + ' 分。',
  ].join('\n'), mine ? [['還傘', '還傘']] : [['借傘', '借傘'], ['還傘', '還傘']]);
}

// ===== 第一步：選地點，Bot 請同學拍照 =====

function umAskBorrow_(uid, spot) {
  const all = umRows_();
  const mine = all.filter(u => u.status === '借出' && u.user === uid)[0];
  if (mine) return choices_('你已經借了 ' + mine.id + '，先歸還才能再借。', [['還傘', '還傘']]);
  const free = all.filter(u => u.status === '在架' && u.spot === spot)[0];
  if (!free) return '☂️ ' + spot + '現在沒有傘可以借了，抱歉 🙏';
  umPending_(uid, { act: '借出', spot: spot, id: free.id });
  return umCamera_('☂️ 請拿傘架上貼著 ' + free.id + ' 的那一把。\n\n📷 拍一張這把傘的照片傳給我（傘號要拍到），才算借出。\n' + UM_PHOTO_WAIT_MIN + ' 分鐘內有效。');
}

function umAskReturn_(uid, spot) {
  const mine = umRows_().filter(u => u.status === '借出' && u.user === uid)[0];
  if (!mine) return '你現在沒有借傘喔。';
  umPending_(uid, { act: '歸還', spot: spot, id: mine.id });
  return umCamera_('☂️ 請把 ' + mine.id + ' 放回' + spot + '的傘架。\n\n📷 拍一張傘放在傘架上的照片傳給我，才算歸還。\n' + UM_PHOTO_WAIT_MIN + ' 分鐘內有效。');
}

/** 等照片的狀態放在快取，過期就要重選 */
function umPending_(uid, state) {
  const cache = CacheService.getScriptCache();
  if (state === undefined) {
    const saved = cache.get('um_wait_' + uid);
    return saved ? JSON.parse(saved) : null;
  }
  if (state === null) cache.remove('um_wait_' + uid);
  else cache.put('um_wait_' + uid, JSON.stringify(state), UM_PHOTO_WAIT_MIN * 60);
  return state;
}

/**
 * 請同學拍照的訊息。
 * 全專案唯一用到輸入框上面那排按鈕（快速回覆）的地方：LINE 規定「一按就開相機」只能放在那一排，
 * 所以這一則例外放兩顆——開相機、從相簿選。其他按鈕照舊做在訊息裡。
 * 不按那排也沒關係，用 LINE 自己的相機或相簿傳照片一樣收得到。
 */
function umCamera_(text) {
  const message = choices_(text + '\n\n請只拍雨傘和傘架，不要拍到人。', [['先不要了', '共享雨傘']], { primary: false }); // 卡片.gs
  message.quickReply = { items: [
    { type: 'action', action: { type: 'camera', label: '開相機拍照' } },
    { type: 'action', action: { type: 'cameraRoll', label: '從相簿選' } },
  ] };
  return message;
}

// ===== 第二步：收到照片 =====

/** 使用者傳照片時由 Code.gs 轉過來。messageId 是 LINE 給這張照片的編號 */
function umPhoto_(uid, messageId) {
  return cpLocked_(() => {
    const wait = umPending_(uid);
    if (!wait) return choices_('收到照片了，但你現在沒有在借傘或還傘。\n要借還雨傘請先選地點。', [['借傘', '借傘'], ['還傘', '還傘']]);

    const check = umCheckPhoto_(messageId);
    if (check && !check.umbrella) return umCamera_('📷 照片裡看不到雨傘，請再拍一次。');
    if (check && check.person) return umCamera_('📷 照片拍到人了。為了保護隱私，請只拍雨傘和傘架，再拍一次。');
    const verdict = check ? '通過' : '未檢查';

    return wait.act === '借出' ? umBorrow_(uid, wait, messageId, verdict) : umReturn_(uid, wait, messageId, verdict);
  });
}

function umBorrow_(uid, wait, messageId, verdict) {
  const all = umRows_();
  if (all.some(u => u.status === '借出' && u.user === uid)) { umPending_(uid, null); return '你已經借了一把傘，先歸還才能再借。'; }
  // 等拍照的這段時間，原本那把可能被別人借走了，換同一個點的另一把
  const free = all.filter(u => u.status === '在架' && u.spot === wait.spot && u.id === wait.id)[0]
    || all.filter(u => u.status === '在架' && u.spot === wait.spot)[0];
  if (!free) { umPending_(uid, null); return '☂️ ' + wait.spot + '的傘剛剛被借完了，抱歉 🙏'; }

  const photo = umSavePhoto_(messageId, '借出', free.id, wait.spot);
  umSave_(free.row, [free.id, '借出', uid, wait.spot, cpNow_(), '']);
  umLog_(uid, '借出', free.id, wait.spot, photo, verdict);
  umPending_(uid, null);
  return choices_('☂️ 借到 ' + free.id + '！' + (free.id !== wait.id ? '\n（' + wait.id + ' 剛被借走，請改拿 ' + free.id + '）' : '')
    + '\n走到另一端後按「還傘」，把傘放回傘架再拍一張。', [['還傘', '還傘']]);
}

function umReturn_(uid, wait, messageId, verdict) {
  const mine = umRows_().filter(u => u.status === '借出' && u.user === uid)[0];
  if (!mine) { umPending_(uid, null); return '你現在沒有借傘喔。'; }

  const photo = umSavePhoto_(messageId, '歸還', mine.id, wait.spot);
  umSave_(mine.row, [mine.id, '在架', '', wait.spot, mine.out, cpNow_()]);
  umLog_(uid, '歸還', mine.id, wait.spot, photo, verdict);
  umPending_(uid, null);
  // 還傘的積分一天只給一次，不然重複借還可以一直加分
  if (ptDoneToday_(uid, '還傘')) return '☂️ 已歸還 ' + mine.id + '，謝謝！今天的還傘積分已經領過了。';
  const fresh = ptAdd_(uid, '還傘', PT.UMBRELLA, 0, mine.id + ' 還到' + wait.spot);
  return '☂️ 已歸還 ' + mine.id + '，謝謝！+' + PT.UMBRELLA + ' 分' + ptBadgeText_(fresh);
}

// ===== 照片：存檔、檢查 =====

function umLineContent_(messageId, preview) {
  return UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + messageId + '/content' + (preview ? '/preview' : ''), {
    headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
    muteHttpExceptions: true,
  });
}

/** 把照片存進雲端硬碟，回傳連結。存檔失敗不能讓借還失敗，所以失敗就回一段說明文字 */
function umSavePhoto_(messageId, act, umbrellaId, spot) {
  try {
    const res = umLineContent_(messageId, false);
    if (res.getResponseCode() !== 200) return '照片下載失敗（' + res.getResponseCode() + '）';
    const name = Utilities.formatDate(cpNow_(), TZ, 'yyyy-MM-dd HHmm') + ' ' + act + ' ' + umbrellaId + ' ' + spot + '.jpg';
    return umFolder_().createFile(res.getBlob().setName(name)).getUrl();
  } catch (err) {
    console.error(err);
    return '照片存檔失敗';
  }
}

/** 資料夾只建立一次，編號記在指令碼屬性 UM_FOLDER_ID。預設不公開，只有隊伍帳號看得到 */
function umFolder_() {
  const id = PROPS.getProperty('UM_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { console.error(err); } // 資料夾被刪掉就重建
  }
  const folder = DriveApp.createFolder(UM_FOLDER_NAME);
  PROPS.setProperty('UM_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * 用 Gemini 看縮圖：有沒有雨傘、有沒有拍到人臉。
 * 回傳 { umbrella, person }；沒有金鑰、額度用完、或任何錯誤都回傳 null（不檢查，直接收）。
 */
function umCheckPhoto_(messageId) {
  const key = PROPS.getProperty('GEMINI_API_KEY');
  if (!key) return null;
  try {
    const img = umLineContent_(messageId, true);
    if (img.getResponseCode() !== 200) return null;
    const blob = img.getBlob();
    const body = {
      contents: [{ parts: [
        { inlineData: { mimeType: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) } },
        { text: '這是共享雨傘借還時拍的照片。umbrella：照片裡有沒有雨傘或放雨傘的傘架。person：有沒有拍到看得出是誰的人臉（只有手、背影、遠方路人不算）。' },
      ] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: { umbrella: { type: 'BOOLEAN' }, person: { type: 'BOOLEAN' } }, required: ['umbrella', 'person'] },
      },
    };
    const call = model => UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key }, payload: JSON.stringify(body), muteHttpExceptions: true,
    });
    // 跟比較器一樣：先用 lite（免費額度比較多），不行再換 flash
    let res = call('gemini-3.5-flash-lite');
    if (res.getResponseCode() !== 200) res = call('gemini-3.5-flash');
    if (res.getResponseCode() !== 200) return null;
    const answer = JSON.parse(JSON.parse(res.getContentText()).candidates[0].content.parts[0].text);
    return { umbrella: answer.umbrella === true, person: answer.person === true };
  } catch (err) {
    console.error(err);
    return null;
  }
}

// ===== 資料：雨傘、雨傘紀錄 =====

function umLog_(uid, act, umbrellaId, spot, photo, verdict) {
  cpSheet_('雨傘紀錄', UM_LOG_HEAD).appendRow([cpNow_(), uid, act, umbrellaId, spot, photo, verdict]);
}

function umRows_() {
  return cpSheet_('雨傘', UM_HEAD).getDataRange().getValues().slice(1)
    .map((r, i) => ({ row: i + 2, id: r[0], status: r[1], user: r[2], spot: r[3], out: r[4] }))
    .filter(u => u.id);
}

function umSave_(row, values) {
  cpSheet_('雨傘', UM_HEAD).getRange(row, 1, 1, 6).setValues([values]);
}

/** 執行一次就好：每個點放 UM_PER_SPOT 把。已經有清單就不動 */
function 建立雨傘清單() {
  if (tooSoon_('建立雨傘清單', 60)) return; // Code.gs：公開網頁也呼叫得到
  const sheet = cpSheet_('雨傘', UM_HEAD);
  if (sheet.getLastRow() > 1) {
    console.log('「雨傘」分頁已經有資料了，要加傘直接在試算表新增一列。');
    return;
  }
  let n = 0;
  UM_SPOTS.forEach(spot => {
    for (let i = 0; i < UM_PER_SPOT; i++) {
      n += 1;
      sheet.appendRow(['U' + ('0' + n).slice(-2), '在架', '', spot, '', '']);
    }
  });
  console.log('建立了 ' + n + ' 把雨傘。');
}
