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
// 每一格：[至少到校, 開始上課, 上課中, 下課後至少離校]
const FAKE = {
  一: { 1: [900, 900, 900, 0], 2: [50, 50, 950, 0], 3: [600, 1500, 1550, 0], 4: [0, 0, 1550, 300], 5: [300, 1200, 1250, 0], 8: [0, 0, 1000, 700], 9: [0, 0, 300, 300] },
  二: { 1: [450, 450, 450, 0], 3: [150, 800, 800, 600] },
  三: { 2: [200, 200, 200, 200] },
};

/** now 是 Bot 以為的「現在」 */
function start(now) {
  const env = loadBot(FILES);
  env.run('const HEAT_SOURCE = { year: 115, term: 1, count: "實際選課人數" }; const HEAT_DATA = ' + JSON.stringify(FAKE) + ';');
  env.run("__real = Date; Date = class extends __real { constructor(...a) { super(...(a.length ? a : [__real.parse('" + now + "')])); } static now() { return __real.parse('" + now + "'); } }");
  return env;
}
const MON_10 = '2026-10-12T10:00:00+08:00'; // 星期一早上
const MON_20 = '2026-10-12T20:00:00+08:00'; // 星期一晚上

test('「幾點最擠」：列出今天每一節至少多少人到校，最多的那一節標出來', () => {
  const env = start(MON_10);
  const text = textOf(env.call('memberReply_', 'A', '幾點最擠'));
  assert.match(text, /今天幾點最擠（星期一・外雙溪校區）/);
  assert.match(text, /★ 第 1 節 08:10：至少 900 人到校/);
  assert.match(text, /・第 3 節 10:10：至少 600 人到校\n.*共 1500 人開始上課/);
  assert.match(text, /去學校：07:30～08:10 最擠，至少 900 人要在第 1 節前到校/);
  assert.match(text, /回士林：第 8 節下課（17:00）後最擠，至少 700 人離校/);
  assert.doesNotMatch(text, /第 2 節/, '到校不到 100 人的節次不列');
  assert.doesNotMatch(text, /第 4 節/);
});

test('晚上問看的是明天；也可以指定明天或星期幾', () => {
  assert.match(textOf(start(MON_20).call('heatReply_', '幾點最擠')), /明天幾點最擠（星期二/);
  assert.match(textOf(start(MON_10).call('heatReply_', '幾點最擠 明天')), /明天幾點最擠（星期二/);
  assert.match(textOf(start(MON_10).call('heatReply_', '幾點最擠 三')), /星期三幾點最擠/);
  assert.match(textOf(start(MON_10).call('heatReply_', '幾點最擠 星期三')), /星期三幾點最擠/);
});

test('那一天幾乎沒有排課：說明，並給其他天的按鈕', () => {
  const card = start(MON_10).call('heatReply_', '幾點最擠 四');
  assert.match(textOf(card), /幾乎沒有排課/);
  assert.ok(buttonsOf(card).length >= 2);
});

test('擠不擠是跟全週到校最多的那一格比', () => {
  const env = start(MON_10);
  assert.deepEqual([900, 600, 300, 150].map(n => env.call('heatLevel_', n)), ['很擠', '很擠', '普通', '人少']);
});

test('heatAt_：「8 點上課」算在 08:10 那一節；沒有課、或沒什麼人到校的時間回 null', () => {
  const env = start(MON_10);
  const at = hm => JSON.parse(JSON.stringify(env.run("heatAt_(new Date('2026-10-12T" + hm + ":00+08:00'))")));
  assert.deepEqual(at('08:00'), { arrive: 900, starts: 900, level: '很擠', period: '1' });
  assert.deepEqual(at('08:10'), { arrive: 900, starts: 900, level: '很擠', period: '1' });
  assert.equal(at('09:10'), null, '只有 50 人到校');
  assert.equal(at('11:10'), null);
  assert.equal(at('07:00'), null);
});

