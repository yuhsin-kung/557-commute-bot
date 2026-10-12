// 共享雨傘（bot/雨傘.gs）：借和還都要拍照才算完成。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');
const { textOf, buttonsOf } = require('./helpers');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));

function start(props) {
  const env = loadBot(ALL, props);
  env.setNow('2026-10-12T09:00:00+08:00');
  env.call('建立雨傘清單');
  return env;
}
const say = (env, uid, text) => env.call('memberReply_', uid, text);
const photo = (env, uid, id = 'PHOTO-1') => env.call('umPhoto_', uid, id);
const rows = (env, name) => (env.sheets[name] ? env.sheets[name].rows.slice(1) : []);
const plain = x => JSON.parse(JSON.stringify(x));
const umbrella = (env, id) => rows(env, '雨傘').filter(r => r[0] === id)[0];

/** 假裝 Gemini 看完照片的回答 */
function geminiSays(env, answer) {
  env.onFetch = url => (url.includes('generativelanguage')
    ? { body: { candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] } }
    : undefined);
}

test('借傘：選地點後只是請你拍照，還沒借出；傳了照片才借出', () => {
  const env = start();
  assert.deepEqual(buttonsOf(say(env, 'A', '借傘')).map(b => b[1]), ['借傘 錢穆故居站', '借傘 校門口']);

  const ask = say(env, 'A', '借傘 錢穆故居站');
  assert.match(textOf(ask), /請拿傘架上貼著 U01 的那一把/);
  assert.match(textOf(ask), /拍一張這把傘的照片/);
  assert.deepEqual(plain(ask.quickReply.items.map(i => i.action.type)), ['camera', 'cameraRoll'], '一按就開相機');
  assert.deepEqual(buttonsOf(ask).map(b => b[1]), ['共享雨傘'], '訊息裡有「先不要了」');
  assert.equal(umbrella(env, 'U01')[1], '在架', '還沒傳照片，傘還在架上');
  assert.equal(rows(env, '雨傘紀錄').length, 0);

  assert.match(textOf(photo(env, 'A')), /借到 U01/);
  assert.equal(umbrella(env, 'U01')[1], '借出');
  assert.equal(umbrella(env, 'U01')[2], 'A');
});

test('還傘：也要拍照；照片存進雲端硬碟，連結記在雨傘紀錄', () => {
  const env = start();
  say(env, 'A', '借傘 錢穆故居站');
  photo(env, 'A', 'P-BORROW');

  const ask = say(env, 'A', '還傘 校門口');
  assert.match(textOf(ask), /把 U01 放回校門口的傘架/);
  assert.equal(umbrella(env, 'U01')[1], '借出', '還沒傳照片，不算歸還');

  const back = photo(env, 'A', 'P-RETURN');
  assert.match(back, /已歸還 U01.*\+3 分/);
  assert.match(back, /雨天英雄/);
  assert.equal(umbrella(env, 'U01')[1], '在架');
  assert.equal(umbrella(env, 'U01')[3], '校門口', '傘現在在校門口');

  assert.deepEqual(env.files.map(f => f.name), ['2026-10-12 0900 借出 U01 錢穆故居站.jpg', '2026-10-12 0900 歸還 U01 校門口.jpg']);
  assert.match(env.files[0].url, /\/message\/P-BORROW\/content$/, '存的是原圖，不是縮圖');
  const log = rows(env, '雨傘紀錄').map(r => plain(r.slice(1)));
  assert.deepEqual(log, [
    ['A', '借出', 'U01', '錢穆故居站', 'https://drive.example/1', '未檢查'],
    ['A', '歸還', 'U01', '校門口', 'https://drive.example/2', '未檢查'],
  ]);
});

test('沒有在借還傘的時候傳照片：說明要先選地點，什麼都不會改', () => {
  const env = start();
  const answer = photo(env, 'A');
  assert.match(textOf(answer), /沒有在借傘或還傘/);
  assert.deepEqual(buttonsOf(answer).map(b => b[1]), ['借傘', '還傘']);
  assert.equal(env.files.length, 0);
  assert.equal(rows(env, '雨傘').filter(r => r[1] === '借出').length, 0);
});

test('選完地點超過 10 分鐘才傳照片：要重選', () => {
  const env = start();
  say(env, 'A', '借傘 錢穆故居站');
  env.addMinutes(11);
  assert.match(textOf(photo(env, 'A')), /沒有在借傘或還傘/);
  assert.equal(umbrella(env, 'U01')[1], '在架');
});

test('一張照片只能用一次：借出後再傳照片不會再借一把', () => {
  const env = start();
  say(env, 'A', '借傘 錢穆故居站');
  photo(env, 'A');
  assert.match(textOf(photo(env, 'A')), /沒有在借傘或還傘/);
  assert.equal(rows(env, '雨傘').filter(r => r[1] === '借出').length, 1);
});

test('已經借了一把：不能再借；沒借傘：不能還', () => {
  const env = start();
  assert.match(say(env, 'A', '還傘 校門口'), /沒有借傘/);
  say(env, 'A', '借傘 錢穆故居站');
  photo(env, 'A');
  assert.match(textOf(say(env, 'A', '借傘 校門口')), /已經借了 U01/);
});

