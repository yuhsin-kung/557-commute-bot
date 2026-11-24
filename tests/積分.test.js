// 積分、打卡、成就、YouBike、共享雨傘、新生測驗、包車、每日報表的測試。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');
const { textOf, buttonsOf } = require('./helpers');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));
const MON_0700 = '2026-10-12T07:00:00+08:00';
const MON_0900 = '2026-10-12T09:00:00+08:00';

const QIANMU = [25.09727, 121.54160]; // 錢穆故居站
const CAMPUS = [25.09457, 121.54575]; // 校內 557 站
const SHILIN = [25.09547, 121.52690]; // 捷運士林站，離校約 1.9 公里

function northOf(at, meters) {
  return [at[0] + (meters / 6371000) * (180 / Math.PI), at[1]];
}

function start(now = MON_0900) {
  const env = loadBot(ALL);
  env.setNow(now);
  return env;
}
const say = (env, uid, text) => env.call('memberReply_', uid, text);
const user = (env, uid) => env.call('cpUser_', uid);
const rows = (env, name) => env.sheets[name].rows.slice(1);

function onceCode(env, uid) {
  const uri = buttonsOf(say(env, uid, '打卡'))[0][1];
  const m = uri.match(/t=([0-9a-f-]{36})$/);
  if (!m) throw new Error('打卡網址沒有代碼');
  return m[1];
}

/** 第二次定位才是判斷距離的位置；兩次的座標不能完全一樣 */
function pair(at, accuracy, nowMs) {
  return [
    { lat: at[0] + 0.00002, lng: at[1], accuracy: accuracy, ts: nowMs - 3000 },
    { lat: at[0], lng: at[1], accuracy: accuracy, ts: nowMs },
  ];
}

const checkin = (env, uid, at, accuracy = 20) => env.call('ptCheckin', onceCode(env, uid), pair(at, accuracy, env.call('cpNow_').getTime()));

// ===== 打卡、步行、早到 =====

test('「打卡」回一個按鈕，網址帶一次性代碼，不是永久 token', () => {
  const env = start();
  const button = say(env, 'A', '打卡');
  assert.equal(buttonsOf(button)[0][0], '打開打卡頁');
  assert.match(buttonsOf(button)[0][1], /\?page=checkin&t=[0-9a-f-]{36}$/);
  assert.notEqual(buttonsOf(button)[0][1].slice(-36), user(env, 'A').token);
});

test('錢穆故居站打卡 → 走到校內再打一次：步行 +1 點、記減碳量', () => {
  const env = start();
  assert.match(checkin(env, 'A', QIANMU).title, /錢穆故居站打卡成功/);
  env.addMinutes(12);
  const done = checkin(env, 'A', CAMPUS);
  assert.equal(done.ok, true);
  assert.match(done.lines.join('\n'), /走了 12 分鐘，步行 \+1 點/);
  assert.equal(user(env, 'A').points, 1);
  const log = rows(env, '通勤紀錄')[0];
  assert.deepEqual([log[1], log[2], log[3], log[4]], ['A', '步行', 1, 61]); // 0.8 公里 × 76.7 公克
});

test('打卡只記打卡點和距離，不記經緯度', () => {
  const env = start();
  checkin(env, 'A', QIANMU);
  const all = JSON.stringify(rows(env, '打卡紀錄'));
  assert.ok(!all.includes('25.09') && !all.includes('121.54'));
});

test('超過 20 分鐘才到校，不算步行', () => {
  const env = start();
  checkin(env, 'A', QIANMU);
  env.addMinutes(21);
  const done = checkin(env, 'A', CAMPUS);
  assert.doesNotMatch(done.lines.join('\n'), /步行 \+/);
  assert.match(done.lines.join('\n'), /超過 20 分鐘/);
  assert.equal(user(env, 'A').points, 0);
});

test('步行少於 6 分鐘不算', () => {
  const env = start();
  checkin(env, 'A', QIANMU);
  env.addMinutes(5);
  const done = checkin(env, 'A', CAMPUS);
  assert.doesNotMatch(done.lines.join('\n'), /步行 \+/);
  assert.match(done.lines.join('\n'), /6～20/);
  assert.equal(user(env, 'A').points, 0);
});

