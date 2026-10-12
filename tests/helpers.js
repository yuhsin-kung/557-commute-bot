// 測試共用的小工具：從 Bot 的回覆裡讀出文字和按鈕
// 按鈕都做在訊息裡（卡片.gs 的 card_、choices_），所以要走進卡片裡面找。

/** Bot 環境裡產生的物件和測試這邊的不是同一種，比對內容前先轉一次 */
const plain = x => JSON.parse(JSON.stringify(x));

/** 把回覆（文字、訊息物件或陣列）接成一段文字。卡片用它的純文字版 */
function textOf(answer) {
  return (Array.isArray(answer) ? answer : [answer])
    .map(m => (typeof m === 'string' ? m : m.text || m.altText || ''))
    .join('\n');
}

/** 這則訊息說的話：文字訊息就是文字；卡片是純文字版去掉最後一行的按鈕清單（［按鈕］［按鈕］） */
function saidOf(message) {
  if (typeof message === 'string') return message;
  if (message.text) return message.text;
  const lines = message.altText.split('\n');
  if (lines[lines.length - 1].startsWith('［')) lines.pop();
  return lines.join('\n');
}

/** 走過卡片裡每一個元件 */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  ['header', 'body', 'footer'].forEach(k => walk(node[k], visit));
  if (Array.isArray(node.contents)) node.contents.forEach(c => walk(c, visit));
  else walk(node.contents, visit);
}

/**
 * 一則訊息裡所有按得下去的東西：[[按鈕上的字, 按了會怎樣], …]
 * 傳訊息的是傳出的字，開網頁的是網址，選時間的是 { picker: 設定 }。最下面的「回選單」不算。
 */
function buttonsOf(message) {
  const found = [];
  walk(plain(message).contents, node => {
    const a = node.action;
    if (!a || a.label === '回選單') return;
    if (a.type === 'message') found.push([a.label, a.text]);
    else if (a.type === 'uri') found.push([a.label, a.uri]);
    else found.push([a.label, { picker: a }]);
  });
  return found;
}

/** 這則訊息有沒有用到輸入框上面那排「快速回覆」（不應該有） */
const hasQuickReply = answer => (Array.isArray(answer) ? answer : [answer]).some(m => m && typeof m === 'object' && 'quickReply' in m);

module.exports = { plain, textOf, saidOf, walk, buttonsOf, hasQuickReply };
