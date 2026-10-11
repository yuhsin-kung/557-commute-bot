// 積分、打卡、成就、YouBike、雨傘、新生測驗、包車、每日報表的測試。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));
const MON_0700 = '2026-10-12T07:00:00+08:00';
const MON_0900 = '2026-10-12T09:00:00+08:00';

const QIANMU = [25.09727, 121.54160]; // 錢穆故居站
const CAMPUS = [25.09457, 121.54575]; // 校內 557 站
const SHILIN = [25.09547, 121.52690]; // 捷運士林站

function start(now = MON_0900) {
  const env = loadBot(ALL);
  env.setNow(now);
  return env;
}
function textOf(answer) {
  return (Array.isArray(answer) ? answer : [answer])
    .map(m => (typeof m === 'string' ? m : m.text || (m.template && m.template.text) || '')).join('\n');
}
const say = (env, uid, text) => env.call('memberReply_', uid, text);
const user = (env, uid) => env.call('cpUser_', uid);
const checkin = (env, uid, at, accuracy = 20) => env.call('ptCheckin', user(env, uid).token, at[0], at[1], accuracy);
const rows = (env, name) => env.sheets[name].rows.slice(1);

// ===== 打卡、步行、早到 =====

test('「打卡」回一個按鈕，網址帶這個人的代碼', () => {
  const env = start();
  const button = say(env, 'A', '打卡');
  assert.match(button.template.actions[0].uri, /\?page=checkin&t=[0-9a-f-]{36}$/);
});

test('錢穆故居站打卡 → 走到校內再打一次：步行 +10 分、記減碳量', () => {
  const env = start();
  assert.match(checkin(env, 'A', QIANMU).title, /錢穆故居站打卡成功/);
  env.addMinutes(12);
  const done = checkin(env, 'A', CAMPUS);
  assert.equal(done.ok, true);
  assert.match(done.lines.join('\n'), /走了 12 分鐘，步行 \+10 分/);
  assert.equal(user(env, 'A').points, 10);
  const log = rows(env, '通勤紀錄')[0];
  assert.deepEqual([log[1], log[2], log[3], log[4]], ['A', '步行', 10, 61]); // 0.8 公里 × 76.7 公克
});

test('打卡只記打卡點和距離，不記經緯度', () => {
  const env = start();
  checkin(env, 'A', QIANMU);
  const all = JSON.stringify(rows(env, '打卡紀錄'));
  assert.ok(!all.includes('25.09') && !all.includes('121.54'));
});

test('超過 25 分鐘才到校，不算步行', () => {
  const env = start();
  checkin(env, 'A', QIANMU);
  env.addMinutes(40);
  assert.doesNotMatch(checkin(env, 'A', CAMPUS).lines.join('\n'), /步行 \+/);
  assert.equal(user(env, 'A').points, 0);
});

test('步行一天只算一次', () => {
  const env = start();
  for (let i = 0; i < 2; i++) {
    checkin(env, 'A', QIANMU);
    env.addMinutes(10);
    checkin(env, 'A', CAMPUS);
    env.addMinutes(10);
  }
  assert.equal(user(env, 'A').points, 10);
});

test('7:30 前到校有早餐券，一天一次；7:30 以後沒有', () => {
  const early = start(MON_0700);
  const first = checkin(early, 'A', CAMPUS).lines.join('\n');
  assert.match(first, /早到 \+5 分/);
  assert.match(first, /早餐券 EB-1012-/);
  early.addMinutes(5);
  assert.doesNotMatch(checkin(early, 'A', CAMPUS).lines.join('\n'), /早餐券 EB-/);
  assert.equal(user(early, 'A').points, 5);

  const late = start(MON_0900);
  assert.doesNotMatch(checkin(late, 'B', CAMPUS).lines.join('\n'), /早餐券 EB-/);
});

test('不在打卡點、定位誤差太大、代碼不對、一分鐘內重複，都不會加分', () => {
  const env = start();
  assert.match(checkin(env, 'A', SHILIN).title, /不在打卡點附近/);
  env.addMinutes(2);
  assert.match(checkin(env, 'A', QIANMU, 500).title, /定位不夠準/);
  assert.match(env.call('ptCheckin', 'not-a-token', QIANMU[0], QIANMU[1], 10).title, /連結失效/);
  assert.match(env.call('ptCheckin', '00000000-0000-0000-0000-000000000000', QIANMU[0], QIANMU[1], 10).title, /連結失效/);
  assert.match(env.call('ptCheckin', user(env, 'A').token, 'x', QIANMU[1], 10).title, /定位資料不正確/);
  env.addMinutes(2);
  checkin(env, 'A', QIANMU);
  assert.match(checkin(env, 'A', QIANMU).title, /剛剛打過了/);
  assert.equal(user(env, 'A').points, 0);
});

