// 卡片式回覆（bot/卡片.gs）和改成卡片的各種回覆。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBot } = require('./gas-env');
const { sampleCards } = require('./sample-cards');

const FILES = ['Code.gs', '卡片.gs', '選單.gs', '比較器.gs', '晚上提醒.gs', '站位變更.gs', '共乘.gs', '等車室.gs', '定位測試.gs'];
const plain = x => JSON.parse(JSON.stringify(x));

/** 走過卡片裡每一個元件 */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  ['header', 'body', 'footer'].forEach(k => walk(node[k], visit));
  (node.contents && Array.isArray(node.contents) ? node.contents : []).forEach(c => walk(c, visit));
  if (node.contents && !Array.isArray(node.contents)) walk(node.contents, visit);
}

test('card_：標題列磚紅底白字，第一顆按鈕是主要按鈕，其他是連結樣式', () => {
  const env = loadBot(FILES);
  const card = plain(env.call('card_', {
    badge: '小字', title: '標題', subtitle: '副標',
    rows: [{ label: 'A', value: '1', sub: '說明', best: true }, { label: 'B', value: '2' }],
    notes: ['提示'], warns: ['注意'], footer: '來源',
    buttons: [{ label: '傳訊息', text: '共乘' }, { label: '開網頁', uri: 'https://example.com' }],
  }));
  assert.equal(card.type, 'flex');
  const b = card.contents;
  assert.equal(b.header.backgroundColor, '#A63A2B');
  assert.deepEqual(b.header.contents.map(c => c.text), ['小字', '標題', '副標']);
  assert.equal(b.header.contents[1].color, '#FFFFFF');
  assert.equal(b.body.backgroundColor, '#FBF7F0');
  assert.deepEqual(b.footer.contents.map(c => [c.style, c.action.type]), [['primary', 'message'], ['link', 'uri']]);
  assert.equal(b.footer.contents[0].color, '#A63A2B');
  assert.equal(card.altText, '標題（副標）\n★ A：1\n　說明\n・B：2\n\n提示\n\n注意\n\n（來源）');
});

test('card_：提醒用琥珀色，不用品牌的紅色', () => {
  const env = loadBot(FILES);
  const body = plain(env.call('card_', { title: 't', notes: ['提示'], warns: ['注意'] })).contents.body.contents;
  assert.equal(body[0].contents[0].color, '#1B1D22');
  assert.equal(body[1].contents[0].color, '#8A5A00');
});

test('card_：沒有內容時也不會產生 LINE 不接受的空卡片；純文字版最多 400 字', () => {
  const env = loadBot(FILES);
  const empty = plain(env.call('card_', { title: '只有標題', notes: [''], buttons: [] }));
  assert.equal(empty.contents.body.contents.length, 1);
  assert.equal(empty.contents.footer, undefined);
  const long = plain(env.call('card_', { title: 't', notes: ['字'.repeat(900)] }));
  assert.equal(long.altText.length, 400);
});