test('步行 6 分鐘和 20 分鐘都算', () => {
  const env = start();
  checkin(env, 'A', QIANMU);
  env.addMinutes(6);
  assert.match(checkin(env, 'A', CAMPUS).lines.join('\n'), /走了 6 分鐘，步行 \+1 點/);
  env.addMinutes(24 * 60);
  checkin(env, 'A', QIANMU);
  env.addMinutes(20);
  assert.match(checkin(env, 'A', CAMPUS).lines.join('\n'), /走了 20 分鐘，步行 \+1 點/);
  assert.equal(user(env, 'A').points, 2);
});

test('步行起點和到校要同一天，跨過午夜不算', () => {
  const env = start('2026-10-12T23:55:00+08:00');
  checkin(env, 'A', QIANMU);
  env.addMinutes(10); // 10/13 00:05，間隔 10 分鐘但仍跨日
  const done = checkin(env, 'A', CAMPUS);
  assert.doesNotMatch(done.lines.join('\n'), /步行 \+/);
  assert.match(done.lines.join('\n'), /同一天/);
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
  assert.equal(user(env, 'A').points, 1);
});

test('7:30 前到校、而且今天先有出門卡，早到 +1 點，一天一次；7:30 以後沒有；不再發早餐券', () => {
  const early = start(MON_0700);
  const noDepart = checkin(early, 'A', CAMPUS);
  assert.doesNotMatch(noDepart.lines.join('\n'), /早到 \+/);
  assert.match(noDepart.lines.join('\n'), /出門/);
  assert.equal(user(early, 'A').points, 0);

  early.addMinutes(2);
  assert.match(checkin(early, 'A', SHILIN).title, /出門打卡成功/);
  early.addMinutes(3);
  const first = checkin(early, 'A', CAMPUS).lines.join('\n');
  assert.match(first, /早到 \+1 點/);
  assert.match(first, /5 點換 30 元學餐折價券/);
  assert.doesNotMatch(first, /早餐/);
  early.addMinutes(5);
  assert.doesNotMatch(checkin(early, 'A', CAMPUS).lines.join('\n'), /早到 \+/);
  assert.equal(user(early, 'A').points, 1);

  const late = start(MON_0900);
  assert.doesNotMatch(checkin(late, 'B', CAMPUS).lines.join('\n'), /早到 \+/);
});

test('校內 50 公尺內才算到校、錢穆故居站 50 公尺內才算起點；舊的 150／300 公尺不算', () => {
  const env = start();
  assert.ok(env.call('ptMeters_', northOf(CAMPUS, 49), CAMPUS) <= 50);
  assert.ok(env.call('ptMeters_', northOf(CAMPUS, 51), CAMPUS) > 50);
  assert.ok(env.call('ptMeters_', northOf(CAMPUS, 200), CAMPUS) < 300);
  assert.match(checkin(env, 'A', northOf(CAMPUS, 49)).title, /到校打卡成功/);
  env.addMinutes(2);
  assert.match(checkin(env, 'A', northOf(CAMPUS, 51)).title, /不在打卡點附近/);
  env.addMinutes(2);
  assert.match(checkin(env, 'A', northOf(CAMPUS, 200)).title, /不在打卡點附近/);
  assert.match(checkin(env, 'B', northOf(QIANMU, 49)).title, /錢穆故居站打卡成功/);
  assert.equal(user(env, 'A').points, 0);
});

test('定位誤差 50 公尺收、超過 50 公尺不收，拒收原因寫進打卡紀錄', () => {
  const env = start();
  assert.match(checkin(env, 'A', CAMPUS, 50).title, /到校打卡成功/);
  env.addMinutes(2);
  const bad = checkin(env, 'A', CAMPUS, 51);
  assert.match(bad.title, /定位不夠準/);
  const row = rows(env, '打卡紀錄').pop();
  assert.equal(row[5], '誤差太大');
  assert.match(String(row[6]), /超過 50 公尺/);
  assert.equal(user(env, 'A').points, 0);
});

test('離校 500 公尺以外可打出門卡，只記距離不記經緯度；前一天的出門卡不算今天的早到', () => {
  const env = start('2026-10-11T23:50:00+08:00');
  const far = checkin(env, 'A', SHILIN);
  assert.equal(far.ok, true);
  assert.match(far.title, /出門打卡成功/);
  const row = rows(env, '打卡紀錄').pop();
  assert.equal(row[2], '出門');
  assert.equal(row[5], '出門');
  assert.ok(row[3] >= 500);
  assert.equal(JSON.stringify(row).includes('25.09'), false);
  assert.equal(JSON.stringify(row).includes('121.52'), false);
  assert.equal(user(env, 'A').points, 0, '出門卡本身不加分');

  env.addMinutes(20); // 10/12 00:10，7:30 前，但出門卡是前一天
  const next = checkin(env, 'A', CAMPUS);
  assert.doesNotMatch(next.lines.join('\n'), /早到 \+/);
  assert.match(next.lines.join('\n'), /今天還沒有出門打卡/);
  assert.equal(user(env, 'A').points, 0);
});

