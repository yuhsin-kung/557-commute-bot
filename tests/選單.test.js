// 選單和「用點的」流程（bot/選單.gs）：每個功能都要有按鈕，按鈕在訊息裡，而且按了 Bot 要認得。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');
const { plain, saidOf, buttonsOf, hasQuickReply } = require('./helpers');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));
const MON_0700 = '2026-10-12T07:00:00+08:00';
const CATEGORIES = ['出門前提醒', '557 以外的選擇', '公車站牌與排隊禮儀', '積分與打卡']; // 跟簡報、圖文選單的四格一樣（傳出的字）
const LABELS = ['🔔 出門前提醒', '🔀 557 以外的選擇', '🚏 公車站牌與排隊禮儀', '🏅 積分與打卡']; // 按鈕上的字（有表情符號）
const MAIN = '預估到達時間'; // 主要功能：出門前提醒的第一顆，按了直接是入口卡片

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
const isUnknown = messages => /這個問題我看不太懂/.test(messages[0].altText || messages[0].text || '');
// 標題：舊版卡片在標題列，設計稿版型（dsCard_）在內文第一個橫排
const titleOf = message => (message.contents.header ? message.contents.header.contents[message.contents.header.contents.length - 1].text
  : message.contents.body.contents.find(c => c.layout === 'horizontal').contents[0].text);

test('選單：一則訊息，四個分類的按鈕', () => {
  const env = start();
  const menu = send(env, '選單');
  assert.equal(menu.length, 1);
  assert.equal(menu[0].type, 'flex');
  assert.deepEqual(buttonsOf(menu[0]), CATEGORIES.map((c, i) => [LABELS[i], c]));
  assert.equal(saidOf(menu[0]), '東吳通勤達人\n今天要怎麼去學校？\n\n查出門時間、找其他交通方式，或看看怎麼避開 557 尖峰人潮。👇');
});

test('按分類，Bot 把那一類的功能按鈕傳到聊天室', () => {
  const env = start();
  const out = send(env, '出門前提醒')[0];
  assert.equal(titleOf(out), '出門前提醒');
  // 11/28 團隊設計稿（圖五～八）：左上「選單」、標題、灰字說明，按鈕傳出的字跟按鈕上的字一樣，第一顆磚紅
  assert.match(out.altText, /^選單\n出門前提醒\n想知道現在出發幾點到東吳？或是想提前規劃出門時間？也可以查詢 557 即時動態、其他公車路線及天氣資訊。/);
  assert.deepEqual(buttonsOf(out), [
    ['📍 預估到達時間', '預估到達時間'], ['⏰ 出發時間規劃', '出發時間規劃'], ['🚌 557 即時動態', '557 即時動態'], ['🗺️ 比較所有路線', '比較所有路線'],
    ['🌧️ 降雨查詢', '降雨查詢'], ['🔔 雨天與考試週提醒', '雨天與考試週提醒'],
  ]);
  assert.equal(out.contents.footer.contents[0].backgroundColor, '#A63A2B');
  assert.equal(out.contents.footer.contents[1].backgroundColor, '#EEF2F7');
  assert.deepEqual(buttonsOf(send(env, '公車站牌與排隊禮儀')[0]), [
    ['💬 回報我在哪裡排隊', '回報我在哪裡排隊'], ['📍 557 上車地點', '557 上車地點'], ['🎬 排隊禮儀短片', '排隊禮儀短片'], ['🎒 新生須知', '新生須知'],
  ]);
  const main = send(env, MAIN)[0];
  assert.match(main.altText, /預估到達時間/);
  assert.match(send(env, '幾點出門、幾點到東吳')[0].altText, /預估到達時間/, '舊名稱也認得');
  assert.deepEqual(buttonsOf(main).map(b => b[1]), ['https://line.me/R/nv/location/', '選擇捷運站', '我已經在士林站', '出發時間規劃']);
  assert.match(send(env, '出發時間規劃')[0].altText, /哪一天要去學校/, '打「出發時間規劃」是趕課倒推');
  assert.match(send(env, '幾點出門')[0].altText, /哪一天要去學校/, '舊名稱「幾點出門」也一樣，不是預估到達時間');
  // 11/28 團隊要求：按鈕傳出的字跟按鈕上的字一樣（去掉表情符號）
  assert.deepEqual(buttonsOf(send(env, '557 以外的選擇')[0]), [['🚕 計程車共乘', '計程車共乘'], ['🚲 YouBike 查詢', 'YouBike 查詢'], ['☂️ 共享雨傘', '共享雨傘'], ['🚐 包車調查', '包車調查']]);
  ['共乘', 'YouBike', '包車'].forEach(old => assert.equal(isUnknown(send(env, old)), false, '舊的「' + old + '」也認得'));
  assert.deepEqual(buttonsOf(send(env, '積分與打卡')[0]), [
    ['🏫 到校打卡', '到校打卡'], ['🏠 出校打卡', '出校打卡'], ['📒 我的紀錄', '我的紀錄'], ['🎟️ 兌換學餐折價券', '兌換學餐折價券'], ['🎫 我的折價券', '我的折價券'], ['🌱 全校減碳', '全校減碳'],
  ]);
});

