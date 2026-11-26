// 557 通勤問句解析 v1：外縣市、未完成未來時間交 Gemini，規則完整才用規則。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');
const { textOf, saidOf } = require('./helpers');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));

function freeze(env, iso) {
  env.run('const __RealDate = Date; Date = class extends __RealDate { constructor(...a) { super(...(a.length ? a : [__RealDate.parse(' + JSON.stringify(iso) + ')])); } static now() { return __RealDate.parse(' + JSON.stringify(iso) + '); } };');
}

function boot() {
  const env = loadBot(ALL);
  env.run('rainPop_ = () => 0; etaAtStop_ = () => []; tdx_ = () => [];');
  return env;
}

function replyText(ans) {
  if (typeof ans === 'string') return ans;
  return ans.altText || ans.text || textOf(ans) || JSON.stringify(ans);
}

test('AC-1: 明天下午台南 H棟 必須呼叫 Gemini（即使規則抓到 H棟）', () => {
  const env = boot();
  freeze(env, '2026-10-12T21:00:00+08:00');
  env.run('var __g = 0; parseWithGemini_ = function () { __g++; return { intent: "去學校", day: "明天", building: "H", origin: "台南", arriveTime: "" }; };');
  env.call('compareReply_', '我明天下午在H棟上課 但我現在在台南 我趕得回去嗎');
  assert.equal(env.run('__g'), 1);
});

test('AC-2: Gemini 回台南空時間 → 提到台南、建議高鐵或台鐵、無 TDX 即時卡', () => {
  const env = boot();
  freeze(env, '2026-10-12T21:00:00+08:00');
  env.run('parseWithGemini_ = function () { return { intent: "去學校", day: "明天", building: "H", origin: "台南", arriveTime: "" }; };');
  const ans = env.call('compareReply_', '我明天下午在H棟上課 但我現在在台南 我趕得回去嗎');
  const txt = replyText(ans);
  assert.match(txt, /台南/);
  assert.match(txt, /高鐵|台鐵/);
  assert.match(txt, /台北/);
  assert.doesNotMatch(txt, /TDX 即時資料/);
  assert.doesNotMatch(txt, /士林站 →/);
  assert.doesNotMatch(txt, /多路線比較/);
});

test('AC-3: 只有未來時間沒外縣市必須叫 Gemini；空時間請補；有時間走 planReply_', () => {
  const env = boot();
  freeze(env, '2026-10-12T21:00:00+08:00');
  // 空時間
  env.run('var __g = 0; parseWithGemini_ = function () { __g++; return { intent: "去學校", day: "明天", building: "H", origin: "", arriveTime: "" }; };');
  const ask = env.call('compareReply_', '明天下午在H棟上課，要幾點出門');
  assert.equal(env.run('__g'), 1);
  const askTxt = replyText(ask);
  assert.match(askTxt, /第幾節|幾點/);
  assert.doesNotMatch(askTxt, /TDX 即時資料/);
  assert.doesNotMatch(askTxt, /多路線比較/);
  // 有 arriveTime 走出門建議
  env.run('parseWithGemini_ = function () { return { intent: "去學校", day: "明天", building: "H", origin: "", arriveTime: "13:10" }; };');
  const plan = env.call('compareReply_', '明天下午在H棟上課，要幾點出門');
  assert.equal(plan.contents.header.contents[0].text, '出門建議');
  assert.match(plan.altText, /13:10/);
  assert.doesNotMatch(plan.altText, /TDX 即時資料/);
});

test('AC-4: 只有外縣市必須叫 Gemini，建議高鐵或台鐵，無士林站即時卡', () => {
  const env = boot();
  freeze(env, '2026-10-12T10:00:00+08:00');
  env.run('var __g = 0; parseWithGemini_ = function () { __g++; return { intent: "去學校", day: "未指定", building: "", origin: "台南", arriveTime: "" }; };');
  const tainan = env.call('compareReply_', '我現在在台南，要怎麼去學校');
  assert.equal(env.run('__g'), 1);
  const tTxt = replyText(tainan);
  assert.match(tTxt, /台南/);
  assert.match(tTxt, /高鐵|台鐵/);
  assert.doesNotMatch(tTxt, /TDX 即時資料/);
  assert.doesNotMatch(tTxt, /士林站 →/);

  env.run('parseWithGemini_ = function () { return { intent: "去學校", day: "未指定", building: "", origin: "高雄", arriveTime: "" }; };');
  const kaohsiung = env.call('compareReply_', '我在高雄，怎麼去東吳');
  const kTxt = replyText(kaohsiung);
  assert.match(kTxt, /高雄/);
  assert.match(kTxt, /高鐵|台鐵/);
  assert.doesNotMatch(kTxt, /TDX 即時資料/);
});