test('出門到到校的間隔小於每公里 1 分鐘，不給早到點並說明原因', () => {
  const env = start(MON_0700);
  checkin(env, 'A', SHILIN); // 約 1.9 公里，至少要隔 1.9 分鐘
  env.addMinutes(1);
  const campus = checkin(env, 'A', CAMPUS);
  assert.doesNotMatch(campus.lines.join('\n'), /早到 \+/);
  assert.match(campus.lines.join('\n'), /至少要隔/);
  assert.equal(user(env, 'A').points, 0);
  assert.equal(rows(env, '打卡紀錄').pop()[5], '到校');
});

test('打卡代碼用過即失效、10 分鐘後過期，永久 token 不能打卡', () => {
  const env = start();
  const code = onceCode(env, 'A');
  const nowMs = env.call('cpNow_').getTime();
  assert.match(env.call('ptCheckin', code, pair(QIANMU, 10, nowMs)).title, /錢穆故居站打卡成功/);
  env.addMinutes(2); // 過了一分鐘的頻率限制，但代碼已經用過
  const again = env.call('cpNow_').getTime();
  assert.match(env.call('ptCheckin', code, pair(QIANMU, 10, again)).title, /連結失效/);
  assert.match(env.call('ptCheckin', user(env, 'A').token, pair(QIANMU, 10, again)).title, /連結失效/);

  const fresh = onceCode(env, 'B');
  env.addMinutes(9);
  assert.match(env.call('ptCheckin', fresh, pair(QIANMU, 10, env.call('cpNow_').getTime())).title, /錢穆故居站打卡成功/);
  const expired = onceCode(env, 'C');
  env.addMinutes(10);
  assert.match(env.call('ptCheckin', expired, pair(QIANMU, 10, env.call('cpNow_').getTime())).title, /連結失效/);
});

test('兩次定位的座標與誤差完全相同就拒收，並把原因寫進打卡紀錄', () => {
  const env = start();
  const ts = env.call('cpNow_').getTime();
  const fix = { lat: QIANMU[0], lng: QIANMU[1], accuracy: 8, ts: ts };
  const res = env.call('ptCheckin', onceCode(env, 'A'), [fix, { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy, ts: ts - 2000 }]);
  assert.equal(res.ok, false);
  assert.match(res.title, /兩次定位相同/);
  const row = rows(env, '打卡紀錄').pop();
  assert.equal(row[5], '定位重複');
  assert.match(String(row[6]), /完全相同/);
  assert.equal(JSON.stringify(row).includes('25.09727'), false);
  assert.equal(user(env, 'A').points, 0);
});

test('定位時間比送出早超過 30 秒就拒收，並把原因寫進打卡紀錄', () => {
  const env = start();
  const ts = env.call('cpNow_').getTime();
  const res = env.call('ptCheckin', onceCode(env, 'A'), [
    { lat: QIANMU[0] + 0.00002, lng: QIANMU[1], accuracy: 8, ts: ts - 31000 },
    { lat: QIANMU[0], lng: QIANMU[1], accuracy: 9, ts: ts },
  ]);
  assert.equal(res.ok, false);
  assert.match(res.title, /定位太舊/);
  assert.match(res.lines.join('\n'), /30 秒/);
  const row = rows(env, '打卡紀錄').pop();
  assert.equal(row[5], '定位太舊');
  assert.match(String(row[6]), /超過 30 秒/);
  assert.equal(user(env, 'A').points, 0);
});