test('公車站牌與排隊禮儀：舊名稱「公車站牌與排隊」也認得；上車地點、排隊禮儀分開傳也認得', () => {
  const env = start();
  assert.deepEqual(buttonsOf(send(env, '公車站牌與排隊')[0]).map(b => b[1]), ['回報我在哪裡排隊', '557 上車地點', '排隊禮儀短片', '新生須知']);
  ['557 站牌資訊', '557 上車地點'].forEach(t => assert.match(send(env, t)[0].altText, /上車/, t));
  ['排隊禮儀', '排隊禮儀短片'].forEach(t => assert.equal(send(env, t)[0].altText, '排隊禮儀短片：一起排好，大家都快', t));
  assert.match(send(env, '回報我在哪裡排隊')[0].altText, /排隊/);
  assert.match(send(env, '雨天與考試週提醒')[0].altText, /提醒條件/);
});

test('每個功能的入口都在某個分類裡', () => {
  const env = start();
  const all = CATEGORIES.flatMap(c => buttonsOf(send(env, c)[0]).map(b => b[1]));
  ['預估到達時間', '出發時間規劃', '比較所有路線', '557 即時動態', '降雨查詢', '雨天與考試週提醒', '557 上車地點', '排隊禮儀短片', '回報我在哪裡排隊', '新生須知', // 出門時間、我已經在士林站在「預估到達時間」裡
    '計程車共乘', 'YouBike 查詢', '共享雨傘', '包車調查', '到校打卡', '出校打卡', '我的紀錄', '兌換學餐折價券', '我的折價券', '全校減碳'] // 騎車到校在「到校打卡」裡（積分.test.js）
    .forEach(command => assert.ok(all.includes(command), '沒有「' + command + '」的按鈕'));
});

test('分類裡每一顆按鈕傳出去的字，Bot 都認得', () => {
  const env = start();
  CATEGORIES.forEach(category => {
    buttonsOf(send(env, category)[0]).filter(b => !b[1].startsWith('http')).forEach(([label, text]) => {
      assert.equal(isUnknown(send(env, text)), false, '「' + category + '」的「' + label + '」傳出「' + text + '」，Bot 看不懂');
    });
  });
});

test('走過兩層：功能回覆裡的按鈕（選方向、測驗…）Bot 也都認得', () => {
  const env = start();
  const seen = [];
  CATEGORIES.forEach(category => {
    buttonsOf(send(env, category)[0]).filter(b => !b[1].startsWith('http')).forEach(([, first]) => {
      send(env, first).filter(m => m.type === 'flex').forEach(message => {
        buttonsOf(message).filter(b => typeof b[1] === 'string' && !b[1].startsWith('http')).forEach(([label, text]) => {
          seen.push(text);
          assert.equal(isUnknown(send(env, text)), false, '「' + first + '」裡的「' + label + '」傳出「' + text + '」，Bot 看不懂');
        });
      });
    });
  });
  assert.ok(['士林站 → 東吳', '查看我的共乘', '開啟提醒', '關閉提醒', '出門時間 明天', '出門時間 明天 08:10', '選擇捷運站', '我已經在士林站', '回報現場 士林站'].every(t => seen.includes(t)), seen.join('、'));
});

test('全部的回覆都不用輸入框上面那排按鈕（快速回覆）', () => {
  const env = start();
  const texts = ['選單', '今天好累', '共乘', '共乘 去學校', '共乘 去學校 現在走', '共乘 去學校 加入', '共乘 回士林 預約', '我的共乘', '取消共乘',
    '出門時間', '出門時間 明天', '出門時間 明天 08:10', '出門時間 明天 08:10 D', '打卡', '我的紀錄', '全校減碳', '共享雨傘', '借傘', '出門提醒 明天 07:40', '取消出門提醒',
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
    assert.deepEqual(buttonsOf(send(env, text)[0]).map(b => b[0]), LABELS, text);
  });
});

test('看不懂的句子：一張卡片先說看不懂，下面直接是四個分類，不會讓人卡住', () => {
  const env = start();
  const reply = send(env, '今天好累');
  assert.equal(reply.length, 1);
  assert.equal(reply[0].type, 'flex', '不送純文字');
  assert.match(reply[0].altText, /這個問題我看不太懂/);
  assert.deepEqual(buttonsOf(reply[0]).map(b => b[0]), LABELS);
});

