/**
 * 共享雨傘（20）：錢穆故居站和校門口各放幾把，借了走到另一端再還
 *
 * 在 LINE 傳「借傘」→ 選在哪裡借 → 拍下傘上的傘號傳給 Bot → AI 讀出傘號，對得上才算借到。
 * 傳「還傘」→ 選在哪裡還 → 一樣拍傘號，要跟借的那把一樣才算還了。
 * 照片只拿來讀傘號，不存檔。AI 不能用的時候不放行，請同學稍後再拍。
 * 一個人一次只能借一把。歸還有積分（積分.gs），一天只給一次。每一筆都記在「雨傘」分頁。
 * 雨傘清單要先建立：在編輯器執行一次「建立雨傘清單」（之後可以直接在試算表加傘號）。
 * 用到共乘.gs 的 cpSheet_、cpLocked_、cpNow_，積分.gs 的 ptAdd_、PT，站位變更.gs 的 geminiImage_。
 */
const UM_SPOTS = ['錢穆故居站', '校門口'];
const UM_HEAD = ['傘號', '狀態', '借用人', '地點', '借出時間', '歸還時間'];
const UM_PER_SPOT = 3; // 建立清單時每個點放幾把
const UM_WAIT_MIN = 10; // 選好地點後幾分鐘內要傳照片

/** 文字訊息開頭是「借傘」「還傘」「共享雨傘」時由 Code.gs 轉過來 */
function umText_(uid, text) {
  const p = text.trim().split(/\s+/);
  if (p[0] === '共享雨傘') return umHelp_(uid);
  if (UM_SPOTS.indexOf(p[1]) < 0) {
    return choices_(p[0] === '借傘' ? '在哪裡借傘？' : '在哪裡還傘？', UM_SPOTS.map(s => [s, p[0] + ' ' + s]));
  }
  return umAsk_(uid, p[0] === '借傘' ? '借' : '還', p[1]);
}

function umHelp_(uid) {
  const mine = umRows_().filter(u => u.status === '借出' && u.user === uid)[0];
  const left = UM_SPOTS.map(s => s + ' ' + umRows_().filter(u => u.status === '在架' && u.spot === s).length + ' 把').join('、');
  return choices_([
    '☂️ 共享雨傘',
    '',
    '傘架放在錢穆故居站和校門口。下雨天借一把，走到另一端再還。',
    '借傘、還傘都要拍下傘上的傘號傳給我，確認是同一把才算數。',
    '現在可以借：' + left,
    mine ? '你目前借了 ' + mine.id + '，記得歸還。' : '歸還有 ' + PT.UMBRELLA + ' 點。',
  ].join('\n'), mine ? [['還傘', '還傘']] : [['借傘', '借傘'], ['還傘', '還傘']]);
}

/** 選好地點：先檢查能不能借／還，再請同學拍傘號 */
function umAsk_(uid, act, spot) {
  const all = umRows_();
  const mine = all.filter(u => u.status === '借出' && u.user === uid)[0];
  if (act === '借') {
    if (mine) return choices_('你已經借了 ' + mine.id + '，先歸還才能再借。', [['還傘', '還傘']]);
    if (!all.some(u => u.status === '在架' && u.spot === spot)) return '☂️ ' + spot + '現在沒有傘可以借了，抱歉 🙏';
  } else if (!mine) {
    return '你現在沒有借傘喔。';
  }
  CacheService.getScriptCache().put('um_wait_' + uid, JSON.stringify({ act: act, spot: spot }), UM_WAIT_MIN * 60);
  return '📸 請拍下' + (act === '借' ? '要借的那把傘' : '你借的 ' + mine.id + ' ') + '上的傘號（例如 U01），直接把照片傳給我。\n' + UM_WAIT_MIN + ' 分鐘內傳就可以。';
}

/** 收到照片：有在等借還的照片才處理，不然回傳 null（Bot 不回話） */
function umPhoto_(uid, messageId) {
  const cache = CacheService.getScriptCache();
  const saved = cache.get('um_wait_' + uid);
  if (!saved) return null;
  const wait = JSON.parse(saved);
  const id = umReadNumber_(messageId);
  if (id === null) return '☂️ 暫時沒辦法辨識照片，請過一分鐘再傳一次。';
  if (!id) return '☂️ 看不清楚傘號，請對準傘上的號碼再拍一次。';
  const answer = cpLocked_(() => (wait.act === '借' ? umBorrow_(uid, wait.spot, id) : umReturn_(uid, wait.spot, id)));
  if (answer.done) cache.remove('um_wait_' + uid);
  return answer.text;
}

function umBorrow_(uid, spot, id) {
  const all = umRows_();
  const mine = all.filter(u => u.status === '借出' && u.user === uid)[0];
  if (mine) return { done: true, text: '你已經借了 ' + mine.id + '，先歸還才能再借。' };
  const pick = all.filter(u => u.id === id)[0];
  if (!pick) return { done: false, text: '☂️ 照片上的傘號是 ' + id + '，不是共享雨傘的傘號，請再拍一次。' };
  if (pick.status !== '在架' || pick.spot !== spot) return { done: false, text: '☂️ ' + id + ' 現在不在' + spot + '的傘架上，請拍架上的另一把。' };
  umSave_(pick.row, [pick.id, '借出', uid, spot, cpNow_(), '']);
  return { done: true, text: choices_('☂️ 借到 ' + pick.id + '！\n走到另一端後傳「還傘」，一樣拍傘號歸還。', [['還傘', '還傘']]) };
}

function umReturn_(uid, spot, id) {
  const mine = umRows_().filter(u => u.status === '借出' && u.user === uid)[0];
  if (!mine) return { done: true, text: '你現在沒有借傘喔。' };
  if (id !== mine.id) return { done: false, text: '☂️ 照片上的傘號是 ' + id + '，你借的是 ' + mine.id + '，請拍你借的那把再傳一次。' };
  umSave_(mine.row, [mine.id, '在架', '', spot, mine.out, cpNow_()]);
  // 還傘的積分一天只給一次，不然重複借還可以一直加分
  if (ptDoneToday_(uid, '還傘')) return { done: true, text: '☂️ 已歸還 ' + mine.id + '，謝謝！今天的還傘積分已經領過了。' };
  const fresh = ptAdd_(uid, '還傘', PT.UMBRELLA, 0, mine.id + ' 還到' + spot);
  return { done: true, text: '☂️ 已歸還 ' + mine.id + '，謝謝！+' + PT.UMBRELLA + ' 點' + ptBadgeText_(fresh) };
}

/**
 * 從 LINE 下載照片，請 AI 讀出傘號。回傳 'U01' 這種格式；
 * 看不到傘號回傳空字串；AI 不能用（沒金鑰、額度用完）回傳 null。
 */
function umReadNumber_(messageId) {
  const res = UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/' + encodeURIComponent(messageId) + '/content', {
    headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) return null;
  const blob = res.getBlob();
  const answer = geminiImage_( // 站位變更.gs
    '這是一把共享雨傘的照片，傘上貼著傘號，格式是英文字母 U 加兩位數字（例如 U01、U12）。'
    + '請只回傘號本身；如果照片裡看不到傘號，只回「看不到」三個字。',
    blob.getContentType() || 'image/jpeg', Utilities.base64Encode(blob.getBytes()));
  if (!answer) return null;
  const m = answer.toUpperCase().match(/U\s*-?\s*(\d{1,2})/);
  return m ? 'U' + ('0' + m[1]).slice(-2) : '';
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
