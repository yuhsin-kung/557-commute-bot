// 定位測試頁，以及「公開網頁呼叫得到哪些函式」的檢查。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');
const { buttonsOf } = require('./helpers');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));
const same = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

// 等車室、定位測試是公開網頁，網頁裡的程式可以呼叫專案裡任何名稱不是底線結尾的函式。
// 新增公開函式時要先想過「被陌生人連續呼叫會怎樣」，再加進這張表。
const PUBLIC = {
  doPost: 'LINE 的 Webhook',
  doGet: '等車室、定位測試的網頁',
  cpRoomState: '等車室：要有這個人的代碼才看得到東西',
  cpRoomAction: '等車室：要有這個人的代碼才能動',
  geoTestLog: '定位測試：欄位限制格式和長度',
  測試: '一分鐘只跑一次',
  測試比較器: '一分鐘只跑一次',
  測試晚上提醒: '一分鐘只跑一次，不會發送',
  測試站位變更: '一分鐘只跑一次，不會發送',
  晚上提醒: '一天只跑一次',
  試發給訂閱者: '要先設 ALLOW_TEST_PUSH 才會發',
  建立計數表單: '只建立一次',
  建立通勤問卷: '只建立一次',
  建立回饋問卷: '只建立一次',
  檢查站位變更: '頁面沒變就什麼都不做',
  共乘每分鐘檢查: '重複執行結果一樣',
  設定晚上提醒排程: '重複執行結果一樣',
  設定站位檢查排程: '重複執行結果一樣',
  設定共乘排程: '重複執行結果一樣',
  ptCheckin: '打卡頁：要有這個人的代碼；一分鐘一次；步行、早到一天各一次，自己亂報座標一天最多多拿 15 分',
  每日報表: '一天只跑一次',
  測試每日報表: '一分鐘只跑一次，不寄信、不存檔',
  設定每日報表排程: '重複執行結果一樣',
  測試YouBike: '一分鐘只跑一次',
  建立雨傘清單: '已經有清單就不動',
};

test('公開函式都在清單裡（新增的要先想過被亂呼叫會怎樣）', () => {
  const env = loadBot(ALL);
  const builtIn = Object.keys(loadBot([]).context);
  const found = Object.keys(env.context)
    .filter(k => typeof env.context[k] === 'function' && !k.endsWith('_') && !builtIn.includes(k));
  same(found.sort(), Object.keys(PUBLIC).sort());
});

test('晚上提醒一天只會跑一次', () => {
  const env = loadBot(ALL);
  env.run("buildReminder_ = () => ({ message: '明天會下雨', reason: '下雨', pop: 80 })");
  env.call('subscribe_', 'A', true);
  env.call('晚上提醒');
  env.call('晚上提醒');
  env.call('晚上提醒');
  assert.equal(env.pushes().length, 1);
});

test('試發給訂閱者：沒有先打開開關就不發，發一次就自動關掉', () => {
  const env = loadBot(ALL);
  env.call('subscribe_', 'A', true);
  env.call('試發給訂閱者');
  assert.equal(env.pushes().length, 0);
  env.props.ALLOW_TEST_PUSH = '1';
  env.call('試發給訂閱者');
  env.call('試發給訂閱者');
  assert.equal(env.pushes().length, 1);
});

test('計數表單只會建立一次', () => {
  const env = loadBot(ALL);
  env.call('建立計數表單');
  env.call('建立計數表單');
  assert.equal(env.forms.length, 1);
  assert.equal(env.props.COUNT_FORM_URL, 'https://forms.example/1');
});

test('測試用的函式一分鐘內只跑一次', () => {
  const env = loadBot(ALL);
  assert.equal(env.call('tooSoon_', '測試', 60), false);
  assert.equal(env.call('tooSoon_', '測試', 60), true);
  assert.equal(env.call('tooSoon_', '測試比較器', 60), false);
});

test('定位測試頁：帶著四個點的座標，程式語法正確，不用會被擋掉的跳出視窗', () => {
  const env = loadBot(ALL);
  const page = env.call('doGet', { parameter: { page: 'geo' } });
  assert.equal(page.title, '定位測試');
  assert.equal(page.content.includes('__'), false);
  const script = page.content.match(/<script>([\s\S]*)<\/script>/)[1];
  assert.match(script, /var POINTS = \{"錢穆故居站":\[25\.09727,121\.5416\]/);
  assert.doesNotThrow(() => new Function('document', 'navigator', 'window', 'google', script.replace(/^document\.getElementById\('env'\).*$/m, '')));
  assert.equal(/\b(confirm|alert|prompt)\s*\(/.test(script), false);
});

test('定位測試的紀錄：不存經緯度，文字限制長度，沒看過的地點名稱不收', () => {
  const env = loadBot(ALL);
  env.call('geoTestLog', { ok: true, accuracy: 12.6, nearest: '錢穆故居站', distance: 33.4, seconds: 2.2, lat: 25.0972, lng: 121.5416, env: 'e'.repeat(500), ua: 'u'.repeat(500) });
  env.call('geoTestLog', { ok: 'yes', accuracy: '<b>', nearest: '=HYPERLINK("x")', error: 'x'.repeat(500) });
  env.call('geoTestLog', null);
  const rows = env.sheets['定位測試'].rows;
  same(rows[1].slice(1, 7), ['成功', 13, '錢穆故居站', 33, 2, '']);
  assert.equal(rows[1][7].length, 120);
  assert.equal(rows[1][8].length, 200);
  assert.equal(JSON.stringify(rows).includes('25.0972'), false);
  same(rows[2].slice(1, 7), ['失敗', '', '', '', '', 'x'.repeat(120)]);
  assert.equal(rows[3][1], '失敗');
});

test('傳「定位測試」會拿到打開測試頁的按鈕', () => {
  const env = loadBot(ALL);
  env.call('handleEvent_', { type: 'message', replyToken: 'r', source: { userId: 'A' }, message: { type: 'text', text: '定位測試' } });
  const reply = env.fetches.filter(f => f.url.endsWith('/message/reply')).pop().body;
  assert.equal(buttonsOf(reply.messages[0])[0][1], 'https://script.google.com/macros/s/TEST/exec?page=geo');
});