test('看不懂時教的兩種問法，Bot 真的看得懂', () => {
  const env = start();
  const examples = send(env, '今天好累')[0].altText.split('\n').filter(l => l.startsWith('・')).map(l => l.slice(1));
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
  assert.equal(reply[0].type, 'flex', '歡迎的話也是卡片');
  assert.match(reply[0].altText, /^嗨！我是東吳通勤達人/);
  assert.match(saidOf(reply[1]), /新生須知：第一次搭 557/);
  assert.deepEqual(buttonsOf(reply[1]).map(b => b[1]), ['新生測驗', '公車站牌與排隊禮儀']);
  assert.deepEqual(buttonsOf(reply[2]).map(b => b[0]), LABELS);
});

test('出發時間規劃（11/28 團隊設計稿）：一張卡片選哪一天、最早第幾節（第 1～C 節兩欄），按了節次直接出建議，不再問大樓', () => {
  const env = start();
  const card = send(env, '出門時間 明天')[0];
  assert.match(saidOf(card), /^出門前提醒\n⏰ 出發時間規劃\n/);
  const json = JSON.stringify(plain(card.contents.body));
  assert.match(json, /你哪一天要去學校？[\s\S]*你最早第幾節有課？[\s\S]*請選擇當天最早需要到校的節次。[\s\S]*ⓘ 小提醒[\s\S]*選擇當天最早的上課節次，系統將依照課程時間，幫你估算建議出門時間及預計抵達時間。/);
  const b = buttonsOf(card);
  assert.deepEqual(b.slice(0, 2), [['今天', '出門時間 今天'], ['明天', '出門時間 明天']]);
  assert.equal(b.length, 2 + 12, '第 1～C 節，第 D 節拿掉了');
  assert.deepEqual(b[2], ['第 1 節 08:10', '出門時間 明天 08:10']);
  assert.deepEqual(b[13], ['第 C 節 20:20', '出門時間 明天 20:20']);
  assert.ok(!b.some(x => /第 D 節/.test(x[0])));
  // 選的那天是磚紅，節次兩欄
  const chips = [];
  require('./helpers').walk(plain(card).contents, n => { if (n.action) chips.push(n); });
  assert.equal(chips.find(c => c.action.text === '出門時間 明天').backgroundColor, '#A63A2B');
  assert.equal(chips.find(c => c.action.text === '出門時間 今天').backgroundColor, '#EEF2F7');
  const rows = plain(card).contents.body.contents.filter(c => c.type === 'box' && c.contents.every(r => r.layout === 'horizontal'));
  assert.ok(rows.length >= 2 && rows.every(r => r.contents.every(row => row.contents.length === 2)), '兩欄');
  assert.equal(card.contents.footer.contents.length, 1, '下面只有回選單');

  const plan = send(env, '出門時間 明天 08:10')[0];
  assert.equal(plan.type, 'flex');
  assert.equal(plan.contents.header.contents[1].text, '明天 08:10 上課', '按了節次直接出建議');
  assert.match(plan.altText, /★ 搭 557 進校園：(\d\d:\d\d 前到士林站|還沒有預測)/, '平常日有預測就倒推，週末說還沒有（看測試跑的那天）');

  const old = send(env, '出門時間 明天 08:10 D')[0];
  assert.equal(old.contents.header.contents[2].text, 'D 棟 第二教學研究大樓', '舊按鈕帶大樓也還認得');
});

test('超過 6 顆的按鈕排成兩欄，單數的最後一顆自己一列、整列寬', () => {
  const env = start();
  const items = Array.from({ length: 13 }, (_, i) => ['按鈕 ' + i, '選單']);
  const body = plain(env.call('choices_', '選一個', items)).contents.body.contents;
  const rows = body.filter(c => c.type === 'box' && c.layout === 'horizontal');
  assert.equal(rows.length, 6, '13 顆按鈕 = 6 列兩欄 + 最後一顆');
  assert.ok(rows.every(r => r.contents.length === 2 && r.contents.every(c => c.action)));
  const last = body[body.indexOf(rows[5]) + 1];
  assert.equal(last.layout, 'vertical');
  assert.ok(last.action, '最後一顆是按鈕本身，不是跟空格排在一起');
  assert.ok(!JSON.stringify(body).includes('"filler"'));
});

