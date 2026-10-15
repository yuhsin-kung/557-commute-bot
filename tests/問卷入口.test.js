// 問卷入口（bot/問卷入口.gs）：A／B／C 分層分配。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBot } = require('./gas-env');

const FILES = ['Code.gs', '卡片.gs', '共乘.gs', '問卷入口.gs'];
const GRADES = ['大一', '大二', '大三', '大四', '碩博士班'];
const ID = { A: 'formA_aaaaaaaaaaaaaaaaaaaa', B: 'formB_bbbbbbbbbbbbbbbbbbbb', C: 'formC_cccccccccccccccccccc' };
const repeat = (g, n) => Array(n).fill(g);

function start(answers = { A: [], B: [], C: [] }) {
  const env = loadBot(FILES, {
    SURVEY_A: 'https://docs.google.com/forms/d/' + ID.A + '/edit',
    SURVEY_B: 'https://docs.google.com/forms/d/' + ID.B + '/viewform',
    SURVEY_C: ID.C,
  });
  env.setNow('2026-10-15T12:00:00+08:00');
  for (const v of ['A', 'B', 'C']) env.surveys[ID[v]] = { title: v + ' 版', grades: GRADES, answers: answers[v] };
  return env;
}
const pick = (env, grade) => JSON.parse(JSON.stringify(env.call('surveyPick', grade)));
const versionOf = url => Object.keys(ID).find(v => url.includes(ID[v]));

test('表單網址：編輯網址、填寫網址、只有 ID 都讀得到', () => {
  const env = start();
  assert.equal(env.call('svFormId_', 'https://docs.google.com/forms/d/' + ID.A + '/edit'), ID.A);
  assert.equal(env.call('svFormId_', ID.C), ID.C);
  assert.equal(env.call('svFormId_', 'https://example.com'), '');
});

test('送到這個年級人數最少的版本，網址裡年級已經填好', () => {
  // 現在的實際情況：大二 A 31、B 3、C 23
  const env = start({ A: repeat('大二', 31), B: repeat('大二', 3), C: repeat('大二', 23) });
  const r = pick(env, '大二');
  assert.equal(r.ok, true);
  assert.equal(versionOf(r.url), 'B');
  assert.ok(r.url.endsWith('entry.1=' + encodeURIComponent('大二')));
  const log = env.sheets['問卷分流'].rows;
  assert.deepEqual(JSON.parse(JSON.stringify(log[1].slice(1))), ['大二', 'B', '31／3／23']);
});

test('每個年級分開算：大一少的版本和大二少的版本不一樣', () => {
  const env = start({ A: repeat('大一', 1).concat(repeat('大二', 31)), B: repeat('大一', 7).concat(repeat('大二', 3)), C: repeat('大一', 7).concat(repeat('大二', 23)) });
  assert.equal(versionOf(pick(env, '大一').url), 'A');
  assert.equal(versionOf(pick(env, '大二').url), 'B');
});

test('剛分配出去還沒交卷的也算進去：連續 9 個人會平均分到三版', () => {
  const env = start();
  const got = { A: 0, B: 0, C: 0 };
  for (let i = 0; i < 9; i++) got[versionOf(pick(env, '大三').url)] += 1;
  assert.deepEqual(got, { A: 3, B: 3, C: 3 });
});

test('超過 20 分鐘還沒交卷的就不算了', () => {
  const env = start({ A: [], B: ['大四'], C: ['大四'] });
  assert.equal(versionOf(pick(env, '大四').url), 'A'); // A 0 → 1（還在填）
  env.addMinutes(21);
  assert.equal(versionOf(pick(env, '大四').url), 'A'); // 剛剛那個人沒交，A 又是 0
});

test('一樣少的時候隨機，不會每次都是 A', () => {
  const seen = new Set();
  for (let i = 0; i < 30; i++) seen.add(versionOf(pick(start(), '大一').url));
  assert.equal(seen.size, 3);
});

test('年級只收表單上有的選項', () => {
  const env = start();
  const r = pick(env, '<script>');
  assert.equal(r.ok, false);
  assert.equal(r.url, undefined);
  assert.equal(env.sheets['問卷分流'], undefined);
});

test('還沒設定三份表單：不會壞，告訴同學還沒好', () => {
  const env = loadBot(FILES, { SURVEY_A: ID.A });
  const r = pick(env, '大一');
  assert.equal(r.ok, false);
  assert.match(r.message, /還沒設定/);
  const page = env.call('doGet', { parameter: { page: 'survey' } });
  assert.ok(page.content.includes('var GRADES = [];'));
});

test('doGet page=survey：網頁帶著年級選項，程式語法正確，不用會被擋掉的跳出視窗', () => {
  const env = start();
  const page = env.call('doGet', { parameter: { page: 'survey' } });
  assert.equal(page.title, '東吳外雙溪通勤問卷');
  assert.equal(page.content.includes('__'), false);
  const script = page.content.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.ok(script.includes('var GRADES = ' + JSON.stringify(GRADES)));
  assert.doesNotThrow(() => new Function('document', 'google', script));
  assert.equal(/\b(confirm|alert|prompt)\s*\(/.test(script), false);
});
