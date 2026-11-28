// 出門脈絡（bot/校務脈絡.gs）：放假、考試週、活動／停課、步行估計、沒說大樓不編造。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');
const { buttonsOf } = require('./helpers');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));

function seedCalendar(env) {
  const csv = fs.readFileSync(path.join(__dirname, '..', 'bot', '行事曆.csv'), 'utf8').replace(/^\uFEFF/, '').trim();
  const sheet = env.run("SpreadsheetApp.getActiveSpreadsheet().insertSheet('行事曆')");
  csv.split(/\r?\n/).forEach(line => sheet.appendRow(line.split(',')));
}

function freeze(env, iso) {
  env.run('const __RealDate = Date; Date = class extends __RealDate { constructor(...a) { super(...(a.length ? a : [__RealDate.parse(' + JSON.stringify(iso) + ')])); } static now() { return __RealDate.parse(' + JSON.stringify(iso) + '); } };');
}

function boot() {
  const env = loadBot(ALL);
  seedCalendar(env);
  env.run('rainPop_ = () => 0;');
  return env;
}

const plainCtx = (env, query) => JSON.parse(JSON.stringify(env.call('classContext_', query)));

function departMin(card) {
  const m = card.altText.match(/搭 557 進校園：(\d\d):(\d\d)/);
  assert.ok(m, card.altText);
  return Number(m[1]) * 60 + Number(m[2]);
}

test('放假日回不用上學，且不出門建議卡（2026-11-28 選舉投票日）', () => {
  const env = boot();
  const ctx = plainCtx(env, { date: '2026-11-28', arriveTime: '08:10', building: 'D' });
  assert.equal(ctx.found, true);
  assert.equal(ctx.holiday, true);
  assert.equal(ctx.exam, false);
  assert.equal(ctx.eventName, '選舉投票日');
  assert.equal(ctx.date, '2026-11-28');
  assert.equal(ctx.time, '08:10');
  assert.match(ctx.message, /這天不用上學/);
  assert.ok(ctx.sources.some(s => s.table === '行事曆' && s.name === '選舉投票日' && s.date === '2026-11-28'));
  assert.equal(plainCtx(env, { date: '2026-11-27', arriveTime: '08:10' }).holiday, false);
  assert.equal(plainCtx(env, { date: '2026-11-29', arriveTime: '08:10' }).holiday, false);

  freeze(env, '2026-11-27T21:00:00+08:00');
  ['出門時間 明天 08:10', '出門時間 明天 08:10 D', '出門時間 明天 08:10 不指定'].forEach(text => {
    const ans = env.call('menuFlow_', text);
    assert.equal(typeof ans, 'string', text);
    assert.match(ans, /這天不用上學/);
    assert.match(ans, /選舉投票日/);
    assert.match(ans, /2026-11-28/);
    assert.match(ans, /行事曆：選舉投票日/);
    assert.doesNotMatch(ans, /出門建議|搭 557/);
  });
  const oral = env.call('compareReply_', '明天第一節 D棟要幾點出門');
  assert.equal(typeof oral, 'string');
  assert.match(oral, /這天不用上學/);
  assert.match(oral, /選舉投票日/);
  assert.doesNotMatch(oral, /在哪一棟|搭 557/);
});

test('考試週仍出建議卡，多留 20 分鐘，並附行事曆與步行來源', () => {
  const env = boot();
  const ctx = plainCtx(env, { date: '2026-11-10', arriveTime: '08:10', building: 'D' });
  assert.equal(ctx.holiday, false);
  assert.equal(ctx.exam, true);
  assert.equal(ctx.eventName, '期中考試');
  assert.equal(ctx.walkMin, 3);
  assert.equal(plainCtx(env, { date: '2026-11-09', arriveTime: '08:10' }).exam, true);
  assert.equal(plainCtx(env, { date: '2026-11-14', arriveTime: '08:10' }).exam, true);
  assert.equal(plainCtx(env, { date: '2026-11-08', arriveTime: '08:10' }).exam, false);
  assert.equal(plainCtx(env, { date: '2026-11-15', arriveTime: '08:10' }).exam, false);

  const examCard = env.call('planReply_', '士林站', 'D', new Date('2026-11-10T08:10:00+08:00'), true);
  const normalCard = env.call('planReply_', '士林站', 'D', new Date('2026-10-13T08:10:00+08:00'), true);
  assert.equal(examCard.contents.header.contents[0].text, '出門建議');
  // 557 改用監測預測倒推：到校目標提早 20 分鐘，但早一點的時段車比較快、比較不用排，出門不一定剛好早 20 分鐘
  assert.ok(departMin(normalCard) - departMin(examCard) > 0, '考試週要比較早出門');
  assert.match(examCard.altText, /已多算 20 分鐘/);
  assert.match(examCard.altText, /行事曆：期中考試/);
  assert.match(examCard.altText, /步行：校園大樓表（估計）/);
  assert.doesNotMatch(examCard.altText, /實測/);
  assert.doesNotMatch(normalCard.altText, /行事曆：/);
  assert.deepEqual(buttonsOf(examCard).map(b => b[0]), ['用我的位置算幾點出門', '換一個時間', '改從其他捷運站出發', '預約計程車共乘', '557 發車前提醒我']);

  freeze(env, '2026-11-09T21:00:00+08:00');
  const viaMenu = env.call('menuFlow_', '出門時間 明天 08:10 D');
  assert.equal(viaMenu.contents.header.contents[0].text, '出門建議');
  assert.match(viaMenu.altText, /行事曆：期中考試/);
  assert.match(viaMenu.altText, /步行：校園大樓表（估計）/);
  assert.match(viaMenu.altText, /已多算 20 分鐘/);
  // 考試週但沒說大樓：先問棟別，不編教室、也不略過選棟
  const ask = env.call('compareReply_', '明天第一節要幾點出門');
  assert.match(ask.altText, /在哪一棟上課/);
  assert.notEqual(ask.contents.header.contents[0].text, '出門建議');
});

