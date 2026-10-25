// 選單和「用點的」流程（bot/選單.gs）：每個功能都要有按鈕，按鈕在訊息裡，而且按了 Bot 要認得。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');
const { plain, saidOf, buttonsOf, hasQuickReply } = require('./helpers');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));
const MON_0700 = '2026-10-12T07:00:00+08:00';
const CATEGORIES = ['出門前提醒', '557 以外的選擇', '公車站牌與排隊', '積分與打卡'];

/** 會連網路的回覆換成固定的字，測試只看「有沒有走到對的功能」 */
function start() {
  const env = loadBot(ALL);
  env.setNow(MON_0700);
  env.run("busReply_ = (dir) => '[557 ' + (dir === 0 ? '去學校' : '回家') + ']'; bus557Reply_ = () => '[557 即時動態]';"
    + "liveReply_ = (origin, building) => '[即時 ' + origin + ' ' + building + ']';"
    + "rainReply_ = () => '[天氣]'; ybReply_ = () => '[YouBike]'; rainPop_ = () => 20; parseWithGemini_ = () => null;");
  return env;
}

/** 傳一句話給 Bot，回傳它回的訊息 */
function send(env, text, uid = 'A') {
  env.call('handleEvent_', { type: 'message', replyToken: 'r', source: { userId: uid }, message: { type: 'text', text } });
  return env.fetches.filter(f => f.url.endsWith('/message/reply')).pop().body.messages;
}
const isUnknown = messages => typeof messages[0].text === 'string' && messages[0].text.startsWith('這個問題我看不太懂');
const titleOf = message => message.contents.header.contents[message.contents.header.contents.length - 1].text;

test('選單：一則訊息，四個分類的按鈕', () => {
  const env = start();
  const menu = send(env, '選單');
  assert.equal(menu.length, 1);
  assert.equal(menu[0].type, 'flex');
  assert.deepEqual(buttonsOf(menu[0]), CATEGORIES.map(c => [c, c]));
  assert.equal(saidOf(menu[0]), '東吳通勤達人\n今天要怎麼去學校？\n\n查出門時間、找其他交通方式，或看看怎麼避開 557 尖峰人潮。👇');
});

test('按分類，Bot 把那一類的功能按鈕傳到聊天室', () => {
  const env = start();
  const out = send(env, '出門前提醒')[0];
  assert.equal(titleOf(out), '出門前提醒');
  assert.deepEqual(buttonsOf(out), [
    ['比較所有公車路線', '比較所有公車路線'], ['出門時間建議', '出門時間'], ['557 即時動態', '557 即時動態'],
    ['降雨查詢', '降雨查詢'], ['雨天與考試週訂閱提醒', '訂閱提醒設定'],
  ]);
  assert.deepEqual(buttonsOf(send(env, '557 以外的選擇')[0]).map(b => b[1]), ['共乘', 'YouBike', '共享雨傘', '包車']);
  assert.deepEqual(buttonsOf(send(env, '公車站牌與排隊')[0]).map(b => b[1]), ['557 站牌資訊', '排隊禮儀']);
  assert.deepEqual(buttonsOf(send(env, '積分與打卡')[0]), [
    ['到校打卡（早到、步行）', '打卡'], ['騎車到校', '騎車到校'], ['我的紀錄', '我的紀錄'], ['兌換學餐折價券', '兌換折價券'], ['全校減碳', '全校減碳'],
  ]);
});

test('每個功能的入口都在某個分類裡', () => {
  const env = start();
  const all = CATEGORIES.flatMap(c => buttonsOf(send(env, c)[0]).map(b => b[1]));
  ['比較所有公車路線', '出門時間', '557 即時動態', '557 站牌資訊', '降雨查詢', '訂閱提醒設定',
    '共乘', 'YouBike', '共享雨傘', '包車', '排隊禮儀', '打卡', '我的紀錄', '兌換折價券', '全校減碳', '騎車到校']
    .forEach(command => assert.ok(all.includes(command), '沒有「' + command + '」的按鈕'));
});

