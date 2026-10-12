// dist/全部程式碼.gs：把 bot/ 的 16 個檔案合成一個，貼到 Apps Script 只要貼一次。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { loadBot } = require('./gas-env');
const { bundle, OUT } = require('./bundle');
const { buttonsOf } = require('./helpers');

const ONE_FILE = ['../dist/全部程式碼.gs'];

test('合併檔是最新的（改了 bot/ 之後要重跑 npm run bundle）', () => {
  assert.equal(fs.readFileSync(OUT, 'utf8'), bundle(), 'dist/全部程式碼.gs 跟 bot/ 的內容不一樣，請執行 npm run bundle');
});

test('只用合併檔這一個檔案，Bot 就能動：選單 → 分類 → 每一顆按鈕都認得', () => {
  const env = loadBot(ONE_FILE);
  env.setNow('2026-10-12T07:00:00+08:00');
  env.run("busReply_ = () => '[557]'; liveReply_ = () => '[即時]'; rainReply_ = () => '[天氣]'; ybReply_ = () => '[YouBike]'; rainPop_ = () => 20; parseWithGemini_ = () => null;");
  const send = text => {
    env.call('handleEvent_', { type: 'message', replyToken: 'r', source: { userId: 'A' }, message: { type: 'text', text } });
    return env.fetches.filter(f => f.url.endsWith('/message/reply')).pop().body.messages;
  };
  const categories = buttonsOf(send('選單')[0]).map(b => b[1]);
  assert.deepEqual(categories, ['出門前提醒', '557 以外的選擇', '新生與排隊', '積分與打卡']);
  let pressed = 0;
  categories.forEach(category => buttonsOf(send(category)[0]).forEach(([label, text]) => {
    const reply = send(text);
    pressed += 1;
    assert.equal(typeof reply[0].text === 'string' && reply[0].text.startsWith('我看不懂'), false, '合併檔裡「' + label + '」沒有作用');
    assert.equal(typeof reply[0].text === 'string' && reply[0].text.startsWith('抱歉'), false, '合併檔裡「' + label + '」出錯了');
  }));
  assert.equal(pressed, 20);
});

test('合併檔裡每個檔案都在，而且同一個名字沒有宣告兩次', () => {
  const text = fs.readFileSync(OUT, 'utf8');
  const files = fs.readdirSync(require('path').join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs'));
  assert.equal(files.length, 16);
  files.forEach(f => assert.ok(text.includes('\n// ' + f + '\n'), '合併檔裡沒有 ' + f));
  const names = [...text.matchAll(/^(?:const|let|var|function)\s+([A-Za-z_$一-鿿][\w$一-鿿]*)/gm)].map(m => m[1]);
  const twice = names.filter((n, i) => names.indexOf(n) !== i);
  // 等車室、打卡頁、定位測試頁裡面的網頁程式也有自己的 function，那些不算（它們在字串裡，不是 Bot 的程式）
  const inPages = ['TOKEN', 'esc', 'show', 'run', 'meters', 'environment', 'report'];
  assert.deepEqual(twice.filter(n => !inPages.includes(n)), [], '這些名字宣告了兩次：' + twice.join('、'));
});
