// 卡片式回覆（bot/卡片.gs）和改成卡片的各種回覆。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBot } = require('./gas-env');
const { sampleCards } = require('./sample-cards');

const FILES = ['Code.gs', '卡片.gs', '選單.gs', '比較器.gs', '晚上提醒.gs', '站位變更.gs', '共乘.gs', '等車室.gs', '定位測試.gs', '積分.gs', '新生.gs'];
const plain = x => JSON.parse(JSON.stringify(x));

/** 走過卡片裡每一個元件 */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  ['header', 'body', 'footer'].forEach(k => walk(node[k], visit));
  (node.contents && Array.isArray(node.contents) ? node.contents : []).forEach(c => walk(c, visit));
  if (node.contents && !Array.isArray(node.contents)) walk(node.contents, visit);
}

test('card_：設計稿樣式（白底標題區、深色標題字），第一顆按鈕是綠色主要按鈕，其他是連結樣式', () => {
  const env = loadBot(FILES);
  const card = plain(env.call('card_', {
    badge: '小字', title: '標題', subtitle: '副標',
    rows: [{ label: 'A', value: '1', sub: '說明', best: true }, { label: 'B', value: '2' }],
    notes: ['提示'], warns: ['注意'], footer: '來源',
    buttons: [{ label: '傳訊息', text: '共乘' }, { label: '開網頁', uri: 'https://example.com' }],
  }));
  assert.equal(card.type, 'flex');
  const b = card.contents;
  assert.equal(b.header.backgroundColor, '#FFFFFF');
  assert.deepEqual(b.header.contents.map(c => c.text), ['小字', '標題', '副標']);
  assert.equal(b.header.contents[1].color, '#111827');
  assert.equal(b.body.backgroundColor, '#FFFFFF');
  assert.deepEqual(b.footer.contents.filter(c => c.type === 'button').map(c => [c.style, c.action.type]), [['primary', 'message'], ['link', 'uri']]);
  const last = b.footer.contents[b.footer.contents.length - 1];
  assert.deepEqual([last.type, last.text, last.action.text], ['text', '回選單 ›', '選單'], '最下面有回選單');
  assert.equal(b.footer.contents[0].color, '#16A34A');
  assert.equal(card.altText, '標題（副標）\n★ A：1\n　說明\n・B：2\n\n提示\n\n注意\n\n（來源）');
});

test('card_：提醒用琥珀色，不用重點的綠色', () => {
  const env = loadBot(FILES);
  const body = plain(env.call('card_', { title: 't', notes: ['提示'], warns: ['注意'] })).contents.body.contents;
  assert.equal(body[0].contents[0].color, '#111827');
  assert.equal(body[1].contents[0].color, '#B45309');
});

test('card_：沒有內容時也不會產生 LINE 不接受的空卡片；純文字版最多 400 字', () => {
  const env = loadBot(FILES);
  const empty = plain(env.call('card_', { title: '只有標題', notes: [''], buttons: [], menu: false }));
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
  assert.deepEqual(rows.map(r => r.contents[0].contents[0].text), ['紅30', '255', '304重慶', '557', '🚕 計程車共乘'], '公車下面接著其他方法（這裡沒有 YouBike 資料）');
  assert.equal(rows[0].contents[0].contents[0].color, '#16A34A', '最快的那一列用重點色（綠）');
  assert.equal(rows[1].contents[0].contents[0].color, '#111827');
  assert.match(rows[0].contents[0].contents[1].text, /^即將進站・\d\d:\d\d 到$/);
  assert.equal(rows[0].contents[1].text, '錢穆故居站下車，走 5 分鐘');
  assert.equal(rows[3].contents[1].text, '直接進校園，走 2 分鐘');
  assert.match(card.altText, /目前只要搭乘 紅30，便能最快速地抵達錢穆故居站，再步行進校。/);
  assert.equal(card.contents.header.contents[1].text, '士林站 → B 棟');
});

test('即時比較：沒有車的時候說明原因，並給共乘的按鈕', () => {
  const card = sampleCards().即時比較沒車;
  assert.match(card.altText, /沒有車往東吳的即時資料/);
  assert.equal(card.contents.footer.contents[0].action.text, '共乘');
});

test('出門建議：平日早八的 557 用監測預測倒推（尖峰算排隊）；劍南路出發會列學校專車', () => {
  const cards = sampleCards();
  assert.match(cards.出門建議.altText, /★ 搭 557 進校園：07:30 前到士林站\n　出站走 5 分鐘到士林國中站牌，預計 07:54–08:00 到東吳（尖峰，已把排隊、等下一台算進去），走 5 分鐘到教室/);
  assert.doesNotMatch(cards.出門建議.altText, /搭其他車/, '其他公車沒有監測資料，不列');
  assert.equal(cards.出門建議.contents.header.contents[1].text, '明天 08:10 上課');
  assert.equal(cards.出門建議.contents.footer.contents[0].action.uri, 'https://line.me/R/nv/location/', '用我的位置算幾點出門是主要按鈕');
  assert.equal(cards.出門建議.contents.footer.contents[3].action.text, '共乘 去學校 預約');
  assert.match(cards.出門建議劍南路.altText, /・學校專車：07:50 發車/);
});

test('天氣：60% 以上用提醒的顏色，並把降雨機率標出來', () => {
  const cards = sampleCards();
  const rainy = cards.天氣會下雨.contents.body.contents;
  assert.equal(rainy[0].contents[0].contents[1].text, '80%');
  assert.equal(rainy[1].contents[0].color, '#B45309');
  const fine = cards.天氣不會下雨.contents.body.contents;
  assert.equal(fine[1].contents[0].color, '#111827');
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
  assert.equal('quickReply' in replies[1].body.messages[0], false, '備用的純文字也不放輸入框上面那排按鈕');
});

test('訊息紀錄裡存的是卡片的純文字版', () => {
  const env = loadBot(FILES);
  env.call('handleEvent_', { type: 'follow', replyToken: 'r', source: { userId: 'A' } });
  const row = env.sheets['訊息紀錄'].rows[1];
  assert.equal(row[2], '（加入好友）');
  assert.equal(row[3].split('\n')[0], '嗨！我是東吳通勤達人 🚌');
  assert.ok(row[3].endsWith('今天要怎麼去學校？\n\n查出門時間、找其他交通方式，或看看怎麼避開 557 尖峰人潮。👇\n［🔔 出門前提醒］［🔀 557 以外的選擇］［🚏 公車站牌與排隊禮儀］［🏅 積分與打卡］'), row[3]);
});