test('分類裡每一顆按鈕傳出去的字，Bot 都認得', () => {
  const env = start();
  CATEGORIES.forEach(category => {
    buttonsOf(send(env, category)[0]).forEach(([label, text]) => {
      assert.equal(isUnknown(send(env, text)), false, '「' + category + '」的「' + label + '」傳出「' + text + '」，Bot 看不懂');
    });
  });
});

test('走過兩層：功能回覆裡的按鈕（選方向、借傘、測驗…）Bot 也都認得', () => {
  const env = start();
  env.call('建立雨傘清單');
  const seen = [];
  CATEGORIES.forEach(category => {
    buttonsOf(send(env, category)[0]).forEach(([, first]) => {
      send(env, first).filter(m => m.type === 'flex').forEach(message => {
        buttonsOf(message).filter(b => typeof b[1] === 'string' && !b[1].startsWith('http')).forEach(([label, text]) => {
          seen.push(text);
          assert.equal(isUnknown(send(env, text)), false, '「' + first + '」裡的「' + label + '」傳出「' + text + '」，Bot 看不懂');
        });
      });
    });
  });
  assert.ok(['共乘 去學校', '借傘', '訂閱提醒', '取消提醒', '出門時間 明天'].every(t => seen.includes(t)), seen.join('、'));
});

test('全部的回覆都不用輸入框上面那排按鈕（快速回覆）', () => {
  const env = start();
  env.call('建立雨傘清單');
  const texts = ['選單', '今天好累', '共乘', '共乘 去學校', '共乘 去學校 現在走', '共乘 去學校 加入', '共乘 回士林 預約', '我的共乘', '取消共乘',
    '出門時間', '出門時間 明天', '出門時間 明天 08:10', '出門時間 明天 08:10 D', '打卡', '我的紀錄', '全校減碳', '共享雨傘', '借傘', '借傘 校門口',
    '新生須知', '新生測驗', '答 1', '排隊禮儀', '包車', '訂閱提醒', '訂閱提醒設定', '定位測試', '557', '557 即時動態', '降雨查詢', '557 站牌資訊', '兌換折價券'].concat(CATEGORIES);
  texts.forEach(text => assert.equal(hasQuickReply(send(env, text)), false, '「' + text + '」的回覆用了快速回覆'));
});

test('每一則有按鈕的訊息最下面都有「回選單」；選單自己和測驗題目沒有', () => {
  const env = start();
  const hasMenuLink = message => JSON.stringify(message).includes('"text":"回選單 ›"');
  ['出門前提醒', '共乘', '出門時間', '打卡', '共享雨傘', '出門時間 明天 08:10 D'].forEach(text => {
    assert.equal(hasMenuLink(send(env, text)[0]), true, '「' + text + '」的回覆沒有回選單');
  });
  assert.equal(hasMenuLink(send(env, '選單')[0]), false);
  assert.equal(hasMenuLink(send(env, '新生測驗')[0]), false);
});

test('傳「選單」「功能」「說明」「menu」都會回選單', () => {
  const env = start();
  ['選單', '主選單', '功能', '全部功能', '使用說明', 'menu', 'Help'].forEach(text => {
    assert.deepEqual(buttonsOf(send(env, text)[0]).map(b => b[0]), CATEGORIES, text);
  });
});

test('看不懂的句子：先說看不懂，再給選單，不會讓人卡住', () => {
  const env = start();
  const reply = send(env, '今天好累');
  assert.equal(reply.length, 2);
  assert.match(reply[0].text, /^這個問題我看不太懂/);
  assert.deepEqual(buttonsOf(reply[1]).map(b => b[0]), CATEGORIES);
});

