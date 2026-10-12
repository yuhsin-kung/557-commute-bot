/**
 * 共享雨傘（20）：錢穆故居站和校門口各放幾把，借了走到另一端再還
 *
 * 在 LINE 傳「借傘」→ 選在哪裡借 → Bot 給一把傘號；傳「還傘」→ 選在哪裡還。
 * 一個人一次只能借一把。歸還有積分（積分.gs），一天只給一次。每一筆都記在「雨傘」分頁。
 * 雨傘清單要先建立：在編輯器執行一次「建立雨傘清單」（之後可以直接在試算表加傘號）。
 * 用到共乘.gs 的 cpSheet_、cpLocked_、cpNow_，積分.gs 的 ptAdd_、PT。
 */
const UM_SPOTS = ['錢穆故居站', '校門口'];
const UM_HEAD = ['傘號', '狀態', '借用人', '地點', '借出時間', '歸還時間'];
const UM_PER_SPOT = 3; // 建立清單時每個點放幾把

/** 文字訊息開頭是「借傘」「還傘」「共享雨傘」時由 Code.gs 轉過來 */
function umText_(uid, text) {
  const p = text.trim().split(/\s+/);
  if (p[0] === '共享雨傘') return umHelp_(uid);
  if (UM_SPOTS.indexOf(p[1]) < 0) {
    return choices_(p[0] === '借傘' ? '在哪裡借傘？' : '在哪裡還傘？', UM_SPOTS.map(s => [s, p[0] + ' ' + s]));
  }
  return cpLocked_(() => (p[0] === '借傘' ? umBorrow_(uid, p[1]) : umReturn_(uid, p[1])));
}

function umHelp_(uid) {
  const mine = umRows_().filter(u => u.status === '借出' && u.user === uid)[0];
  const left = UM_SPOTS.map(s => s + ' ' + umRows_().filter(u => u.status === '在架' && u.spot === s).length + ' 把').join('、');
  return choices_([
    '☂️ 共享雨傘',
    '',
    '傘架放在錢穆故居站和校門口。下雨天借一把，走到另一端再還。',
    '現在可以借：' + left,
    mine ? '你目前借了 ' + mine.id + '，記得歸還。' : '歸還有 ' + PT.UMBRELLA + ' 分。',
  ].join('\n'), mine ? [['還傘', '還傘']] : [['借傘', '借傘'], ['還傘', '還傘']]);
}

function umBorrow_(uid, spot) {
  const all = umRows_();
  const mine = all.filter(u => u.status === '借出' && u.user === uid)[0];
  if (mine) return choices_('你已經借了 ' + mine.id + '，先歸還才能再借。', [['還傘', '還傘']]);
  const free = all.filter(u => u.status === '在架' && u.spot === spot)[0];
  if (!free) return '☂️ ' + spot + '現在沒有傘可以借了，抱歉 🙏';
  umSave_(free.row, [free.id, '借出', uid, spot, cpNow_(), '']);
  return choices_('☂️ 借到 ' + free.id + '！\n請拿傘架上貼著 ' + free.id + ' 的那一把。走到另一端後傳「還傘」歸還。', [['還傘', '還傘']]);
}

function umReturn_(uid, spot) {
  const mine = umRows_().filter(u => u.status === '借出' && u.user === uid)[0];
  if (!mine) return '你現在沒有借傘喔。';
  umSave_(mine.row, [mine.id, '在架', '', spot, mine.out, cpNow_()]);
  // 借還只要打字就算數，所以還傘的積分一天只給一次，不然重複借還可以一直加分
  if (ptDoneToday_(uid, '還傘')) return '☂️ 已歸還 ' + mine.id + '，謝謝！今天的還傘積分已經領過了。';
  const fresh = ptAdd_(uid, '還傘', PT.UMBRELLA, 0, mine.id + ' 還到' + spot);
  return '☂️ 已歸還 ' + mine.id + '，謝謝！+' + PT.UMBRELLA + ' 分' + ptBadgeText_(fresh);
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
