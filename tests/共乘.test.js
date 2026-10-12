// 計程車共乘（bot/共乘.gs）的規則測試。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBot } = require('./gas-env');
const { textOf, saidOf, buttonsOf, hasQuickReply } = require('./helpers');

const FILES = ['Code.gs', '卡片.gs', '選單.gs', '共乘.gs', '等車室.gs'];
const MON_0730 = '2026-10-12T07:30:00+08:00'; // 週一早上

function start(now = MON_0730) {
  const env = loadBot(FILES);
  env.setNow(now);
  return env;
}

/** Bot 環境裡產生的物件和這裡的不是同一種，比對內容前先轉一次 */
const same = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const say = (env, uid, text) => env.call('cpText_', uid, text);
const group = (env, i = 0) => env.call('cpLoadGroups_')[i];
const user = (env, uid) => env.call('cpUser_', uid);
const token = (env, uid) => user(env, uid).token;
const room = (env, uid) => env.call('cpRoomState', token(env, uid));
const press = (env, uid, action) => env.call('cpRoomAction', token(env, uid), action);
const events = env => env.sheets['共乘紀錄'].rows.slice(1).map(r => r[5]);

test('車資平分，進位到 5 元', () => {
  const env = start();
  same([1, 2, 3, 4].map(n => env.call('cpShare_', n)), [160, 80, 55, 40]);
});

test('傳「共乘」先問方向，再問現在走或預約', () => {
  const env = start();
  const dirs = say(env, 'A', '共乘');
  same(buttonsOf(dirs).map(b => b[1]), ['共乘 去學校', '共乘 回士林', '我的共乘']);
  const modes = say(env, 'A', '共乘 去學校');
  same(buttonsOf(modes).map(b => b[1]), ['共乘 去學校 現在走', '共乘 去學校 預約']);
  assert.equal(hasQuickReply([dirs, modes]), false, '按鈕在訊息裡，不用輸入框上面那排');
});

test('現在走：開鈴 → 第二個人加入 → 5 分鐘到成團 → 叫車 → 上車', () => {
  const env = start();
  assert.match(textOf(say(env, 'A', '共乘 去學校 現在走')), /現在沒有人在等，你是第一個/);
  const opened = say(env, 'A', '共乘 去學校 加入');
  assert.match(textOf(opened), /已開鈴！你是第一個，也是團主/);
  assert.equal(buttonsOf(opened)[0][0], '打開等車室');
  assert.match(buttonsOf(opened)[0][1], /\?page=room&t=[0-9a-f-]{36}$/);

  env.addMinutes(2);
  const status = textOf(say(env, 'B', '共乘 去學校 現在走'));
  assert.match(status, /現在有 1 個人在等，還剩 3 分鐘/);
  assert.match(status, /你加入就 2 人，一人約 80 元（現在 160 元）/);
  assert.match(textOf(say(env, 'B', '共乘 去學校 加入')), /已加入，現在 2 人，一人約 80 元/);

  let view = room(env, 'A');
  assert.equal(view.status, '等待中');
  assert.equal(view.share, 80);
  assert.equal(view.isLeader, true);
  assert.equal(view.members.length, 2);

  env.addMinutes(3);
  assert.equal(room(env, 'B').status, '已成團');
  assert.equal(press(env, 'B', 'call').status, '已成團', '不是團主不能叫車');
  assert.equal(press(env, 'A', 'call').status, '已叫車');
  press(env, 'A', 'board');
  view = press(env, 'B', 'board');
  assert.equal(view.status, '已出發');
  same(events(env), ['加入', '加入', '叫車', '上車', '上車']);
});

test('現在走：滿 4 人不用等，馬上成團', () => {
  const env = start();
  ['A', 'B', 'C'].forEach(u => say(env, u, '共乘 回士林 加入'));
  assert.equal(group(env).status, '等待中');
  say(env, 'D', '共乘 回士林 加入');
  assert.equal(group(env).status, '已成團');
  assert.equal(room(env, 'D').share, 40);
  assert.match(textOf(say(env, 'E', '共乘 回士林 現在走')), /現在沒有人在等/, '第 5 個人要另外開一團');
});

