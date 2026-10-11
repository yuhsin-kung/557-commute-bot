// 問卷表單（bot/問卷表單.gs）要跟「問卷題目.md」一模一樣。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');

const DOC = fs.readFileSync(path.join(__dirname, '..', '問卷題目.md'), 'utf8');

/** 從「問卷題目.md」讀出某一份問卷的題目和選項 */
function questionsInDoc(from, to) {
  const part = DOC.slice(DOC.indexOf(from), to ? DOC.indexOf(to) : undefined);
  return part.split('\n').filter(l => /^\d+\. \*\*/.test(l)).map(line => {
    const m = line.match(/^\d+\. \*\*(.+?)\*\*(.*)$/);
    const colon = m[2].indexOf('：');
    return { title: m[1], choices: colon < 0 ? [] : m[2].slice(colon + 1).split('／').map(c => c.trim()) };
  });
}

function build(fn) {
  const env = loadBot(['問卷表單.gs']);
  env.call(fn);
  const form = JSON.parse(JSON.stringify(env.forms[0])); // Bot 環境裡的陣列跟這裡的不是同一種，轉一次才能比
  return { env, form, questions: form.items.filter(i => !['header', 'page'].includes(i.type)) };
}

function assertSameAsDoc(questions, doc) {
  assert.equal(questions.length, doc.length, '題數');
  doc.forEach((d, i) => {
    const q = questions[i];
    // 文件裡寫在題目後面的補充說明，表單放在題目下面的小字
    assert.ok(d.title.startsWith(q.title), `第 ${i + 1} 題題目：「${q.title}」 vs 文件「${d.title}」`);
    if (d.title !== q.title) assert.ok(q.help && d.title.endsWith(q.help), `第 ${i + 1} 題的補充說明要在小字裡`);
    const choices = (q.choices || []).concat(q.other ? ['其他'] : []);
    // 表單的「其他」固定排最後，所以只比內容、不比順序
    assert.deepEqual(choices.slice().sort(), d.choices.slice().sort(), `第 ${i + 1} 題「${q.title}」的選項`);
  });
}

test('通勤問卷：21 題，題目和選項跟問卷題目.md 一樣', () => {
  const { questions } = build('建立通勤問卷');
  const doc = questionsInDoc('## ① 通勤基本問卷', '## ② 使用後回饋');
  assert.equal(doc.length, 21);
  assertSameAsDoc(questions, doc);
});

test('通勤問卷：單選、複選、必填跟文件一致', () => {
  const { questions } = build('建立通勤問卷');
  const many = questions.filter(q => q.type === 'many').map(q => q.title);
  assert.deepEqual(many, ['你通常怎麼到學校？', '下雨天你的通勤方式會改變嗎？', '不想騎的原因是？', '包車你需要哪些時段？']);
  const optional = questions.filter(q => !q.required).map(q => q.title);
  assert.deepEqual(optional, ['包車你需要哪些時段？', '對 557 通勤有什麼想說的？']);
});

test('通勤問卷：YouBike 選「天氣好才會」「不願意」才會問原因', () => {
  const { form } = build('建立通勤問卷');
  const titles = form.items.map(i => i.title);
  const youbike = form.items.find(i => i.title === '你願意騎 YouBike（電輔車）上學嗎？');
  assert.deepEqual(youbike.choices, ['願意', '天氣好才會', '校內有車可以還才會', '不願意']);
  assert.deepEqual(youbike.goTo, ['557 以外的選擇', 'YouBike', '557 以外的選擇', 'YouBike']);

  const whyPage = form.items.findIndex(i => i.type === 'page' && i.title === 'YouBike');
  assert.equal(titles[whyPage - 1], youbike.title, 'YouBike 那題要是這一頁的最後一題，跳頁才會生效');
  assert.equal(titles[whyPage + 1], '不想騎的原因是？');
  assert.equal(form.items[whyPage + 2].type, 'page', '原因那一頁只有一題');
  assert.equal(form.items[whyPage + 2].title, '557 以外的選擇');
});

test('兩份問卷都匿名，答案存進試算表，送出後的訊息正確', () => {
  const a = build('建立通勤問卷').form;
  assert.equal(a.settings.collectEmail, false);
  assert.equal(a.settings.destination, 'TEST-SHEET');
  assert.match(a.settings.confirmation, /https:\/\/line\.me\/R\/ti\/p\/%40311zktcn$/);
  assert.match(a.settings.description, /問卷匿名，不會收集姓名或學號/);

  const b = build('建立回饋問卷').form;
  assert.equal(b.settings.collectEmail, false);
  assert.equal(b.settings.destination, 'TEST-SHEET');
  const all = JSON.stringify([a, b]);
  assert.equal(/姓名[^或]|學號[^，]|LINE ID|電話|信箱/.test(all.replace(/不會收集姓名或學號/g, '')), false, '不能問個資');
});

test('回饋問卷：9 題，題目和選項跟問卷題目.md 一樣，分數題的範圍正確', () => {
  const { questions } = build('建立回饋問卷');
  const doc = questionsInDoc('## ② 使用後回饋');
  assert.equal(doc.length, 9);
  assertSameAsDoc(questions, doc);
  const scales = questions.filter(q => q.type === 'scale');
  assert.deepEqual(scales.map(q => [q.title, q.bounds]), [
    ['Bot 算的到站和到校時間準嗎？', [1, 5]], ['整體滿意度', [1, 5]], ['你會推薦同學使用嗎？', [0, 10]],
  ]);
});

test('每份問卷只會建立一次，網址記在指令碼屬性', () => {
  const env = loadBot(['問卷表單.gs']);
  env.call('建立通勤問卷');
  env.call('建立通勤問卷');
  env.call('建立回饋問卷');
  env.call('建立回饋問卷');
  assert.deepEqual(env.forms.map(f => f.title).join('｜'), '東吳外雙溪通勤問卷｜東吳通勤達人使用回饋');
  assert.equal(env.props.SURVEY1_URL, 'https://forms.example/1');
  assert.equal(env.props.SURVEY2_URL, 'https://forms.example/2');
});