test('活動／停課日不當放假（2027-03-20 校慶典禮暨運動大會）', () => {
  const env = boot();
  const ctx = plainCtx(env, { date: '2027-03-20', arriveTime: '08:10', building: 'D' });
  assert.equal(ctx.holiday, false);
  assert.equal(ctx.exam, false);
  assert.equal(ctx.eventType, '');
  assert.equal(ctx.walkMin, 3);
  assert.equal(env.call('crowdExtra_', new Date('2027-03-20T08:10:00+08:00')).min, 0);

  freeze(env, '2027-03-19T21:00:00+08:00');
  const card = env.call('menuFlow_', '出門時間 明天 08:10 D');
  assert.equal(card.type, 'flex');
  assert.equal(card.contents.header.contents[0].text, '出門建議');
  assert.doesNotMatch(card.altText, /不用上學/);
  assert.doesNotMatch(card.altText, /行事曆：/);
  assert.match(card.altText, /步行：校園大樓表（估計）/);
});

test('已知大樓才填步行分鐘；沒提供、或不在表上就不編', () => {
  const env = boot();
  const d = plainCtx(env, { date: '2026-10-13', arriveTime: '08:10', building: 'D' });
  assert.equal(d.found, true);
  assert.equal(d.building, 'D');
  assert.equal(d.buildingName, '第二教學研究大樓');
  assert.equal(d.classroom, '');
  assert.equal(d.walkMin, 3);
  assert.ok(d.sources.some(s => s.table === '校園大樓表' && s.walkMin === 3 && s.note === '估計'));
  assert.equal(plainCtx(env, { date: '2026-10-13', arriveTime: '08:10', building: 'A' }).walkMin, 1);
  assert.equal(plainCtx(env, { date: '2026-10-13', period: '1', building: 'H' }).time, '08:10');
  assert.equal(plainCtx(env, { date: '2026-10-13', period: '1', building: 'H' }).walkMin, 5);

  const none = plainCtx(env, { date: '2026-10-13', arriveTime: '08:10' });
  assert.equal(none.building, '');
  assert.equal(none.buildingName, '');
  assert.equal(none.classroom, '');
  assert.equal(none.walkMin, null);
  const unknown = plainCtx(env, { date: '2026-10-13', arriveTime: '08:10', building: 'Z' });
  assert.equal(unknown.building, '');
  assert.equal(unknown.classroom, '');
  assert.equal(unknown.walkMin, null);
});

test('沒說大樓不編造教室，改問在哪一棟；選了不指定才给出門建議', () => {
  const env = boot();
  freeze(env, '2026-10-12T21:00:00+08:00');
  const ctx = plainCtx(env, { text: '明天第一節要幾點出門' });
  assert.equal(ctx.date, '2026-10-13');
  assert.equal(ctx.time, '08:10');
  assert.equal(ctx.building, '');
  assert.equal(ctx.buildingName, '');
  assert.equal(ctx.classroom, '');
  assert.equal(ctx.walkMin, null);
  assert.equal(ctx.holiday, false);

  const ask = env.call('compareReply_', '明天第一節要幾點出門');
  assert.match(ask.altText, /你在哪一棟上課/);
  assert.notEqual(ask.contents.header.contents[0].text, '出門建議');
  assert.doesNotMatch(ask.altText, /第二教學研究大樓|寵惠堂/);

  const any = env.call('menuFlow_', '出門時間 明天 09:10 不指定');
  assert.equal(any.contents.header.contents[0].text, '出門建議');
  assert.equal(any.contents.header.contents.length, 2, '不指定大樓就沒有副標');
  assert.doesNotMatch(any.altText, /步行：校園大樓表/);
  assert.doesNotMatch(any.altText, /第二教學研究大樓/);
});