test('騎車到校：要先在校內打卡，一天一次', () => {
  const env = start();
  assert.match(textOf(say(env, 'A', '騎車到校')), /請先在學校打卡/);
  checkin(env, 'A', CAMPUS);
  assert.match(say(env, 'A', '騎車到校'), /騎車到校 \+8 分/);
  assert.match(say(env, 'A', '騎車到校'), /今天已經記過騎車到校了/);
  assert.equal(user(env, 'A').points, 8);
});

// ===== 我的紀錄、成就、全校 =====

test('走 5 次解鎖「走路達人」；我的紀錄和全校減碳的數字正確', () => {
  const env = start();
  let last;
  for (let day = 0; day < 5; day++) {
    checkin(env, 'A', QIANMU);
    env.addMinutes(10);
    last = checkin(env, 'A', CAMPUS);
    env.addMinutes(24 * 60 - 10);
  }
  assert.match(last.lines.join('\n'), /解鎖成就：走路達人/);
  const mine = say(env, 'A', '我的紀錄');
  assert.match(mine, /積分：50 分/);
  assert.match(mine, /步行 5 次/);
  assert.match(mine, /🏅 走路達人/);
  assert.match(mine, /▫️ 早鳥/);
  assert.match(say(env, 'A', '全校減碳'), /少排放了 0\.3[01] 公斤/); // 5 × 61 公克
});

test('共乘上車、獨行都算進「共乘夥伴」', () => {
  const env = start();
  env.call('cpSheet_', '共乘紀錄', ['時間', '團號', '使用者 ID', '方向', '類型', '事件']).appendRow([new Date(), 'G1', 'A', '去學校', '即時', '上車']);
  assert.match(say(env, 'A', '我的紀錄'), /共乘 1 次/);
  assert.match(say(env, 'A', '我的紀錄'), /🏅 共乘夥伴/);
});

// ===== YouBike =====

test('YouBike：列出士林站可借、東吳附近可還；抓不到資料會說明', () => {
  const env = start();
  assert.match(say(env, 'A', 'YouBike'), /查不到 YouBike 即時資料/);
  env.addMinutes(2); // 等快取過期
  env.respond.youbike = [
    { sna: 'YouBike2.0_捷運士林站(1號出口)', available_rent_bikes: 7, available_return_bikes: 3, latitude: 25.0955, longitude: 121.5270 },
    { sna: 'YouBike2.0_東吳大學', available_rent_bikes: 2, available_return_bikes: 9, latitude: 25.0946, longitude: 121.5457 },
    { sna: 'YouBike2.0_很遠的站', available_rent_bikes: 5, available_return_bikes: 5, latitude: 25.03, longitude: 121.56 },
  ];
  const reply = say(env, 'A', 'youbike');
  assert.match(reply, /捷運士林站\(1號出口\)：可借 7 台、可還 3 格/);
  assert.match(reply, /東吳大學：可借 2 台、可還 9 格/);
  assert.doesNotMatch(reply, /很遠的站/);
});

// ===== 共享雨傘 =====

test('雨傘：借一把、不能借第二把、還了加 3 分並解鎖雨天英雄', () => {
  const env = start();
  env.call('建立雨傘清單');
  assert.equal(rows(env, '雨傘').length, 6);
  assert.deepEqual(JSON.parse(JSON.stringify(say(env, 'A', '借傘').quickReply.items.map(i => i.action.text))), ['借傘 錢穆故居站', '借傘 校門口']);
  assert.match(textOf(say(env, 'A', '借傘 錢穆故居站')), /借到 U01/);
  assert.match(textOf(say(env, 'A', '借傘 校門口')), /已經借了 U01/);
  const back = say(env, 'A', '還傘 校門口');
  assert.match(back, /已歸還 U01.*\+3 分/);
  assert.match(back, /雨天英雄/);
  assert.equal(rows(env, '雨傘')[0][3], '校門口', '傘現在在校門口');
  assert.match(say(env, 'A', '還傘 校門口'), /沒有借傘/);
});

test('雨傘：重複借還不能一直加分，還傘的積分一天只給一次', () => {
  const env = start();
  env.call('建立雨傘清單');
  say(env, 'A', '借傘 錢穆故居站');
  assert.match(say(env, 'A', '還傘 校門口'), /\+3 分/);
  say(env, 'A', '借傘 校門口');
  const again = say(env, 'A', '還傘 錢穆故居站');
  assert.match(again, /已歸還 .*今天的還傘積分已經領過了/);
  assert.equal(env.call('cpUser_', 'A').points, 3);
  assert.equal(rows(env, '雨傘').filter(r => r[1] === '借出').length, 0, '傘還是有還回去');

  env.addMinutes(24 * 60);
  say(env, 'A', '借傘 錢穆故居站');
  assert.match(say(env, 'A', '還傘 校門口'), /\+3 分/, '隔天可以再拿');
  assert.equal(env.call('cpUser_', 'A').points, 6);
});