test('出門建議的卡片：用我的位置算是主要按鈕；換出發站先選站；共乘寫明是計程車；週日沒有 557 預測就不給發車提醒', () => {
  const env = start();
  // 固定在週六中午，明天是週日：557 預測只有平常日，所以說「還沒有預測」、不給發車提醒（不再退回估計車程）
  env.run("const __RealDate = Date; Date = class extends __RealDate { constructor(...a) { super(...(a.length ? a : [__RealDate.parse('2026-10-17T12:00:00+08:00')])); } static now() { return __RealDate.parse('2026-10-17T12:00:00+08:00'); } };");
  const card = send(env, '出門時間 明天 08:10 D')[0];
  assert.deepEqual(buttonsOf(card), [
    ['用我的位置算幾點出門', 'https://line.me/R/nv/location/'],
    ['換一個時間', '出門時間'],
    ['改從其他捷運站出發', '出門時間 明天 08:10 D 選出發站'],
    ['預約計程車共乘', '共乘 去學校 預約'],
  ]);
  assert.match(card.altText, /還沒有預測/);
  assert.match(card.altText, /步行：校園大樓表（估計）/);
  assert.doesNotMatch(card.altText, /實測/);
  assert.equal(card.contents.footer.contents[0].style, 'primary', '用我的位置算幾點出門是紅色主按鈕');
  const pick = send(env, '出門時間 明天 08:10 D 選出發站')[0];
  assert.deepEqual(buttonsOf(pick).map(b => b[1]), ['出門時間 明天 08:10 D 士林站', '出門時間 明天 08:10 D 劍南路站', '出門時間 明天 08:10 D 大直站']);
  const jiannan = send(env, '出門時間 明天 08:10 D 劍南路站')[0];
  assert.match(jiannan.altText, /★ 捷運劍南路站：\d\d:\d\d 前到站/);
  assert.ok(buttonsOf(jiannan).some(b => b[1] === '出門時間 明天 08:10 D 選出發站'), '可以再換站');

  const any = send(env, '出門時間 明天 09:10 不指定')[0];
  assert.equal(any.contents.header.contents.length, 2, '不指定大樓就沒有副標');
  assert.ok(buttonsOf(any).some(b => b[1] === '出門時間 明天 09:10 不指定 選出發站'));
});

test('出門時間選今天：第 1～C 節一直都列（不看現在幾點拿掉）；快上課的走即時比較', () => {
  const env = start();
  // 用真的時鐘判斷，所以把 Date 換成固定時間：週一 09:30
  env.run("const __RealDate = Date; Date = class extends __RealDate { constructor(...a) { super(...(a.length ? a : [__RealDate.parse('2026-10-12T09:30:00+08:00')])); } static now() { return __RealDate.parse('2026-10-12T09:30:00+08:00'); } };");
  const periods = buttonsOf(send(env, '出門時間 今天')[0]).slice(2); // 前兩顆是今天、明天
  assert.equal(periods.length, 12, '11/28 團隊決定：已經開始的節次也列');
  assert.deepEqual(periods[0], ['第 1 節 08:10', '出門時間 今天 08:10']);
  assert.deepEqual(buttonsOf(send(env, '出門時間')[0])[2], ['第 1 節 08:10', '出門時間 今天 08:10'], '沒選哪一天就先選今天');
  assert.equal(send(env, '出門時間 今天 10:10 B')[0].altText, '[即時 士林站 B]', '90 分鐘內上課，看即時到站');
  assert.equal(send(env, '出門時間 今天 13:10 B')[0].type, 'flex', '還很久的給出門建議');
});

test('出門時間亂傳也不會壞：格式不對就從那一步重新問', () => {
  const env = start();
  assert.match(saidOf(send(env, '出門時間 後天')[0]), /哪一天要去學校？/);
  assert.match(saidOf(send(env, '出門時間 明天 八點')[0]), /你最早第幾節有課？/);
  assert.equal(send(env, '出門時間 明天 08:10 Z')[0].contents.header.contents[1].text, '明天 08:10 上課', '沒看過的大樓代號就不指定大樓');
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
  assert.deepEqual(buttonsOf(pushed), [['排明天的出門時間', '出門時間 明天'], ['預約計程車共乘', '共乘 去學校 預約'], ['不想收提醒', '取消提醒']]);
  assert.match(saidOf(pushed), /早上降雨機率 80%/);
});

test('所有回覆都是卡片，不送單純的文字訊息（11/28 團隊要求）', () => {
  const env = start();
  ['選單', '今天好累', '訂閱提醒', '取消提醒', '取消出門提醒', '我的共乘', '取消共乘', '我的折價券', '新生測驗', '答 1', '測試時間', '測試時間 結束',
    '出門時間', '出門時間 明天', '預估到達時間', '到校預估 士林站', '回報現場 士林站', '騎車到校'].concat(CATEGORIES).forEach(text => {
    send(env, text).forEach(m => assert.equal(m.type, 'flex', '「' + text + '」回了 ' + m.type));
  });
});