test('兩個方向的人不會湊在一起', () => {
  const env = start();
  say(env, 'A', '共乘 去學校 加入');
  assert.match(textOf(say(env, 'B', '共乘 回士林 現在走')), /現在沒有人在等/);
});

test('等待中可以離開，不扣分；人走光那一團就取消', () => {
  const env = start();
  say(env, 'A', '共乘 去學校 加入');
  assert.equal(press(env, 'A', 'leave').none, true);
  assert.equal(group(env).status, '取消');
  assert.equal(user(env, 'A').credit, 100);
});

test('只有一個人也算成團，送 20 分，一天只送一次', () => {
  const env = start();
  say(env, 'A', '共乘 去學校 加入');
  env.addMinutes(5);
  let view = room(env, 'A');
  assert.equal(view.status, '獨行');
  assert.equal(view.reward, 20);
  assert.equal(user(env, 'A').points, 20);

  env.addMinutes(30);
  say(env, 'A', '共乘 去學校 加入');
  env.addMinutes(5);
  view = room(env, 'A');
  assert.equal(view.status, '獨行');
  assert.equal(view.reward, 0, '同一天第二次沒有獎勵');
  assert.equal(user(env, 'A').points, 20);

  env.addMinutes(24 * 60);
  say(env, 'A', '共乘 去學校 加入');
  env.addMinutes(5);
  assert.equal(room(env, 'A').reward, 20);
  assert.equal(user(env, 'A').points, 40, '隔天可以再領');
});

test('預約：有人加入會通知已經預約的人，金額跟著變', () => {
  const env = start();
  const first = textOf(say(env, 'A', '共乘 去學校 預約 2026-10-13 07:40'));
  assert.match(first, /明天 07:40 士林站 → 東吳/);
  assert.match(first, /這個時段還沒有人，你是第一個/);
  assert.match(textOf(say(env, 'A', '共乘 去學校 確認 2026-10-13 07:40')), /已預約 明天 07:40 士林站 → 東吳\n目前 1 人，一人約 160 元/);
  assert.equal(env.pushes().length, 0);

  assert.match(textOf(say(env, 'B', '共乘 去學校 預約 2026-10-13 07:40')), /這個時段目前 1 人。你加入後 2 人，一人約 80 元/);
  say(env, 'B', '共乘 去學校 確認 2026-10-13 07:40');
  same(env.pushes()[0].body.to, ['A']);
  assert.equal(saidOf(env.pushes()[0].body.messages[0]), '🔔 明天 07:40 士林站 → 東吳，又有 1 人加入\n現在 2 人，一人約 80 元（原本 160 元）');

  say(env, 'C', '共乘 去學校 確認 2026-10-13 07:40');
  same(env.pushes()[1].body.to, ['A', 'B']);
  assert.match(saidOf(env.pushes()[1].body.messages[0]), /現在 3 人，一人約 55 元（原本 80 元）/);
});

test('預約：提早取消不扣分，其他人會收到通知', () => {
  const env = start();
  ['A', 'B', 'C'].forEach(u => say(env, u, '共乘 去學校 確認 2026-10-13 07:40'));
  const before = env.pushes().length;
  assert.match(saidOf(say(env, 'B', '取消共乘')), /已取消 明天 07:40 士林站 → 東吳。$/);
  assert.equal(user(env, 'B').credit, 100);
  const push = env.pushes()[before];
  same(push.body.to, ['A', 'C']);
  assert.equal(saidOf(push.body.messages[0]), '明天 07:40 士林站 → 東吳 那班有 1 人取消，現在 2 人，一人約 80 元');
});