test('不在打卡點、定位誤差太大、代碼不對、格式不對、一分鐘內重複，都不會加分', () => {
  const env = start();
  assert.match(checkin(env, 'A', northOf(CAMPUS, 120)).title, /不在打卡點附近/);
  env.addMinutes(2);
  assert.match(checkin(env, 'A', QIANMU, 500).title, /定位不夠準/);
  const nowMs = env.call('cpNow_').getTime();
  assert.match(env.call('ptCheckin', 'not-a-token', pair(QIANMU, 10, nowMs)).title, /連結失效/);
  assert.match(env.call('ptCheckin', '00000000-0000-0000-0000-000000000000', pair(QIANMU, 10, nowMs)).title, /連結失效/);
  assert.match(env.call('ptCheckin', user(env, 'A').token, 'x').title, /定位資料不正確/);
  assert.match(env.call('ptCheckin', onceCode(env, 'A'), [{ lat: 'x', lng: QIANMU[1], accuracy: 10, ts: nowMs }]).title, /定位資料不正確/);
  env.addMinutes(2);
  checkin(env, 'A', QIANMU);
  assert.match(checkin(env, 'A', QIANMU).title, /剛剛打過了/);
  assert.equal(user(env, 'A').points, 0);
});

/** 假裝同學傳了 YouBike 騎乘紀錄截圖，AI 讀出 seen */
function ride(env, uid, seen) {
  env.props.GEMINI_API_KEY = 'test-key';
  env.onFetch = url => {
    if (url.includes('api-data.line.me')) return { body: 'fake-png', type: 'image/png' };
    if (url.includes('generativelanguage')) return { body: { candidates: [{ content: { parts: [{ text: seen }] } }] } };
    return undefined;
  };
  const answer = env.call('ptBikePhoto_', uid, 'msg');
  env.onFetch = null;
  return answer;
}
const RIDE = (date, to = 'YouBike2.0_東吳大學', time = '08:05') =>
  '```json\n{"date":"' + date + '","time":"' + time + '","from":"YouBike2.0_捷運士林站(1號出口)","to":"' + to + '"}\n```';

test('騎車到校：傳今天在學校附近還車的 YouBike 騎乘紀錄才加 1 點，一筆紀錄只能用一次', () => {
  const env = start(); // 2026-10-12
  assert.equal(ride(env, 'A', RIDE('2026-10-12')), null, '沒按騎車到校就傳圖，Bot 不回');
  const ask = say(env, 'A', '騎車到校');
  assert.match(ask.altText, /截圖這次的騎乘紀錄/);
  assert.match(ride(env, 'A', '不是'), /看不出這是 YouBike 的騎乘紀錄/);
  assert.match(ride(env, 'A', RIDE('2026-10-11')), /這筆紀錄是 2026-10-11 的/);
  assert.match(ride(env, 'A', RIDE('2026-10-12', 'YouBike2.0_捷運劍潭站')), /還車站是「YouBike2.0_捷運劍潭站」/);
  assert.equal(user(env, 'A').points, 0);
  const ok = ride(env, 'A', RIDE('2026-10-12'));
  assert.match(ok, /騎車到校 \+1 點/);
  assert.match(ok, /捷運士林站\(1號出口\) → YouBike2\.0_東吳大學/);
  assert.equal(user(env, 'A').points, 1);
  assert.match(say(env, 'A', '騎車到校'), /今天已經記過騎車到校了/);

  say(env, 'B', '騎車到校');
  assert.match(ride(env, 'B', RIDE('2026-10-12')), /這筆騎乘紀錄已經用過了/, '別人的同一張截圖不能用');
  assert.equal(user(env, 'B').points, 0);
});

test('YouBike 還車站要跟清單完全一樣，舊的關鍵字（外雙溪、至善）不算', () => {
  const env = start();
  say(env, 'A', '騎車到校');
  assert.match(ride(env, 'A', RIDE('2026-10-12', 'YouBike2.0_外雙溪')), /還車站是「YouBike2\.0_外雙溪」/);
  assert.match(ride(env, 'A', RIDE('2026-10-12', '至善')), /還車站是「至善」/);
  assert.equal(user(env, 'A').points, 0);
  say(env, 'B', '騎車到校');
  const ok = ride(env, 'B', RIDE('2026-10-12', 'YouBike2.0_ 至善臨溪路口'));
  assert.match(ok, /騎車到校 \+1 點/);
  assert.match(ok, /至善臨溪路口/);
  assert.equal(user(env, 'B').points, 1);
  say(env, 'C', '騎車到校');
  assert.match(ride(env, 'C', RIDE('2026-10-12', '國立故宮博物院')), /騎車到校 \+1 點/);
  say(env, 'D', '騎車到校');
  assert.match(ride(env, 'D', RIDE('2026-10-12', 'YouBike2.0_梅林新村')), /騎車到校 \+1 點/);
});