test('看不懂時教的兩種問法，Bot 真的看得懂', () => {
  const env = start();
  const examples = send(env, '今天好累')[0].text.split('\n').filter(l => l.startsWith('・')).map(l => l.slice(1));
  assert.deepEqual(examples, ['我明天 8 點在 D 棟上課', '我想找 557 以外的通勤方式']);
  examples.forEach(text => assert.equal(isUnknown(send(env, text)), false, '「' + text + '」Bot 看不懂'));
  assert.equal(titleOf(send(env, '我想找 557 以外的通勤方式')[0]), '557 以外的選擇');
  assert.equal(titleOf(send(env, '有沒有替代路線')[0]), '557 以外的選擇');
});

test('加好友：歡迎的話、新生須知、選單', () => {
  const env = start();
  env.call('handleEvent_', { type: 'follow', replyToken: 'r', source: { userId: 'A' } });
  const reply = env.fetches.filter(f => f.url.endsWith('/message/reply')).pop().body.messages;
  assert.equal(reply.length, 3);
  assert.match(reply[0].text, /^嗨！我是東吳通勤達人/);
  assert.match(saidOf(reply[1]), /新生須知：第一次搭 557/);
  assert.deepEqual(buttonsOf(reply[1]).map(b => b[1]), ['新生測驗', '557 站牌資訊', '排隊禮儀']);
  assert.deepEqual(buttonsOf(reply[2]).map(b => b[0]), CATEGORIES);
});

test('出門時間：點哪一天 → 點第幾節 → 點哪一棟，全程不用打字', () => {
  const env = start();
  const step1 = send(env, '出門時間')[0];
  assert.equal(saidOf(step1), '出門時間建議\n要排哪一天的出門時間？');
  assert.deepEqual(buttonsOf(step1), [['今天', '出門時間 今天'], ['明天', '出門時間 明天']]);

  const step2 = send(env, '出門時間 明天')[0];
  assert.equal(saidOf(step2), '出門時間建議\n明天第幾節上課？');
  assert.equal(buttonsOf(step2).length, 13);
  assert.deepEqual(buttonsOf(step2)[0], ['第 1 節 08:10', '出門時間 明天 08:10']);
  assert.deepEqual(buttonsOf(step2)[12], ['第 D 節 21:15', '出門時間 明天 21:15']);

  const step3 = send(env, '出門時間 明天 08:10')[0];
  assert.equal(saidOf(step3), '出門時間建議\n明天 08:10 上課，在哪一棟？');
  assert.equal(buttonsOf(step3).length, 13);
  assert.deepEqual(buttonsOf(step3).slice(0, 3), [['B 綜大', '出門時間 明天 08:10 B'], ['D 二教', '出門時間 明天 08:10 D'], ['R 一教', '出門時間 明天 08:10 R']]);
  assert.deepEqual(buttonsOf(step3)[12], ['不指定', '出門時間 明天 08:10 不指定']);

  const card = send(env, '出門時間 明天 08:10 D')[0];
  assert.equal(card.type, 'flex');
  assert.equal(card.contents.header.contents[1].text, '明天 08:10 上課');
  assert.equal(card.contents.header.contents[2].text, 'D 棟 第二教學研究大樓');
  assert.match(card.altText, /★ 搭 557 進校園：\d\d:\d\d 前到士林站/);
});

test('超過 4 顆的按鈕排成兩欄，單數的最後一列補一個空格', () => {
  const env = start();
  const body = plain(send(env, '出門時間 明天')[0]).contents.body.contents;
  const rows = body.filter(c => c.type === 'box' && c.layout === 'horizontal');
  assert.equal(rows.length, 7, '13 顆按鈕 = 7 列');
  assert.ok(rows.slice(0, 6).every(r => r.contents.length === 2 && r.contents.every(c => c.action)));
  assert.deepEqual(rows[6].contents.map(c => c.type), ['box', 'filler']);
});