test('預約：同一班不能預約兩次；滿 4 人就不能再加', () => {
  const env = start();
  ['A', 'B', 'C', 'D'].forEach(u => say(env, u, '共乘 去學校 確認 2026-10-13 07:40'));
  say(env, 'A', '共乘 去學校 確認 2026-10-13 07:40');
  assert.equal(group(env).members.length, 4);
  assert.match(textOf(say(env, 'E', '共乘 去學校 預約 2026-10-13 07:40')), /這班已經滿 4 人了/);
  say(env, 'E', '共乘 去學校 確認 2026-10-13 07:40');
  assert.equal(group(env).members.length, 4);
  assert.equal(group(env).status, '等待中', '提早滿了也要等到出發前 5 分鐘才算成團');
});

test('預約：時間會對齊到 10 分鐘一班；太近、太遠的時間不能預約', () => {
  const env = start();
  say(env, 'A', '共乘 去學校 確認 2026-10-13 07:52');
  assert.equal(group(env).depart.toISOString(), new Date('2026-10-13T07:50:00+08:00').toISOString());
  assert.match(textOf(say(env, 'B', '共乘 去學校 預約 2026-10-12 07:33')), /太近了，5 分鐘內要走請用「現在走」/);
  assert.match(textOf(say(env, 'B', '共乘 去學校 預約 2026-10-30 07:40')), /最遠只能預約 7 天內/);
  assert.match(textOf(say(env, 'B', '共乘 去學校 預約 亂打')), /看不懂這個時間/);
});

test('預約：出發前 5 分鐘提醒一次，現場的人可以加入，到時間成團', () => {
  const env = start();
  ['A', 'B'].forEach(u => say(env, u, '共乘 去學校 確認 2026-10-13 07:40'));
  const before = env.pushes().length;

  env.setNow('2026-10-13T07:30:00+08:00');
  env.call('共乘每分鐘檢查');
  assert.equal(env.pushes().length, before, '還沒到出發前 5 分鐘，不提醒');
  assert.match(textOf(say(env, 'D', '共乘 去學校 現在走')), /現在沒有人在等/, '預約團還沒開放現場加入');

  env.setNow('2026-10-13T07:35:00+08:00');
  env.call('共乘每分鐘檢查');
  env.call('共乘每分鐘檢查');
  assert.equal(env.pushes().length, before + 1, '只提醒一次');
  assert.match(saidOf(env.pushes()[before].body.messages[0]), /你預約的 今天 07:40 士林站 → 東吳 快出發了\n現在 2 人，一人約 80 元/);

  assert.match(textOf(say(env, 'D', '共乘 去學校 現在走')), /現在有 2 個人在等，今天 07:40 出發。\n你加入就 3 人，一人約 55 元/);
  say(env, 'D', '共乘 去學校 加入');
  press(env, 'A', 'arrived');
  press(env, 'B', 'arrived');

  env.setNow('2026-10-13T07:40:00+08:00');
  const view = room(env, 'D');
  assert.equal(view.status, '已成團');
  assert.equal(view.members.length, 3);
  assert.equal(view.share, 55);
});

test('預約沒出現：扣 5 分並移出這一團；到場的那個人拿獨行獎勵', () => {
  const env = start();
  ['A', 'B'].forEach(u => say(env, u, '共乘 去學校 確認 2026-10-13 07:40'));
  env.setNow('2026-10-13T07:36:00+08:00');
  press(env, 'A', 'arrived');

  env.setNow('2026-10-13T07:40:00+08:00');
  assert.equal(room(env, 'A').status, '已成團', '出發時間先成團，沒到的人還有 3 分鐘');

  env.setNow('2026-10-13T07:43:00+08:00');
  const view = room(env, 'A');
  assert.equal(view.status, '獨行');
  assert.equal(view.reward, 20);
  assert.equal(user(env, 'B').credit, 95);
  assert.equal(user(env, 'A').credit, 100);
  assert.ok(events(env).includes('沒出現'));
});