test('YouBike 還車時間離現在超過 60 分鐘就拒絕，比現在晚超過 5 分鐘也拒絕', () => {
  const env = start(); // 09:00
  say(env, 'A', '騎車到校');
  assert.match(ride(env, 'A', RIDE('2026-10-12', 'YouBike2.0_東吳大學', '07:50')), /超過 60 分鐘/);
  assert.match(ride(env, 'A', RIDE('2026-10-12', 'YouBike2.0_東吳大學', '09:06')), /超過 5 分鐘/);
  assert.equal(user(env, 'A').points, 0);
  assert.match(ride(env, 'A', RIDE('2026-10-12', 'YouBike2.0_東吳大學', '08:00')), /騎車到校 \+1 點/, '剛好 60 分鐘還可以');
});

test('騎車到校：AI 不能用的時候不加分，請同學再傳', () => {
  const env = start();
  say(env, 'A', '騎車到校');
  env.onFetch = url => (url.includes('api-data.line.me') ? { body: 'x' } : undefined);
  assert.match(env.call('ptBikePhoto_', 'A', 'm'), /暫時沒辦法辨識截圖/);
  assert.equal(user(env, 'A').points, 0);
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
  const mine = textOf(say(env, 'A', '我的紀錄'));
  assert.match(mine, /積分：5 點/);
  assert.match(mine, /可以兌換 1 張 30 元學餐折價券/);
  assert.match(mine, /步行 5 次/);
  assert.match(mine, /🏅 走路達人/);
  assert.match(mine, /▫️ 早鳥/);
  assert.match(say(env, 'A', '全校減碳').altText, /少排放了 0\.3[01] 公斤/); // 5 × 61 公克
});

test('共乘上車、獨行都算進「共乘夥伴」', () => {
  const env = start();
  env.call('cpSheet_', '共乘紀錄', ['時間', '團號', '使用者 ID', '方向', '類型', '事件']).appendRow([new Date(), 'G1', 'A', '去學校', '即時', '上車']);
  assert.match(textOf(say(env, 'A', '我的紀錄')), /共乘 1 次/);
  assert.match(textOf(say(env, 'A', '我的紀錄')), /🏅 共乘夥伴/);
});

test('兌換學餐折價券：先顯示點數、問要不要換；按確認才扣 5 點、給券號', () => {
  const env = start(MON_0700);
  const none = say(env, 'A', '兌換折價券');
  assert.match(none.altText, /目前積分：0 點/);
  assert.match(none.altText, /還差：5 點/);
  assert.match(textOf(say(env, 'A', '確認兌換折價券')), /還差：5 點/, '不夠點數按確認也不會扣');
  for (let day = 0; day < 5; day++) { // 五天都先出門再於 7:30 前到校，一天 1 點
    checkin(env, 'A', SHILIN);
    env.addMinutes(3);
    checkin(env, 'A', CAMPUS);
    env.addMinutes(24 * 60 - 3);
  }
  assert.equal(user(env, 'A').points, 5);
  assert.deepEqual(buttonsOf(say(env, 'A', '我的紀錄'))[0], ['兌換學餐折價券', '兌換折價券']);
  const ask = say(env, 'A', '兌換折價券');
  assert.equal(ask.type, 'flex', '是卡片，不是純文字');
  assert.match(ask.altText, /目前積分：5 點/);
  assert.match(ask.altText, /可以兌換：1 張/);
  assert.match(ask.altText, /兌換後剩下 0 點。要兌換嗎？/);
  assert.deepEqual(buttonsOf(ask), [['確認兌換', '確認兌換折價券'], ['先不要', '我的紀錄']]);
  assert.equal(user(env, 'A').points, 5, '還沒按確認，不扣點');

  const got = say(env, 'A', '確認兌換折價券');
  assert.match(got[0], /兌換成功！剩下 0 點/);
  const card = got[1];
  assert.equal(card.type, 'flex');
  assert.match(card.altText, /^30 元學餐折價券｜券號 SC1017-0001｜2026\/11\/16 到期$/);
  const buttons = card.contents.footer.contents.map(b => [b.action.label, b.action.uri || b.action.text]);
  assert.equal(buttons[0][0], '查看此券');
  assert.match(buttons[0][1], /\?page=coupon&t=[0-9a-f-]{36}&c=SC1017-0001$/);
  assert.deepEqual(buttons[1], ['我的折價券', '我的折價券']);
  assert.equal(user(env, 'A').points, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(rows(env, '學餐折價券')[0].slice(1))), ['A', 'SC1017-0001', 30, '未使用', '2026/11/16']);
  assert.match(textOf(say(env, 'A', '確認兌換折價券')), /還差：5 點/, '換完再按確認也不能再換');

  // 我的折價券：列出還能用的券
  const mine = say(env, 'A', '我的折價券');
  assert.equal(mine.altText, '我的折價券：1 張可以用');
  assert.match(JSON.stringify(mine.contents), /SC1017-0001/);
  assert.match(say(env, 'B', '我的折價券').altText, /目前沒有可以用的折價券/);

  // 查看此券：代碼和券號都要對得上
  const page = env.call('doGet', { parameter: { page: 'coupon', t: user(env, 'A').token, c: 'SC1017-0001' } });
  assert.equal(page.title, '學餐折價券');
  assert.match(page.content, /30 元學餐折價券/);
  assert.match(page.content, /2026\/11\/16/);
  assert.match(page.content, /可以使用/);
  assert.match(page.content, /結帳時出示此頁面給學餐人員/);
  assert.match(env.call('doGet', { parameter: { page: 'coupon', t: user(env, 'B').token, c: 'SC1017-0001' } }).content, /找不到這張券/, '別人的代碼看不到這張券');
  assert.equal(env.call('doGet', { parameter: { page: 'coupon', t: user(env, 'A').token, c: '<script>' } }).text, '東吳通勤達人', '券號格式不對就不給頁面');

  // 30 天後過期
  env.addMinutes(31 * 24 * 60);
  assert.match(say(env, 'A', '我的折價券').altText, /目前沒有可以用的折價券/);
  assert.match(env.call('doGet', { parameter: { page: 'coupon', t: user(env, 'A').token, c: 'SC1017-0001' } }).content, /已過期/);
});