test('AC-5: 規則能完整處理的句子不呼叫 Gemini，行為與現況相同', () => {
  const env = boot();
  freeze(env, '2026-10-12T06:00:00+08:00');
  env.run('var __g = 0; parseWithGemini_ = function () { __g++; return null; };');
  // 8點在D棟：有時刻大樓，day 未指定當今天，90分鐘門檻
  const eight = env.call('compareReply_', '8點在D棟上課');
  assert.equal(env.run('__g'), 0);
  assert.equal(eight.contents.header.contents[0].text, '出門建議'); // 06:00 到 08:00 >90min
  // 明天早八
  const early = env.call('compareReply_', '明天早八 H棟 我要幾點出門');
  assert.equal(env.run('__g'), 0);
  assert.equal(early.contents.header.contents[0].text, '出門建議');
  // 劍南路站
  const jiannan = env.call('compareReply_', '我從劍南路站出發，第三節在一教');
  assert.equal(env.run('__g'), 0);
  assert.match(jiannan.altText, /劍南路站/);
  // 我現在要去學校：無未來無外縣市，士林站即時
  const nowgo = env.call('compareReply_', '我現在要去學校');
  assert.equal(env.run('__g'), 0);
  assert.match(replyText(nowgo), /士林站|多路線比較|即時/);
  // 明天第一節 D棟：不叫 Gemini
  const first = env.call('compareReply_', '明天第一節 D棟要幾點出門');
  assert.equal(env.run('__g'), 0);
  assert.equal(first.contents.header.contents[0].text, '出門建議');
});

test('AC-6: Gemini 失敗（無 key 或 null）時外縣市與未完成未來時間仍走文字退路，不出士林站即時卡', () => {
  const env = boot();
  freeze(env, '2026-10-12T21:00:00+08:00');
  // 無 key，parseWithGemini_ 回 null
  delete env.props.GEMINI_API_KEY;
  env.run('PROPS.getProperty = function(k) { return k === "GEMINI_API_KEY" ? null : null; };');
  const far = env.call('compareReply_', '我明天下午在H棟上課 但我現在在台南 我趕得回去嗎');
  const fTxt = replyText(far);
  assert.match(fTxt, /台南/);
  assert.match(fTxt, /高鐵|台鐵/);
  assert.doesNotMatch(fTxt, /TDX 即時資料/);
  assert.doesNotMatch(fTxt, /士林站 →/);
  // 未完成未來時間
  const inc = env.call('compareReply_', '明天下午在H棟上課，要幾點出門');
  const iTxt = replyText(inc);
  assert.match(iTxt, /第幾節|幾點/);
  assert.doesNotMatch(iTxt, /TDX 即時資料/);
  // AC-5 句子仍用規則（另開環境避免時鐘衝突）
  const env2 = boot();
  freeze(env2, '2026-10-12T06:00:00+08:00');
  env2.run('var __g = 0; parseWithGemini_ = function () { __g++; return null; };');
  const normal = env2.call('compareReply_', '8點在D棟上課');
  assert.equal(env2.run('__g'), 0);
  assert.equal(normal.contents.header.contents[0].text, '出門建議');
});

test('AC-7: parseWithGemini_ prompt/schema 不再限死 origin 三站，時段無時刻 arriveTime 留空', () => {
  const env = boot();
  env.props.GEMINI_API_KEY = 'test-key-not-printed';
  // 攔截：讓 fetch 回非 200，但 payload 已記錄
  env.onFetch = (url) => url.includes('generativelanguage') ? { code: 400, body: {} } : null;
  env.call('parseWithGemini_', '明天下午在H棟');
  const fetch = env.fetches.find(f => f.url.includes('generativelanguage'));
  assert.ok(fetch, '應有呼叫 Gemini');
  const payload = fetch.body || JSON.parse(fetch.options.payload);
  const prompt = payload.systemInstruction.parts[0].text;
  assert.match(prompt, /台南|高雄/);
  assert.doesNotMatch(prompt, /出發地只能是：士林站、劍南路站、大直站/);
  assert.match(prompt, /arriveTime 必須留空|不准猜節次/);
  const schema = payload.generationConfig.responseSchema;
  assert.equal(schema.properties.origin.type, 'STRING');
  assert.equal(schema.properties.origin.enum, undefined);
  // 金鑰只在 header，測試不印出、不保存值
});

test('AC-9 相關：選單出門時間 … 火星 仍當士林站（既有行為）', () => {
  const env = boot();
  freeze(env, '2026-10-17T12:00:00+08:00');
  const card = env.call('menuFlow_', '出門時間 明天 08:10 D 火星');
  assert.equal(card.contents.header.contents[1].text, '明天 08:10 上課');
  assert.match(card.altText, /士林站|搭 557/);
});