test('等拍照的時候那把被別人借走：換同一個點的另一把，並告訴同學', () => {
  const env = start();
  say(env, 'A', '借傘 校門口'); // A、B 都被指到 U04
  say(env, 'B', '借傘 校門口');
  assert.match(textOf(photo(env, 'A')), /借到 U04/);
  const b = textOf(photo(env, 'B'));
  assert.match(b, /借到 U05/);
  assert.match(b, /U04 剛被借走，請改拿 U05/);
});

test('那個點借完了會說沒有', () => {
  const env = start();
  ['A', 'B', 'C'].forEach(u => { say(env, u, '借傘 校門口'); photo(env, u); });
  assert.match(say(env, 'D', '借傘 校門口'), /沒有傘可以借了/);
});

test('還傘的積分一天只給一次，隔天可以再拿', () => {
  const env = start();
  const round = (from, to) => { say(env, 'A', '借傘 ' + from); photo(env, 'A'); say(env, 'A', '還傘 ' + to); return photo(env, 'A'); };
  assert.match(round('錢穆故居站', '校門口'), /\+3 分/);
  assert.match(round('校門口', '錢穆故居站'), /今天的還傘積分已經領過了/);
  assert.equal(env.call('cpUser_', 'A').points, 3);
  assert.equal(rows(env, '雨傘').filter(r => r[1] === '借出').length, 0, '傘還是有還回去');
  env.addMinutes(24 * 60);
  assert.match(round('錢穆故居站', '校門口'), /\+3 分/);
  assert.equal(env.call('cpUser_', 'A').points, 6);
});

// ===== Gemini 檢查照片 =====

test('Gemini 說照片裡沒有雨傘：請重拍，不借出；再傳一張有雨傘的就可以', () => {
  const env = start({ GEMINI_API_KEY: 'k' });
  say(env, 'A', '借傘 錢穆故居站');
  geminiSays(env, { umbrella: false, person: false });
  const retry = photo(env, 'A');
  assert.match(textOf(retry), /看不到雨傘，請再拍一次/);
  assert.equal(umbrella(env, 'U01')[1], '在架');
  assert.equal(env.files.length, 0, '沒通過的照片不存');

  geminiSays(env, { umbrella: true, person: false });
  assert.match(textOf(photo(env, 'A')), /借到 U01/);
  assert.equal(rows(env, '雨傘紀錄')[0][6], '通過');
});

test('Gemini 說拍到人臉：請重拍，照片不存', () => {
  const env = start({ GEMINI_API_KEY: 'k' });
  say(env, 'A', '借傘 錢穆故居站');
  geminiSays(env, { umbrella: true, person: true });
  assert.match(textOf(photo(env, 'A')), /拍到人了.*只拍雨傘和傘架/);
  assert.equal(env.files.length, 0);
  assert.equal(umbrella(env, 'U01')[1], '在架');
});

test('Gemini 看的是縮圖（省流量），存的是原圖', () => {
  const env = start({ GEMINI_API_KEY: 'k' });
  say(env, 'A', '借傘 錢穆故居站');
  geminiSays(env, { umbrella: true, person: false });
  photo(env, 'A', 'P1');
  const urls = env.fetches.map(f => f.url).filter(u => u.includes('api-data.line.me'));
  assert.deepEqual(urls, ['https://api-data.line.me/v2/bot/message/P1/content/preview', 'https://api-data.line.me/v2/bot/message/P1/content']);
});

test('Gemini 額度用完或壞掉：不檢查，直接收，不會卡住借還', () => {
  const env = start({ GEMINI_API_KEY: 'k' });
  say(env, 'A', '借傘 錢穆故居站');
  env.onFetch = url => (url.includes('generativelanguage') ? { code: 429, body: 'quota' } : undefined);
  assert.match(textOf(photo(env, 'A')), /借到 U01/);
  assert.equal(rows(env, '雨傘紀錄')[0][6], '未檢查');
});

test('雲端硬碟存檔失敗：借還照樣完成，紀錄裡寫存檔失敗', () => {
  const env = start();
  env.driveFails = true;
  say(env, 'A', '借傘 錢穆故居站');
  assert.match(textOf(photo(env, 'A')), /借到 U01/);
  assert.equal(rows(env, '雨傘紀錄')[0][5], '照片存檔失敗');
});

// ===== 從 LINE 進來的照片 =====

test('LINE 傳來照片訊息：交給雨傘處理、回覆、寫進訊息紀錄', () => {
  const env = start();
  say(env, 'A', '借傘 錢穆故居站');
  env.call('doPost', { postData: { contents: JSON.stringify({ events: [
    { type: 'message', replyToken: 'r1', source: { userId: 'A' }, message: { type: 'image', id: 'P9' } },
  ] }) } });
  const reply = env.fetches.filter(f => f.url.endsWith('/message/reply')).pop();
  assert.match(textOf(reply.body.messages), /借到 U01/);
  const log = rows(env, '訊息紀錄').pop();
  assert.equal(log[2], '（傳照片）');
  assert.match(log[3], /借到 U01/);
});

test('每日報表的借傘次數從雨傘紀錄算：同一把傘一天借兩次算兩次', () => {
  const env = start();
  ['A', 'B'].forEach(u => { say(env, u, '借傘 錢穆故居站'); photo(env, u); say(env, u, '還傘 錢穆故居站'); photo(env, u); });
  assert.equal(env.call('buildReport_', new Date('2026-10-12T21:00:00+08:00')).umbrellas, 2);
});