test('預約的人全都沒出現：全部扣分，這一團取消', () => {
  const env = start();
  ['A', 'B'].forEach(u => say(env, u, '共乘 去學校 確認 2026-10-13 07:40'));
  env.setNow('2026-10-13T07:44:00+08:00');
  env.call('共乘每分鐘檢查');
  assert.equal(group(env).status, '取消');
  same(['A', 'B'].map(u => user(env, u).credit), [95, 95]);
});

test('出發前 5 分鐘內才取消：扣 2 分', () => {
  const env = start();
  ['A', 'B'].forEach(u => say(env, u, '共乘 去學校 確認 2026-10-13 07:40'));
  env.setNow('2026-10-13T07:37:00+08:00');
  assert.match(textOf(say(env, 'B', '取消共乘')), /信用分扣 2 分/);
  assert.equal(user(env, 'B').credit, 98);
});

test('信用分低於 80 不能預約，但還是可以現在走', () => {
  const env = start();
  env.call('cpCredit_', 'A', -25);
  assert.match(textOf(say(env, 'A', '共乘 去學校 確認 2026-10-13 07:40')), /信用分是 75 分，低於 80 分暫時不能預約/);
  assert.equal(env.call('cpLoadGroups_').length, 0);
  assert.match(textOf(say(env, 'A', '共乘 去學校 加入')), /已開鈴/);
});

test('完成一次共乘，信用分加回 1 分（最高 100）', () => {
  const env = start();
  env.call('cpCredit_', 'A', -5);
  ['A', 'B'].forEach(u => say(env, u, '共乘 去學校 加入'));
  env.addMinutes(5);
  press(env, 'A', 'call');
  press(env, 'A', 'board');
  press(env, 'B', 'board');
  assert.equal(user(env, 'A').credit, 96);
  assert.equal(user(env, 'B').credit, 100);
});

test('推播額度快用完時不回報，但預約本身還是成功', () => {
  const env = start();
  env.quotaLeft = 30;
  ['A', 'B'].forEach(u => say(env, u, '共乘 去學校 確認 2026-10-13 07:40'));
  assert.equal(env.pushes().length, 0);
  assert.equal(group(env).members.length, 2);
});

test('「我的共乘」列出我的班次和信用分、積分', () => {
  const env = start();
  assert.match(textOf(say(env, 'A', '我的共乘')), /你目前沒有共乘。\n信用分 100・積分 0/);
  say(env, 'A', '共乘 去學校 確認 2026-10-13 07:40');
  say(env, 'A', '共乘 回士林 確認 2026-10-13 17:10');
  const mine = textOf(say(env, 'A', '我的共乘'));
  assert.match(mine, /明天 07:40 士林站 → 東吳（等待中，1 人，一人約 160 元）/);
  assert.match(mine, /明天 17:10 東吳 → 士林站/);
  const which = say(env, 'A', '取消共乘');
  assert.match(which.altText, /^要取消哪一班？/);
  assert.equal(buttonsOf(which).length, 2);
});

test('等車室：連結失效、沒有共乘、等待中的畫面資料', () => {
  const env = start();
  same(env.call('cpRoomState', 'not-a-token'), { ok: false });
  assert.equal(room(env, 'A').none, true);
  env.names.A = '<b>小安</b>';
  env.sheets['共乘用戶'].rows.length = 1; // 重新抓暱稱
  say(env, 'A', '共乘 去學校 加入');
  const view = room(env, 'A');
  assert.equal(view.dir, '士林站 → 東吳');
  assert.equal(view.meet, '捷運士林站 1 號出口');
  assert.equal(view.departAt - view.now, 5 * 60000);
  same(view.members, [{ name: '<b>小安</b>', leader: true, me: true, arrived: true, boarded: false }]);
  assert.equal(JSON.stringify(view).includes('"id"'), false, '不把 LINE 使用者 ID 傳到網頁');
});