test('按鈕傳出的字 Bot 都認得', () => {
  const env = start(MON_10);
  buttonsOf(env.call('heatReply_', '幾點最擠')).forEach(([, send]) => {
    assert.ok(/^出門時間/.test(send) || env.call('memberReply_', 'A', send), '不認得：' + send);
  });
});

test('出門建議會加一句這一節前至少多少人要到校', () => {
  const env = start(MON_10);
  assert.match(env.run("planHeatNote_(new Date('2026-10-13T08:10:00+08:00'))")[0], /第 1 節前至少有 450 人要到外雙溪（普通）/);
  assert.match(env.run("planHeatNote_(new Date('2026-10-12T08:10:00+08:00'))")[0], /至少有 900 人要到外雙溪（很擠）。這個時段的 557 最難擠/);
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
  // 欄位：星期、節次、上課時間、開始上課、上課中、至少到校、下課後至少離校
  assert.deepEqual(h.out.slice(1), [
    ['一', '1', '08:10', 20, 20, 20, 0], ['一', '2', '09:10', 0, 20, 0, 20],
    ['一', '7', '15:10', 60, 60, 60, 0], ['一', '8', '16:10', 0, 60, 0, 0], ['一', '9', '17:10', 0, 60, 0, 60],
    ['二', 'A', '18:25', 30, 30, 30, 0], ['二', 'B', '19:20', 0, 30, 0, 30],
  ]);
  assert.equal(h.used, 3);
});

test('熱度：同一門課出現在兩個班級的課表裡，只算一次；沒有人數的不算', () => {
  const h = heat([
    row('2001', 70, '三', '34', '', 'D0201'),
    row('2001', 70, '三', '34', '', 'D0201'),
    row('', '', '三', '34', '', 'D0202'),
  ]);
  assert.deepEqual(h.out.slice(1), [['三', '3', '10:10', 70, 70, 70, 0], ['三', '4', '11:10', 0, 70, 0, 70]]);
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

test('併入實際選課人數：用選課編號對，熱度改用實際人數；對不到的不算', () => {
  const { mergeEnroll } = require('../tools/抓課表');
  const m = mergeEnroll([
    row('7011', 60, '一', '12', '', 'V104'), // 上限 60，實際 33
    row('', '', '二', '12', '', 'D0242'),    // 沒有選課編號的佔位課程
  ], [['7011', 'BPE36401', '60', '33', '溪體育一']]);
  assert.deepEqual([m.matched, m.missing], [1, 1]);
  assert.equal(m.rows[0][13], '33');
  assert.equal(m.rows[1][13], '');
  assert.deepEqual(heat(m.rows).out.slice(1), [['一', '1', '08:10', 33, 33, 33, 0], ['一', '2', '09:10', 0, 33, 0, 33]]);
});

test('熱度：午休不算離校再到校；早八上完十點才來的人要算到校', () => {
  const h = heat([
    row('3001', 100, '四', '34', '', 'D0101'), // 上午 100 人
    row('3002', 100, '四', '56', '', 'D0101'), // 下午 100 人（同一批人吃完飯回來，不算到校）
    row('3003', 40, '四', '12', '', 'D0102'),  // 早八 40 人，十點下課
  ]);
  const cell = p => h.out.find(r => r[0] === '四' && r[1] === p);
  assert.deepEqual(cell('1').slice(3), [40, 40, 40, 0]);
  assert.deepEqual(cell('3').slice(3), [100, 100, 60, 0], '第 3 節：上課中從 40 變 100，至少 60 人到校');
  assert.deepEqual(cell('4').slice(3), [0, 100, 0, 0], '中午不算離校');
  assert.deepEqual(cell('5').slice(3), [100, 100, 0, 0], '吃完飯回來不算到校');
  assert.deepEqual(cell('6').slice(3), [0, 100, 0, 100]);
});
