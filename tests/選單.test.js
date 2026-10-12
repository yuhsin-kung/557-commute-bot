// 主選單和「用點的」流程（bot/選單.gs）：每個功能都要有按鈕，而且按了 Bot 要認得。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));
const plain = x => JSON.parse(JSON.stringify(x));
const MON_0700 = '2026-10-12T07:00:00+08:00';

/** 會連網路的回覆換成固定的字，測試只看「有沒有走到對的功能」 */
function start() {
  const env = loadBot(ALL);
  env.setNow(MON_0700);
  env.run("busReply_ = (dir) => '[557 ' + (dir === 0 ? '去學校' : '回家') + ']';"
    + "liveReply_ = (origin, building) => '[即時 ' + origin + ' ' + building + ']';"
    + "rainReply_ = () => '[天氣]'; ybReply_ = () => '[YouBike]'; rainPop_ = () => 20; parseWithGemini_ = () => null;");
  return env;
}

/** 傳一句話給 Bot，回傳它回的訊息 */
function send(env, text, uid = 'A') {
  env.call('handleEvent_', { type: 'message', replyToken: 'r', source: { userId: uid }, message: { type: 'text', text } });
  return env.fetches.filter(f => f.url.endsWith('/message/reply')).pop().body.messages;
}
const isUnknown = messages => typeof messages[0].text === 'string' && messages[0].text.startsWith('我看不懂這句話');
const quick = message => message.quickReply.items.map(i => [i.action.label, i.action.text]);
const menuButtons = env => plain(env.call('menuCard_')).contents.contents
  .flatMap(bubble => bubble.footer.contents.map(b => [b.action.label, b.action.text]));

test('主選單：四張卡片，每個功能一顆按鈕', () => {
  const env = start();
  const menu = plain(env.call('menuCard_'));
  assert.equal(menu.contents.type, 'carousel');
  assert.deepEqual(menu.contents.contents.map(b => b.header.contents[1].text), ['怎麼去學校', '換個方式到校', '我的通勤紀錄', '天氣、提醒、新生教學']);
  assert.ok(menu.contents.contents.every(b => b.size === 'kilo'));
  const sent = menuButtons(env).map(b => b[1]);
  // 每個功能的入口都要在選單裡
  ['幫我比較路線', '出門時間', '557 去學校', '557 回家', '557 在哪裡搭', '共乘', 'YouBike', '共享雨傘', '包車',
    '打卡', '我的紀錄', '全校減碳', '騎車到校', '明天會下雨嗎', '訂閱提醒', '取消提醒', '新生教學', '排隊禮儀']
    .forEach(command => assert.ok(sent.includes(command), '選單裡沒有「' + command + '」的按鈕'));
  assert.match(menu.altText, /^全部功能（往左滑還有更多）\n【怎麼去學校】現在最快的車、排出門時間、557 到站、557 回家、557 在哪裡搭/);
});

test('選單上每一顆按鈕傳出去的字，Bot 都認得', () => {
  const env = start();
  menuButtons(env).forEach(([label, text]) => {
    const reply = send(env, text);
    assert.equal(isUnknown(reply), false, '按「' + label + '」傳出「' + text + '」，Bot 看不懂');
  });
});

test('每則回覆下面的預設按鈕，Bot 也都認得；第一顆是選單', () => {
  const env = start();
  const items = quick(send(env, '全校減碳')[0]);
  assert.equal(items[0][0], '選單');
  items.forEach(([label, text]) => assert.equal(isUnknown(send(env, text)), false, '預設按鈕「' + label + '」Bot 看不懂'));
});

test('傳「選單」「功能」「說明」「menu」都會回主選單', () => {
  const env = start();
  ['選單', '主選單', '功能', '全部功能', '使用說明', 'menu', 'Help'].forEach(text => {
    const reply = send(env, text);
    assert.equal(reply[0].contents.type, 'carousel', text);
  });
});

test('看不懂的句子：先說看不懂，再給主選單，不會讓人卡住', () => {
  const env = start();
  const reply = send(env, '今天好累');
  assert.equal(reply.length, 2);
  assert.match(reply[0].text, /^我看不懂這句話/);
  assert.equal(reply[1].contents.type, 'carousel');
  assert.equal(reply[1].quickReply.items[0].action.text, '選單');
});

test('加好友：歡迎的話加主選單', () => {
  const env = start();
  env.call('handleEvent_', { type: 'follow', replyToken: 'r', source: { userId: 'A' } });
  const reply = env.fetches.filter(f => f.url.endsWith('/message/reply')).pop().body.messages;
  assert.match(reply[0].text, /^嗨！我是東吳通勤達人/);
  assert.equal(reply[1].contents.type, 'carousel');
});