// ===== YouBike =====

test('YouBike：列出士林站可借、東吳附近可還；抓不到資料會說明', () => {
  const env = start();
  assert.match(say(env, 'A', 'YouBike').altText, /查不到 YouBike 即時資料/);
  env.addMinutes(2); // 等快取過期
  env.respond.youbike = [
    { sna: 'YouBike2.0_捷運士林站(1號出口)', available_rent_bikes: 7, available_return_bikes: 3, latitude: 25.0955, longitude: 121.5270 },
    { sna: 'YouBike2.0_東吳大學', available_rent_bikes: 2, available_return_bikes: 9, latitude: 25.0946, longitude: 121.5457 },
    { sna: 'YouBike2.0_很遠的站', available_rent_bikes: 5, available_return_bikes: 5, latitude: 25.03, longitude: 121.56 },
  ];
  const card = say(env, 'A', 'youbike');
  assert.equal(card.type, 'flex');
  const reply = card.altText;
  assert.match(reply, /捷運士林站\(1號出口\)：可借 7・可還 3/);
  assert.match(reply, /東吳大學：可借 2・可還 9/);
  assert.doesNotMatch(reply, /很遠的站/);
});

// ===== 共享雨傘：Raingo 租借站，Bot 只說明 =====

test('共享雨傘：顯示 Raingo 租借站（規劃中），不收照片、不給積分；設好網址才有借用方式按鈕', () => {
  const env = start();
  ['共享雨傘', '借傘', '還傘 校門口'].forEach(text => assert.match(say(env, 'A', text).altText, /共享雨傘（規劃中）/, text));
  const card = say(env, 'A', '共享雨傘');
  assert.match(card.altText, /錢穆故居站：Raingo 租借站/);
  assert.match(card.altText, /一站借、另一站還/);
  assert.deepEqual(buttonsOf(card), []);
  env.props.RAINGO_URL = 'https://example.com/raingo';
  assert.deepEqual(buttonsOf(say(env, 'A', '共享雨傘')), [['看借用方式', 'https://example.com/raingo']]);
  assert.equal(env.call('handleEvent_', { type: 'message', replyToken: 'r', source: { userId: 'A' }, message: { type: 'image', id: 'm1' } }), undefined);
  assert.equal(env.fetches.filter(f => f.url.endsWith('/message/reply')).length, 0, '沒在等騎乘紀錄的照片就不回');
  assert.equal(user(env, 'A').points, 0);
  assert.doesNotMatch(textOf(say(env, 'A', '我的紀錄')), /雨天英雄/);
});

