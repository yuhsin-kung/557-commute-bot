// 課表熱度（bot/課表熱度.gs）和抓課表的整理規則（tools/抓課表.js）。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');
const { textOf, buttonsOf } = require('./helpers');
const { heat, place, parseCsv, csv } = require('../tools/抓課表');

// 真的資料每學期會變，測試用自己的一份：不載入 課表熱度資料.gs，改塞假資料
const FILES = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs') && f !== '課表熱度資料.gs')
  .sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));
const FAKE = { 一: { 1: 900, 2: 600, 3: 300, 5: 150 }, 二: { 1: 450, 3: 100 }, 三: { 2: 200 } };

/** now 是 Bot 以為的「現在」 */
function start(now) {
  const env = loadBot(FILES);
  env.run('const HEAT_SOURCE = { year: 115, term: 1 }; const HEAT_DATA = ' + JSON.stringify(FAKE) + ';');
  env.run("__real = Date; Date = class extends __real { constructor(...a) { super(...(a.length ? a : [__real.parse('" + now + "')])); } static now() { return __real.parse('" + now + "'); } }");
  return env;
}
const MON_10 = '2026-10-12T10:00:00+08:00'; // 星期一早上
const MON_20 = '2026-10-12T20:00:00+08:00'; // 星期一晚上

test('「幾點最擠」：列出今天每一節的人數，最多人的那一節標出來', () => {
  const env = start(MON_10);
  const card = env.call('memberReply_', 'A', '幾點最擠');
  const text = textOf(card);
  assert.match(text, /今天幾點最擠（星期一・外雙溪校區）/);
  assert.match(text, /★ 第 1 節 08:10：900 人/);
  assert.match(text, /・第 2 節 09:10：600 人/);
  assert.match(text, /最多人的是第 1 節（08:10）：約 900 人.*07:30～08:10 的 557 最擠/);
  assert.doesNotMatch(text, /第 4 節/, '沒有資料的節次不列');
});

test('晚上問看的是明天；也可以指定明天或星期幾', () => {
  assert.match(textOf(start(MON_20).call('heatReply_', '幾點最擠')), /明天幾點最擠（星期二/);
  assert.match(textOf(start(MON_10).call('heatReply_', '幾點最擠 明天')), /明天幾點最擠（星期二/);
  assert.match(textOf(start(MON_10).call('heatReply_', '幾點最擠 三')), /星期三幾點最擠/);
  assert.match(textOf(start(MON_10).call('heatReply_', '幾點最擠 星期三')), /星期三幾點最擠/);
});

test('那一天沒有排課資料：說明，並給其他天的按鈕', () => {
  const card = start(MON_10).call('heatReply_', '幾點最擠 四');
  assert.match(textOf(card), /沒有排課資料/);
  assert.ok(buttonsOf(card).length >= 2);
});

test('擠不擠是跟全週最高的那一格比', () => {
  const env = start(MON_10);
  assert.deepEqual([900, 600, 300, 150].map(n => env.call('heatLevel_', n)), ['很擠', '很擠', '普通', '人少']);
});

test('heatAt_：「8 點上課」算在 08:10 那一節；沒有課的時間回 null', () => {
  const env = start(MON_10);
  const at = hm => JSON.parse(JSON.stringify(env.run("heatAt_(new Date('2026-10-12T" + hm + ":00+08:00'))")));
  assert.deepEqual(at('08:00'), { count: 900, level: '很擠', period: '1' });
  assert.deepEqual(at('08:10'), { count: 900, level: '很擠', period: '1' });
  assert.equal(at('11:10'), null);
  assert.equal(at('07:00'), null);
});

test('按鈕傳出的字 Bot 都認得', () => {
  const env = start(MON_10);
  buttonsOf(env.call('heatReply_', '幾點最擠')).forEach(([, send]) => {
    assert.ok(/^出門時間/.test(send) || env.call('memberReply_', 'A', send), '不認得：' + send);
  });
});

test('出門建議會加一句這一節有多少人開始上課', () => {
  const env = start(MON_10);
  assert.match(env.run("planHeatNote_(new Date('2026-10-13T08:10:00+08:00'))")[0], /第 1 節外雙溪約有 450 人開始上課（普通）/);
  assert.match(env.run("planHeatNote_(new Date('2026-10-12T08:10:00+08:00'))")[0], /900 人開始上課（很擠）。這個時段的 557 最難擠/);
  assert.equal(env.run("planHeatNote_(new Date('2026-10-12T11:10:00+08:00'))").length, 0);
});

// ===== tools/抓課表.js 的整理規則 =====

//             部別      班級     選課編號  科目代碼   科目   組別 人數  星期  節次   週別 教室     校區      大樓
const row = (selno, count, day, section, week, room) => ['學士班', '某班', selno, 'X' + selno, '某課', '', String(count), day, section, week, room, ...place(room)];

test('教室代號：英文字母開頭是外雙溪的大樓，數字開頭是城中', () => {
  assert.deepEqual(place('D0317'), ['外雙溪', 'D']);
  assert.deepEqual(place('B408'), ['外雙溪', 'B']);
  assert.deepEqual(place('2208'), ['城中', '2']);
  assert.deepEqual(place(''), ['', '']);
  assert.deepEqual(place('0242'), ['', ''], '看不出校區的不算');
});

test('熱度：連上三節只算第一節；單雙週算一半；城中的課不算', () => {
  const h = heat([
    row('1001', 60, '一', '789', '', 'D0317'), // 第 7 節 60 人
    row('1002', 40, '一', '12', '單', 'D0101'), // 第 1 節 20 人
    row('1003', 50, '一', '12', '', '2208'),   // 城中，不算
    row('1004', 30, '二', 'AB', '', 'R0101'),  // 第 A 節 30 人
  ]);
  assert.deepEqual(h.out.slice(1), [['一', '1', '08:10', 20], ['一', '7', '15:10', 60], ['二', 'A', '18:25', 30]]);
  assert.equal(h.used, 3);
});

test('熱度：同一門課出現在兩個班級的課表裡，只算一次；沒有人數的不算', () => {
  const h = heat([
    row('2001', 70, '三', '34', '', 'D0201'),
    row('2001', 70, '三', '34', '', 'D0201'),
    row('', '', '三', '34', '', 'D0202'),
  ]);
  assert.deepEqual(h.out.slice(1), [['三', '3', '10:10', 70]]);
});

test('CSV 讀寫：科目名稱有逗號、引號也不會壞', () => {
  const rows = [['科目', '人數'], ['微積分, 進階', '60'], ['他說"你好"', '5']];
  assert.deepEqual(parseCsv(csv(rows)), rows);
});

test('認得學校系統的「連線檢查」頁面（流量太大時會回這一頁，要馬上停）', () => {
  const { isWall } = require('../tools/抓課表');
  assert.equal(isWall('<html>東吳大學校務行政資訊系統 系統偵測您使用的IP為： 1.2.3.4 連線成功後，請於 15 分鐘內登入系統 Servicecheckok</html>'), true);
  assert.equal(isWall('<table><tr><td>資一Ｂ</td><td>3724</td></tr></table>'), false);
});