test('doGet：代碼格式正確才給等車室網頁', () => {
  const env = start();
  const t = token(env, 'A');
  const page = env.call('doGet', { parameter: { page: 'room', t } });
  assert.ok(page.content.includes("var TOKEN = '" + t + "', BOT = '@311zktcn'"));
  assert.equal(page.content.includes('__'), false);
  assert.equal(env.call('doGet', { parameter: { page: 'room', t: "x'</script>" } }).text, '東吳通勤達人');
  assert.equal(env.call('doGet', {}).text, '東吳通勤達人');
});

test('等車室網頁裡的程式語法正確', () => {
  const env = start();
  const html = env.run('ROOM_HTML');
  const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.doesNotThrow(() => new Function('google', 'document', 'window', script.replace(/setInterval\([^)]*\);|poll\(\);/g, '')));
});

test('等車室網頁不用 confirm、alert：Apps Script 的框架裡這些會被瀏覽器擋掉', () => {
  const env = start();
  const script = env.run('ROOM_HTML').match(/<script>([\s\S]*)<\/script>/)[1].replace(/\/\/.*$/gm, '');
  assert.equal(/\b(confirm|alert|prompt)\s*\(/.test(script), false);
});

test('Code.gs：共乘的訊息會轉給共乘.gs，回覆帶自己的按鈕', () => {
  const env = start();
  const send = ev => { env.call('handleEvent_', Object.assign({ replyToken: 'r', source: { userId: 'A' } }, ev)); return env.fetches.filter(f => f.url.endsWith('/message/reply')).pop().body; };

  const dirs = send({ type: 'message', message: { type: 'text', text: '共乘' } });
  same(buttonsOf(dirs.messages[0]).map(b => b[0]), ['士林站 → 東吳', '東吳 → 士林站', '我的共乘']);

  const joined = send({ type: 'message', message: { type: 'text', text: '共乘 去學校 加入' } });
  assert.equal(joined.messages.length, 1);
  assert.equal(buttonsOf(joined.messages[0])[0][0], '打開等車室');
  assert.equal(hasQuickReply(joined.messages), false, '不放輸入框上面那排按鈕');

  const picked = send({ type: 'postback', postback: { data: 'cp=預約&dir=回士林', params: { datetime: '2026-10-12T17:12' } } });
  assert.match(picked.messages[0].altText, /今天 17:10 東吳 → 士林站/);

  const log = env.sheets['訊息紀錄'].rows;
  assert.equal(log.length, 4);
  assert.equal(typeof log[2][3], 'string', '紀錄裡只留文字');
});

test('預約的時間選項：去學校是明天早上，回士林看現在幾點', () => {
  const env = start('2026-10-12T17:30:00+08:00');
  const toSchool = buttonsOf(say(env, 'A', '共乘 去學校 預約'));
  same(toSchool.slice(0, 2).map(b => b[1]), ['共乘 去學校 預約 2026-10-13 07:40', '共乘 去學校 預約 2026-10-13 08:40']);
  assert.equal(toSchool[2][0], '自己選時間');
  assert.equal(toSchool[2][1].picker.type, 'datetimepicker');
  assert.equal(toSchool[2][1].picker.min, '2026-10-12T17:36');
  assert.equal(toSchool[2][1].picker.initial, '2026-10-12T18:00');
  assert.ok(toSchool.every(b => b[0].length <= 20));

  const toShilin = buttonsOf(say(env, 'A', '共乘 回士林 預約'));
  same(toShilin.slice(0, 2).map(b => b[0]), ['明天 17:10（第 8 節下課）', '今天 18:30（第 9 節下課）']);
});

test('設定共乘排程：重複執行也只會有一個排程', () => {
  const env = start();
  env.call('設定共乘排程');
  env.call('設定共乘排程');
  assert.equal(env.triggers.length, 1);
  same(Object.keys(env.sheets).sort(), ['共乘團', '共乘用戶', '共乘紀錄'].sort());
});