// ===== 新生測驗、排隊禮儀、包車 =====

test('新生須知、新生測驗：全對 +1 點、解鎖新生上路，再考一次不重複給分', () => {
  const env = start();
  assert.match(textOf(say(env, 'A', '新生須知')), /新生須知：第一次搭 557/);
  assert.match(textOf(say(env, 'A', '新生教學')), /新生須知/, '舊的關鍵字也還認得');
  assert.match(textOf(say(env, 'A', '新生測驗')), /第 1 題／共 3 題/);
  say(env, 'A', '答 2');
  say(env, 'A', '答 1');
  const done = say(env, 'A', '答 2');
  assert.match(done, /全部答對！\+1 點/);
  assert.match(done, /新生上路/);
  say(env, 'A', '新生測驗'); say(env, 'A', '答 2'); say(env, 'A', '答 1');
  assert.match(say(env, 'A', '答 2'), /積分之前領過了/);
  assert.equal(user(env, 'A').points, 1);
});

test('新生測驗：答錯會告訴正確答案，沒全對不給分', () => {
  const env = start();
  say(env, 'A', '新生測驗');
  assert.match(textOf(say(env, 'A', '答 1')), /正確答案是「按「公車站牌與排隊禮儀」問我」/);
  say(env, 'A', '答 1');
  assert.match(textOf(say(env, 'A', '答 2')), /答對 2\/3 題/);
  assert.equal(user(env, 'A').points, 0);
});

test('排隊禮儀、包車意願', () => {
  const env = start();
  const etiquette = say(env, 'A', '排隊禮儀');
  assert.equal(etiquette.altText, '排隊禮儀短片：一起排好，大家都快');
  assert.equal(buttonsOf(etiquette).length, 0, '不放按鈕，只有回選單');
  assert.equal(etiquette.contents.hero.action, undefined, '還沒有影片網址就不能點');
  env.props.ETIQUETTE_VIDEO_URL = 'https://youtu.be/example';
  assert.equal(say(env, 'A', '排隊禮儀').contents.hero.action.uri, 'https://youtu.be/example');
  const charter = say(env, 'A', '包車');
  assert.match(charter.altText, /學生包車（規劃中）/);
  assert.match(charter.altText, /登記：下次選課結束後開放/);
  assert.match(charter.altText, /以一個月為單位繳費/);
  assert.match(charter.altText, /依人數最多的幾個時段洽詢合法遊覽車或交通業者/);
  assert.deepEqual(buttonsOf(charter), [], '表單還沒開放就沒有按鈕，也沒有「我有興趣」');
  assert.doesNotMatch(JSON.stringify(charter), /學期訂閱制|我有興趣/);
  env.props.CHARTER_FORM_URL = 'https://forms.example/charter';
  const open = say(env, 'A', '包車');
  assert.match(open.altText, /登記：表單開放中/);
  assert.deepEqual(buttonsOf(open), [['填寫包車登記表單', 'https://forms.example/charter']]);
  assert.equal(say(env, 'A', '包車 我有興趣').altText, open.altText, '舊按鈕傳來的字一樣顯示這張卡');
  assert.equal(env.sheets['意願紀錄'], undefined, 'Bot 不另外記登記');
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

test('步行成功但沒有新成就時，打卡紀錄結果是加分', () => {
  const env = start();
  checkin(env, 'A', QIANMU);
  env.addMinutes(12);
  const done = checkin(env, 'A', CAMPUS);
  assert.match(done.lines.join('\n'), /步行 \+1 點/);
  assert.doesNotMatch(done.lines.join('\n'), /解鎖成就/);
  assert.equal(user(env, 'A').points, 1);
  const row = rows(env, '打卡紀錄').pop();
  assert.equal(row[5], '加分');
  assert.equal(row[6], '');
});

test('沒有出門卡的早到，原因欄有寫原因', () => {
  const env = start(MON_0700);
  const done = checkin(env, 'A', CAMPUS);
  assert.doesNotMatch(done.lines.join('\n'), /早到 \+/);
  assert.equal(user(env, 'A').points, 0);
  const row = rows(env, '打卡紀錄').pop();
  assert.equal(row[5], '到校');
  assert.match(String(row[6]), /沒有出門卡/);
});