test('口頭說了出發站但沒說大樓：選棟與不指定都帶原站，建議卡不退回士林站', () => {
  const env = boot();
  freeze(env, '2026-10-12T21:00:00+08:00'); // 明天 2026-10-13（週二），不是放假日
  const ask = env.call('compareReply_', '從劍南路站明天 8:10 上課');
  assert.match(ask.altText, /你在哪一棟上課/);
  const buttons = buttonsOf(ask);
  assert.ok(buttons.length >= 13);
  buttons.forEach(([, text]) => assert.match(text, /劍南路站/, text));
  const building = buttons.find(([, text]) => text === '出門時間 明天 08:10 D 劍南路站');
  assert.ok(building, buttons.map(b => b[1]).join('、'));
  const skip = buttons.find(b => b[0] === '不指定');
  assert.equal(skip[1], '出門時間 明天 08:10 不指定 劍南路站');

  const card = env.call('menuFlow_', building[1]);
  assert.equal(card.contents.header.contents[0].text, '出門建議');
  assert.match(card.altText, /★ 捷運劍南路站：\d\d:\d\d 前到站/);
  assert.doesNotMatch(card.altText, /到士林站|搭 557 進校園/);

  const any = env.call('menuFlow_', skip[1]);
  assert.equal(any.contents.header.contents[0].text, '出門建議');
  assert.match(any.altText, /★ 捷運劍南路站：\d\d:\d\d 前到站/);
  assert.doesNotMatch(any.altText, /到士林站|搭 557 進校園/);
});

test('查不到上課日就明確說找不到，不編節次或教室', () => {
  const env = boot();
  const miss = plainCtx(env, {});
  assert.equal(miss.found, false);
  assert.match(miss.message, /找不到/);
  assert.equal(miss.date, '');
  assert.equal(miss.time, '');
  assert.equal(miss.building, '');
  assert.equal(miss.classroom, '');
  assert.equal(miss.holiday, false);
  assert.equal(miss.exam, false);
  const junk = plainCtx(env, { text: '今天好累' });
  assert.equal(junk.found, false);
  assert.match(junk.message, /找不到/);
  assert.equal(junk.time, '');
  assert.equal(junk.classroom, '');
});

test('classContext_ 不呼叫 Gemini、不讀金鑰，也不記下識別碼或問句', () => {
  const env = boot();
  env.props.GEMINI_API_KEY = 'fake-key';
  env.run('var __g = 0; var __keys = [];'
    + 'parseWithGemini_ = function () { __g++; return { intent: "去學校", arriveTime: "08:10", building: "D", day: "明天", origin: "" }; };'
    + 'var __get = PROPS.getProperty; PROPS.getProperty = function (k) { __keys.push(k); return __get.call(this, k); };');
  const ctx = plainCtx(env, {
    text: '明天第一節要幾點出門呀',
    day: '明天',
    arriveTime: '08:10',
    building: 'D',
    userId: 'U123456',
    latitude: 25.09,
    longitude: 121.54,
  });
  env.call('classContext_', { date: '2026-11-28' });
  assert.equal(env.run('__g'), 0);
  assert.equal(env.run('__keys.length'), 0);
  assert.equal(env.fetches.some(f => /generativelanguage|googleapis|gemini/i.test(f.url)), false);
  assert.equal(JSON.stringify(ctx).includes('U123456'), false);
  assert.equal(JSON.stringify(ctx).includes('25.09'), false);
  assert.equal(JSON.stringify(ctx).includes('要幾點出門呀'), false);
  assert.equal(JSON.stringify(env.sheets).includes('U123456'), false);
});

test('規則看不懂的句子只讓 Gemini 解析日期節次大樓，再交給 classContext_', () => {
  const env = boot();
  freeze(env, '2026-11-09T21:00:00+08:00');
  env.run('var __g = 0; parseWithGemini_ = function () { __g++; return { intent: "去學校", arriveTime: "08:10", building: "D", day: "明天", origin: "" }; };');
  const card = env.call('compareReply_', '明早那堂課我想抓個時間');
  assert.equal(env.run('__g'), 1);
  assert.equal(card.contents.header.contents[0].text, '出門建議');
  assert.match(card.altText, /行事曆：期中考試/);
  assert.match(card.altText, /步行：校園大樓表（估計）/);
  assert.equal(env.fetches.some(f => /generativelanguage|gemini/i.test(f.url)), false);
});

test('股票等非校務問題不送進校務查詢', () => {
  const env = boot();
  env.run('var __c = 0; var __cc = classContext_; classContext_ = function (q) { __c++; return __cc(q); };');
  const ans = env.call('route_', '台積電今天股價多少');
  assert.equal(env.run('__c'), 0);
  assert.match(JSON.stringify(ans), /看不太懂/);
  assert.doesNotMatch(JSON.stringify(ans), /行事曆|不用上學/);
});