test('出門建議的卡片：換出發站、換時間都有按鈕，按了會回對應的建議', () => {
  const env = start();
  const card = send(env, '出門時間 明天 08:10 D')[0];
  assert.deepEqual(buttonsOf(card), [
    ['預約共乘', '共乘 去學校 預約'],
    ['改從劍南路站出發', '出門時間 明天 08:10 D 劍南路站'],
    ['改從大直站出發', '出門時間 明天 08:10 D 大直站'],
    ['換一個時間', '出門時間'],
    ['比較所有公車路線', '比較所有公車路線'],
  ]);
  const jiannan = send(env, '出門時間 明天 08:10 D 劍南路站')[0];
  assert.match(jiannan.altText, /★ 捷運劍南路站：\d\d:\d\d 前到站/);
  assert.ok(buttonsOf(jiannan).some(b => b[1] === '出門時間 明天 08:10 D 士林站'), '可以換回士林站');

  const any = send(env, '出門時間 明天 09:10 不指定')[0];
  assert.equal(any.contents.header.contents.length, 2, '不指定大樓就沒有副標');
  assert.ok(buttonsOf(any).some(b => b[1] === '出門時間 明天 09:10 不指定 大直站'));
});

test('出門時間選今天：只列還沒開始的節次；快上課的走即時比較', () => {
  const env = start();
  // 用真的時鐘判斷，所以把 Date 換成固定時間：週一 09:30
  env.run("const __RealDate = Date; Date = class extends __RealDate { constructor(...a) { super(...(a.length ? a : [__RealDate.parse('2026-10-12T09:30:00+08:00')])); } static now() { return __RealDate.parse('2026-10-12T09:30:00+08:00'); } };");
  const periods = buttonsOf(send(env, '出門時間 今天')[0]);
  assert.deepEqual(periods[0], ['第 3 節 10:10', '出門時間 今天 10:10'], '第 1、2 節已經開始，不列');
  assert.equal(send(env, '出門時間 今天 10:10 B')[0].text, '[即時 士林站 B]', '90 分鐘內上課，看即時到站');
  assert.equal(send(env, '出門時間 今天 13:10 B')[0].type, 'flex', '還很久的給出門建議');
});

test('出門時間亂傳也不會壞：格式不對就從那一步重新問', () => {
  const env = start();
  assert.match(saidOf(send(env, '出門時間 後天')[0]), /要排哪一天的出門時間？$/);
  assert.match(saidOf(send(env, '出門時間 明天 八點')[0]), /明天第幾節上課？$/);
  assert.match(saidOf(send(env, '出門時間 明天 08:10 Z')[0]), /明天 08:10 上課，在哪一棟？$/);
  assert.equal(send(env, '出門時間 明天 08:10 D 火星')[0].contents.header.contents[1].text, '明天 08:10 上課', '沒看過的出發站當成士林站');
});

test('用按鈕排的出門時間也會記到比較器紀錄', () => {
  const env = start();
  send(env, '出門時間 明天 08:10 D 劍南路站');
  const row = env.sheets['比較器紀錄'].rows[1];
  assert.deepEqual(plain(row.slice(1)), ['出門時間 明天 08:10 D 劍南路站', '劍南路站', 'D', '08:10', '出門建議']);
});

test('推播（雨天提醒、站位變更）也是訊息裡的按鈕', () => {
  const env = start();
  env.call('subscribe_', 'A', true);
  env.run('rainPop_ = () => 80');
  const reminder = env.call('buildReminder_', new Date('2026-10-13T12:00:00+08:00')); // 週二，早上降雨機率 80%
  env.call('sendToSubscribers_', reminder, '晚上提醒');
  const pushed = env.pushes()[0].body.messages[0];
  assert.equal(pushed.type, 'flex');
  assert.equal(hasQuickReply([pushed]), false);
  assert.equal(pushed.contents.header.contents[0].text, '明天（10/13）上學提醒');
  assert.deepEqual(buttonsOf(pushed), [['排明天的出門時間', '出門時間 明天'], ['預約共乘', '共乘 去學校 預約'], ['不想收提醒', '取消提醒']]);
  assert.match(saidOf(pushed), /早上降雨機率 80%/);
});