test('B-1: 後天第一節必須交 Gemini 或請改用今天明天，不當今天', () => {
  const env = boot();
  freeze(env, '2026-10-12T21:00:00+08:00');
  env.run('var __g = 0; parseWithGemini_ = function () { __g++; return null; };');
  const ans = env.call('compareReply_', '後天第一節 D棟要幾點出門');
  assert.equal(env.run('__g'), 1);
  const txt = replyText(ans);
  assert.match(txt, /今天|明天|出門時間|後天/);
  assert.doesNotMatch(txt, /今天 08:10/);
  assert.doesNotMatch(txt, /TDX 即時資料/);
  assert.doesNotMatch(txt, /多路線比較/);
});

test('B-1: 星期三 8點 必須交 Gemini 或請改用今天明天，不當今天', () => {
  const env = boot();
  freeze(env, '2026-10-12T21:00:00+08:00');
  env.run('var __g = 0; parseWithGemini_ = function () { __g++; return null; };');
  const ans = env.call('compareReply_', '星期三 8 點在 D 棟上課');
  assert.equal(env.run('__g'), 1);
  const txt = replyText(ans);
  assert.match(txt, /今天|明天|出門時間/);
  assert.doesNotMatch(txt, /今天 08:00/);
  assert.doesNotMatch(txt, /TDX 即時資料/);
});

test('B-2: Gemini 回 origin=台南市 仍走外縣市，不出士林站即時卡', () => {
  const env = boot();
  freeze(env, '2026-10-12T21:00:00+08:00');
  env.run('parseWithGemini_ = function () { return { intent: "去學校", day: "明天", building: "H", origin: "台南市", arriveTime: "" }; };');
  const ans = env.call('compareReply_', '我現在在台南，要怎麼去學校');
  const txt = replyText(ans);
  assert.match(txt, /台南/);
  assert.match(txt, /高鐵|台鐵/);
  assert.doesNotMatch(txt, /TDX 即時資料/);
  assert.doesNotMatch(txt, /士林站 →/);
  assert.doesNotMatch(txt, /多路線比較/);
});

test('B-2: Gemini 回 origin="" 時規則遠距優先，不出士林站即時卡', () => {
  const env = boot();
  freeze(env, '2026-10-12T21:00:00+08:00');
  env.run('parseWithGemini_ = function () { return { intent: "去學校", day: "未指定", building: "", origin: "", arriveTime: "" }; };');
  const ans = env.call('compareReply_', '我現在在台南，要怎麼去學校');
  const txt = replyText(ans);
  assert.match(txt, /台南/);
  assert.match(txt, /高鐵|台鐵/);
  assert.doesNotMatch(txt, /TDX 即時資料/);
  assert.doesNotMatch(txt, /士林站 →/);
  assert.doesNotMatch(txt, /多路線比較/);
});

function seedCalendar(env) {
  const csv = fs.readFileSync(path.join(__dirname, '..', 'bot', '行事曆.csv'), 'utf8').replace(/^\uFEFF/, '').trim();
  const sheet = env.run("SpreadsheetApp.getActiveSpreadsheet().insertSheet('行事曆')");
  csv.split(/\r?\n/).forEach(line => sheet.appendRow(line.split(',')));
}

test('B-1\'(a): Gemini 回 day=今天 時規則後天仍強制保留，不當今天規劃', () => {
  const env = boot();
  freeze(env, '2026-10-12T21:00:00+08:00');
  env.run('parseWithGemini_ = function () { return { intent: "去學校", day: "今天", building: "D", origin: "", arriveTime: "08:10" }; };');
  const ans = env.call('compareReply_', '後天第一節 D棟要幾點出門');
  const txt = replyText(ans);
  assert.match(txt, /今天|明天|出門時間|後天/);
  assert.doesNotMatch(txt, /今天 08:10/);
  assert.doesNotMatch(txt, /TDX 即時資料/);
  assert.doesNotMatch(txt, /多路線比較/);
});

test('B-1\'(b): 今天放假日時問後天不得回這天不用上學', () => {
  const env = boot();
  seedCalendar(env);
  freeze(env, '2026-11-28T10:00:00+08:00'); // 選舉投票日
  env.run('parseWithGemini_ = function () { return null; };');
  const ans = env.call('compareReply_', '後天第一節 D棟要幾點出門');
  const txt = replyText(ans);
  assert.doesNotMatch(txt, /這天不用上學/);
  assert.match(txt, /今天|明天|出門時間|後天/);
});