test('雨傘：那個點借完了會說沒有', () => {
  const env = start();
  env.call('建立雨傘清單');
  ['A', 'B', 'C'].forEach(u => say(env, u, '借傘 校門口'));
  assert.match(say(env, 'D', '借傘 校門口'), /沒有傘可以借了/);
});

// ===== 新生測驗、排隊禮儀、包車 =====

test('新生測驗：全對 +5 分、解鎖新生上路，再考一次不重複給分', () => {
  const env = start();
  assert.match(textOf(say(env, 'A', '新生教學')), /第一次搭 557/);
  assert.match(textOf(say(env, 'A', '新生測驗')), /第 1 題／共 3 題/);
  say(env, 'A', '答 2');
  say(env, 'A', '答 1');
  const done = say(env, 'A', '答 2');
  assert.match(done, /全部答對！\+5 分/);
  assert.match(done, /新生上路/);
  say(env, 'A', '新生測驗'); say(env, 'A', '答 2'); say(env, 'A', '答 1');
  assert.match(say(env, 'A', '答 2'), /積分之前領過了/);
  assert.equal(user(env, 'A').points, 5);
});

test('新生測驗：答錯會告訴正確答案，沒全對不給分', () => {
  const env = start();
  say(env, 'A', '新生測驗');
  assert.match(textOf(say(env, 'A', '答 1')), /正確答案是「傳「557 在哪裡搭」給我」/);
  say(env, 'A', '答 1');
  assert.match(textOf(say(env, 'A', '答 2')), /答對 2\/3 題/);
  assert.equal(user(env, 'A').points, 0);
});

test('排隊禮儀、包車意願', () => {
  const env = start();
  assert.match(textOf(say(env, 'A', '排隊禮儀')), /不點名、不拍攝任何人/);
  assert.match(textOf(say(env, 'A', '包車')), /規劃中/);
  assert.match(say(env, 'A', '包車 我有興趣'), /意願記下來了/);
  assert.deepEqual(JSON.parse(JSON.stringify(rows(env, '意願紀錄')[0].slice(1))), ['A', '包車', '有興趣']);
});

test('不認得的指令回 null，交給原本的 route_；「傘」「排隊」開頭的新指令不會被當成問天氣、問站牌', () => {
  const env = start();
  assert.equal(say(env, 'A', '8 點在 D 棟上課'), null);
  assert.equal(say(env, 'A', '明天要帶傘嗎'), null);
  assert.equal(say(env, 'A', '要去哪裡排隊'), null);
  assert.notEqual(say(env, 'A', '共享雨傘'), null);
  assert.notEqual(say(env, 'A', '排隊禮儀'), null);
});

// ===== 每日報表 =====

test('每日報表：統計當天的紀錄、存一列、寄信，一天只寄一次', () => {
  const env = start();
  env.props.REPORT_EMAILS = 'team@example.com';
  const now = new Date('2026-10-12T09:00:00+08:00');
  env.call('cpSheet_', '訊息紀錄', ['時間', '使用者 ID', '使用者訊息', 'Bot 回覆']);
  [['A', '557'], ['A', '天氣'], ['B', '共乘']].forEach(m => env.sheets['訊息紀錄'].rows.push([now, m[0], m[1], '']));
  env.sheets['訊息紀錄'].rows.push([new Date('2026-10-11T09:00:00+08:00'), 'C', '昨天的', '']);
  env.call('cpSheet_', '比較器紀錄', ['時間', '學生問的', '出發站', '大樓', '上課時間', '模式']);
  env.sheets['比較器紀錄'].rows.push([now, '早八 D棟', '士林站', 'D', '10/12 08:10', '出門建議']);
  checkin(env, 'A', QIANMU);
  env.addMinutes(10);
  checkin(env, 'A', CAMPUS);

  // 報表用真的時間判斷「今天」，所以把今天當成紀錄的那一天來算
  const report = env.call('buildReport_', now);
  assert.equal(report.users, 2);
  assert.equal(report.messages, 3);
  assert.equal(report.compares, 1);
  assert.equal(report.walk, 1);
  assert.equal(report.topTime, '08:10');
  assert.match(report.summary, /共 2 位同學使用 Bot/);

  env.call('每日報表');
  env.call('每日報表');
  assert.equal(env.mails.length, 1);
  assert.equal(env.mails[0].to, 'team@example.com');
  assert.equal(rows(env, '每日報表').length, 1);
});

test('每日報表：沒設定收件人就不寄信，但還是會存', () => {
  const env = start();
  env.call('每日報表');
  assert.equal(env.mails.length, 0);
  assert.equal(rows(env, '每日報表').length, 1);
});