test('出門時間：點哪一天 → 點第幾節 → 點哪一棟，全程不用打字', () => {
  const env = start();
  const step1 = send(env, '出門時間')[0];
  assert.equal(step1.text, '要排哪一天的出門時間？');
  assert.deepEqual(quick(step1), [['今天', '出門時間 今天'], ['明天', '出門時間 明天']]);

  const step2 = send(env, '出門時間 明天')[0];
  assert.equal(step2.text, '明天第幾節上課？');
  assert.equal(quick(step2).length, 13);
  assert.deepEqual(quick(step2)[0], ['第 1 節 08:10', '出門時間 明天 08:10']);
  assert.deepEqual(quick(step2)[12], ['第 D 節 21:15', '出門時間 明天 21:15']);

  const step3 = send(env, '出門時間 明天 08:10')[0];
  assert.equal(step3.text, '明天 08:10 上課，在哪一棟？');
  assert.equal(quick(step3).length, 13, '快速回覆最多 13 顆');
  assert.deepEqual(quick(step3).slice(0, 3), [['B 綜大', '出門時間 明天 08:10 B'], ['D 二教', '出門時間 明天 08:10 D'], ['R 一教', '出門時間 明天 08:10 R']]);
  assert.deepEqual(quick(step3)[12], ['不指定', '出門時間 明天 08:10 不指定']);
  assert.ok(quick(step3).every(([label]) => label.length <= 20));

  const card = send(env, '出門時間 明天 08:10 D')[0];
  assert.equal(card.type, 'flex');
  assert.equal(card.contents.header.contents[1].text, '明天 08:10 上課');
  assert.equal(card.contents.header.contents[2].text, 'D 棟 第二教學研究大樓');
  assert.match(card.altText, /★ 搭 557 進校園：\d\d:\d\d 前到士林站/);
});

test('出門建議的卡片：換出發站、換時間都有按鈕，按了會回對應的建議', () => {
  const env = start();
  const card = send(env, '出門時間 明天 08:10 D')[0];
  const buttons = card.contents.footer.contents.map(b => [b.action.label, b.action.text]);
  assert.deepEqual(buttons, [
    ['預約共乘', '共乘 去學校 預約'],
    ['改從劍南路站出發', '出門時間 明天 08:10 D 劍南路站'],
    ['改從大直站出發', '出門時間 明天 08:10 D 大直站'],
    ['換一個時間', '出門時間'],
    ['現在最快的車', '幫我比較路線'],
  ]);
  const jiannan = send(env, '出門時間 明天 08:10 D 劍南路站')[0];
  assert.match(jiannan.altText, /★ 捷運劍南路站：\d\d:\d\d 前到站/);
  assert.ok(jiannan.contents.footer.contents.some(b => b.action.text === '出門時間 明天 08:10 D 士林站'), '可以換回士林站');

  const any = send(env, '出門時間 明天 09:10 不指定')[0];
  assert.equal(any.contents.header.contents.length, 2, '不指定大樓就沒有副標');
  assert.ok(any.contents.footer.contents.some(b => b.action.text === '出門時間 明天 09:10 不指定 大直站'));
});

test('出門時間選今天：只列還沒開始的節次；快上課的走即時比較', () => {
  const env = start();
  // 用真的時鐘判斷，所以把 Date 換成固定時間：週一 09:30
  env.run("const __RealDate = Date; Date = class extends __RealDate { constructor(...a) { super(...(a.length ? a : [__RealDate.parse('2026-10-12T09:30:00+08:00')])); } static now() { return __RealDate.parse('2026-10-12T09:30:00+08:00'); } };");
  const periods = quick(send(env, '出門時間 今天')[0]);
  assert.deepEqual(periods[0], ['第 3 節 10:10', '出門時間 今天 10:10'], '第 1、2 節已經開始，不列');
  assert.equal(send(env, '出門時間 今天 10:10 B')[0].text, '[即時 士林站 B]', '90 分鐘內上課，看即時到站');
  assert.equal(send(env, '出門時間 今天 13:10 B')[0].type, 'flex', '還很久的給出門建議');
});

test('出門時間亂傳也不會壞：格式不對就從那一步重新問', () => {
  const env = start();
  assert.equal(send(env, '出門時間 後天')[0].text, '要排哪一天的出門時間？');
  assert.equal(send(env, '出門時間 明天 八點')[0].text, '明天第幾節上課？');
  assert.equal(send(env, '出門時間 明天 08:10 Z')[0].text, '明天 08:10 上課，在哪一棟？');
  assert.equal(send(env, '出門時間 明天 08:10 D 火星')[0].contents.header.contents[1].text, '明天 08:10 上課', '沒看過的出發站當成士林站');
});

test('用按鈕排的出門時間也會記到比較器紀錄', () => {
  const env = start();
  send(env, '出門時間 明天 08:10 D 劍南路站');
  const row = env.sheets['比較器紀錄'].rows[1];
  assert.deepEqual(plain(row.slice(1)), ['出門時間 明天 08:10 D 劍南路站', '劍南路站', 'D', '08:10', '出門建議']);
});