test('每一種回覆的卡片：沒有空字串、顏色格式正確、按鈕文字不超過 20 字', () => {
  const cards = sampleCards();
  assert.ok(Object.keys(cards).length >= 9);
  Object.keys(cards).forEach(name => {
    const card = cards[name];
    assert.equal(card.type, 'flex', name);
    assert.ok(card.altText.length > 0 && card.altText.length <= 400, name + ' 的純文字版');
    walk(card.contents, node => {
      if (node.type === 'text') assert.ok(typeof node.text === 'string' && node.text.length > 0, name + ' 有空的文字');
      ['color', 'backgroundColor'].forEach(k => { if (node[k]) assert.match(node[k], /^#[0-9A-F]{6}$/, name + ' 的 ' + k); });
      if (node.type === 'button') assert.ok(node.action.label.length <= 20, name + ' 的按鈕「' + node.action.label + '」太長');
      if (node.type === 'box') assert.ok(node.contents.length > 0, name + ' 有空的區塊');
    });
  });
});

test('即時比較：照到校時間排，最快的標成推薦，不會到東吳的路線不列', () => {
  const card = sampleCards().即時比較;
  const rows = card.contents.body.contents.filter(c => c.type === 'box' && c.contents[0].layout === 'horizontal');
  assert.deepEqual(rows.map(r => r.contents[0].contents[0].text), ['紅30', '255', '304重慶', '557']);
  assert.equal(rows[0].contents[0].contents[0].color, '#A63A2B', '最快的那一列用品牌色');
  assert.equal(rows[1].contents[0].contents[0].color, '#1B1D22');
  assert.match(rows[0].contents[0].contents[1].text, /^即將進站・\d\d:\d\d 到$/);
  assert.equal(rows[0].contents[1].text, '錢穆故居站下車，走 5 分鐘');
  assert.equal(rows[3].contents[1].text, '直接進校園，走 2 分鐘');
  assert.match(card.altText, /紅30 跟 557 走一樣的路/);
  assert.equal(card.contents.header.contents[1].text, '士林站 → B 棟');
});

test('即時比較：沒有車的時候說明原因，並給共乘的按鈕', () => {
  const card = sampleCards().即時比較沒車;
  assert.match(card.altText, /沒有車往東吳的即時資料/);
  assert.equal(card.contents.footer.contents[0].action.text, '共乘');
});

test('出門建議：平日早八會多算尖峰的 10 分鐘；劍南路出發會列學校專車', () => {
  const cards = sampleCards();
  assert.match(cards.出門建議.altText, /★ 搭 557 進校園：07:38 前到士林站\n　尖峰可能要等一兩班，已多算 10 分鐘/);
  assert.match(cards.出門建議.altText, /・搭其他車：07:42 前到士林站/);
  assert.equal(cards.出門建議.contents.header.contents[1].text, '明天 08:10 上課');
  assert.equal(cards.出門建議.contents.footer.contents[0].action.text, '共乘 去學校 預約');
  assert.match(cards.出門建議劍南路.altText, /・學校專車：07:50 發車/);
});

test('天氣：60% 以上用提醒的顏色，並把降雨機率標出來', () => {
  const cards = sampleCards();
  const rainy = cards.天氣會下雨.contents.body.contents;
  assert.equal(rainy[0].contents[0].contents[1].text, '80%');
  assert.equal(rainy[1].contents[0].color, '#8A5A00');
  const fine = cards.天氣不會下雨.contents.body.contents;
  assert.equal(fine[1].contents[0].color, '#1B1D22');
  assert.match(cards.天氣不會下雨.altText, /應該不會下雨/);
});

test('上車地點：還沒有德育中心的摘要時，用內建的三個地點', () => {
  const cards = sampleCards();
  assert.match(cards.上車地點.altText, /捷運士林站：中正路 205 號前/);
  assert.match(cards.上車地點有摘要.altText, /這是德育中心公告的摘要/);
  assert.equal(cards.上車地點.contents.footer.contents[0].action.uri, 'https://web-ch.scu.edu.tw/life/web_page/2440');
});

test('LINE 不接受卡片時，改用純文字再回一次', () => {
  const env = loadBot(FILES);
  let calls = 0;
  env.onFetch = url => (url.endsWith('/message/reply') && ++calls === 1 ? { code: 400, body: { message: 'A message (messages[0]) in the request body is invalid' } } : undefined);
  env.call('reply_', 'token', env.call('stationReply_'));
  const replies = env.fetches.filter(f => f.url.endsWith('/message/reply'));
  assert.equal(replies.length, 2);
  assert.equal(replies[0].body.messages[0].type, 'flex');
  assert.equal(replies[1].body.messages[0].type, 'text');
  assert.match(replies[1].body.messages[0].text, /^557 上車地點\n・捷運士林站：中正路 205 號前/);
  assert.ok(replies[1].body.messages[0].quickReply);
});

test('訊息紀錄裡存的是卡片的純文字版', () => {
  const env = loadBot(FILES);
  env.call('handleEvent_', { type: 'follow', replyToken: 'r', source: { userId: 'A' } });
  const row = env.sheets['訊息紀錄'].rows[1];
  assert.equal(row[2], '（加入好友）');
  assert.match(row[3], /^嗨！我是東吳通勤達人。[\s\S]*全部功能（往左滑還有更多）\n【怎麼去學校】現在最快的車、排出門時間/);
});
