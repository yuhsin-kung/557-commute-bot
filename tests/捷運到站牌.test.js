// 捷運到站牌：定位 → 最近的捷運站 → Google 地圖走路時間（查不到用距離估）→ 捷運時刻表 → 到士林站 → 加 5 分鐘到 557 站牌。執行：npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadBot } = require('./gas-env');

const ALL = fs.readdirSync(path.join(__dirname, '..', 'bot')).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : 0));
const plain = v => JSON.parse(JSON.stringify(v));
const ms = iso => new Date(iso).getTime();
const SHIPAI = [25.11440, 121.51540];   // 石牌站附近
const TAIPEI_MAIN = [25.04640, 121.51700]; // 台北車站附近

test('最近的捷運站：石牌附近 → 石牌站；到士林站 5 分鐘', () => {
  const env = loadBot(ALL);
  const st = plain(env.call('mrtNearest_', SHIPAI));
  assert.equal(st.name, '石牌');
  assert.equal(st.toShilin, 5);
});

test('走路時間：有 Google 地圖就用它，查不到就用距離 × 1.3 ÷ 每分鐘 75 公尺', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 6 * 60 + 10;
  let w = plain(env.call('mrtWalk_', SHIPAI, [25.11425, 121.51530]));
  assert.deepEqual(w, { min: 7, source: 'Google 地圖' });
  assert.equal(env.mapsCalls[0].mode, 'walking');
  env.walkSeconds = null; // 模擬額度用完
  w = plain(env.call('mrtWalk_', [25.0, 121.5], [25.0, 121.5 + 0.009]));
  assert.equal(w.source, '用距離估');
  assert.ok(w.min >= 15 && w.min <= 16, '約 900 公尺 × 1.3 ÷ 75 ≈ 16 分');
});

test('石牌 09:05 出發：走 6 分、進站 2 分 → 09:13 在月台 → 往南的車 09:18 前後到士林 → 加 5 分到站牌', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 6 * 60;
  const r = plain(env.call('mrtPlan_', SHIPAI[0], SHIPAI[1], ms('2026-11-25T09:05:00+08:00')));
  assert.equal(r.ok, true);
  assert.equal(r.station, '石牌');
  // 需要 09:13 + 5 分 = 09:18 以後的往南班次：時刻表 09:20
  assert.equal(r.trainAtShilin, '09:20');
  assert.equal(r.atStop, '09:25');
  assert.match(r.lines.join('\n'), /走到石牌站約 6 分鐘（Google 地圖）/);
});

test('台北車站：搭往北的車（12 分）', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 3 * 60;
  const r = plain(env.call('mrtPlan_', TAIPEI_MAIN[0], TAIPEI_MAIN[1], ms('2026-11-25T07:30:00+08:00')));
  // 07:35 在月台 + 12 分 = 07:47 以後的往北班次：時刻表 07:49
  assert.equal(r.station, '台北車站');
  assert.equal(r.trainAtShilin, '07:49');
  assert.equal(r.atStop, '07:54');
});

test('就在士林站附近：直接走去站牌；半夜查就搭早上第一班', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 4 * 60;
  let r = plain(env.call('mrtPlan_', 25.0955, 121.5270, ms('2026-11-25T08:00:00+08:00')));
  assert.equal(r.station, '士林');
  assert.equal(r.atStop, '08:04');
  r = plain(env.call('mrtPlan_', SHIPAI[0], SHIPAI[1], ms('2026-11-28T03:00:00+08:00')));
  assert.equal(r.trainAtShilin, '06:05', '週六往南第一班');
  r = plain(env.call('mrtPlan_', 'abc', 121.5));
  assert.equal(r.ok, false);
});

test('週六用週六的時刻表；557 預測只有平常日，會說還沒有', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 6 * 60;
  // 星期六 09:05 石牌：09:13 在月台 + 5 分 = 09:18 → 週六往南 09:20
  const r = plain(env.call('mrtPlan_', SHIPAI[0], SHIPAI[1], ms('2026-11-28T09:05:00+08:00')));
  assert.equal(r.ok, true);
  assert.equal(r.trainAtShilin, '09:20');
  assert.equal(r.school, null);
  assert.match(r.lines.join('\n'), /還沒有 557 的預測/);
  // 星期日 08:00 在石牌月台：08:00 + 5 分 = 08:05 以後 → 週日往南 08:06
  const hm = d => env.run('Utilities.formatDate')(d, 'Asia/Taipei', 'HH:mm');
  assert.equal(hm(env.call('mrtTrainToShilin_', 'R19', 5, new Date('2026-11-29T08:00:00+08:00'))), '08:06');
});

test('竹圍（復興崗～淡水）搭不到從北投發車的區間車', () => {
  const env = loadBot(ALL);
  const hm = d => env.run('Utilities.formatDate')(d, 'Asia/Taipei', 'HH:mm');
  // 平常日 10:00 在竹圍月台 + 21 分 = 10:21 以後：10:25 是區間車（底線）→ 竹圍要等 10:29
  assert.equal(hm(env.call('mrtTrainToShilin_', 'R26', 21, new Date('2026-11-25T10:00:00+08:00'))), '10:29');
  // 石牌（北投以南）搭得到區間車：10:00 + 5 = 10:05 → 10:07（區間車）
  assert.equal(hm(env.call('mrtTrainToShilin_', 'R19', 5, new Date('2026-11-25T10:00:00+08:00'))), '10:07');
});

test('被亂按：Google 地圖每分鐘最多 30 次，超過改用距離估（不會擋掉學生）', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 300;
  const sources = Array.from({ length: 32 }, () => env.call('mrtWalk_', SHIPAI, [25.11425, 121.51530]).source);
  assert.equal(sources.filter(s => s === 'Google 地圖').length, 30);
  assert.equal(sources[31], '用距離估');
  assert.equal(env.mapsCalls.length, 30);
});

test('接到 557：09:30 到站牌是尖峰 → 給範圍；國中最晚比較早，推薦國中', () => {
  const env = loadBot(ALL);
  const at = new Date('2026-11-25T09:30:00+08:00');
  const mrt = plain(env.call('p557Estimate_', '捷運士林站', at));
  const jhs = plain(env.call('p557Estimate_', '士林國中', at));
  assert.equal(mrt.peak, true);
  assert.ok(mrt.late && jhs.late, '尖峰一定有最晚時間');
  assert.ok(new Date(mrt.late) > new Date(mrt.early));
});

test('以車為主：幾點會來一台、要不要排、搭上幾點到、下一台幾點來、錯過幾點到；尖峰國中比較不用排就建議國中', () => {
  const env = loadBot(ALL);
  const lines = env.call('p557Lines_', new Date('2026-11-25T09:30:00+08:00'));
  assert.match(lines[0], /^🚌 09:\d\d–09:\d\d 之間會來一台 557$/);
  assert.match(lines[1], /第一台常常要排（約 \d+%）/);
  assert.match(lines[2], /^🏫 搭上這台：09:\d\d–09:\d\d 到東吳$/);
  assert.match(lines[3], /^⏭️ 下一台 09:\d\d–\d\d:\d\d 來；錯過這台，09:\d\d–\d\d:\d\d 到東吳$/);
  assert.match(lines[4], /建議走去士林國中站牌排：同一台車/);
  assert.equal(lines.join('\n').includes('捷運士林站站牌：'), false, '不再列兩個站牌兩個時間');
  const off = env.call('p557Lines_', new Date('2026-11-25T11:10:00+08:00'));
  assert.match(off[1], /通常不用排/);
  assert.equal(off.length, 4, '離峰不用建議走去國中');
  const b = plain(env.call('p557Bus_', new Date('2026-11-25T09:30:00+08:00')));
  assert.ok(new Date(b.late) > new Date(b.early), '記錄用：最早（搭上）＜最晚（錯過）');
});

test('接到 557：08:30 離峰只給一個時間；週末、晚上沒有預測', () => {
  const env = loadBot(ALL);
  const r = plain(env.call('p557Estimate_', '捷運士林站', new Date('2026-11-25T08:30:00+08:00')));
  assert.equal(r.peak, false);
  assert.equal(r.late, null);
  assert.match(r.text, /^約 08:\d\d 到東吳$/);
  assert.equal(env.call('p557Estimate_', '捷運士林站', new Date('2026-11-28T08:30:00+08:00')), null);
  assert.match(env.call('p557Lines_', new Date('2026-11-25T21:00:00+08:00'))[0], /還沒有 557 的預測/);
});

test('整個流程：石牌 09:05 出發 → 09:25 到站牌 → 尖峰範圍到東吳', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 6 * 60;
  const r = plain(env.call('mrtPlan_', SHIPAI[0], SHIPAI[1], ms('2026-11-25T09:05:00+08:00')));
  assert.equal(r.atStop, '09:25');
  assert.equal(r.school.peak, true);
  assert.ok(r.school.late > r.school.early);
  assert.match(r.lines.join('\n'), /🏫 搭上這台：09:\d\d–\d\d:\d\d 到東吳/);
});

test('在 LINE 裡完成：傳「到校預估」→ 按鈕打開 LINE 的傳送位置畫面（不是外部網頁）→ 傳位置 → 直接回卡片', () => {
  const env = loadBot(ALL);
  env.setNow('2026-11-25T09:05:00+08:00');
  env.walkSeconds = () => 6 * 60;
  const card = JSON.stringify(env.call('etaButton_'));
  assert.match(card, /line\.me\/R\/nv\/location/);
  assert.doesNotMatch(card, /script\.google\.com|page=eta/);
  env.call('handleEvent_', { type: 'message', replyToken: 'r', source: { userId: 'A' }, message: { type: 'location', latitude: SHIPAI[0], longitude: SHIPAI[1] } });
  const reply = env.fetches.filter(f => f.url.endsWith('/message/reply')).pop().body.messages[0];
  assert.match(reply.altText, /幾點到東吳/);
  assert.match(reply.altText, /🚌 09:\d\d–\d\d:\d\d 之間會來一台 557/);
  assert.match(reply.altText, /⏭️ 下一台 .+；錯過這台，.+ 到東吳/);
  assert.match(reply.altText, /09:25 到站牌/);
  const logged = env.sheets['訊息紀錄'].rows.pop();
  assert.equal(logged[2], '（傳了位置）', '紀錄裡不寫經緯度');
  assert.doesNotMatch(JSON.stringify(logged), /25\.114|121\.515/);
});

// ===== 合併「出門時間建議」 =====
const lastReply = env => env.fetches.filter(f => f.url.endsWith('/message/reply')).pop().body.messages[0];
const sendText = (env, text) => { env.call('handleEvent_', { type: 'message', replyToken: 'r', source: { userId: 'A' }, message: { type: 'text', text } }); return lastReply(env); };
const sendLoc = (env, lat, lng) => { env.call('handleEvent_', { type: 'message', replyToken: 'r', source: { userId: 'A' }, message: { type: 'location', latitude: lat, longitude: lng } }); return lastReply(env); };

test('合併入口：傳送我的位置、我要趕課、我已經在士林站', () => {
  const env = loadBot(ALL);
  const card = env.call('etaButton_');
  const json = JSON.stringify(card);
  assert.match(card.altText, /預估到達時間/);
  assert.match(json, /line\.me\/R\/nv\/location/);
  assert.match(json, /"text":"出門時間"/);
  assert.match(json, /"text":"到校預估 士林站"/);
});

test('我已經在士林站：走 5 分鐘到站牌，再估幾點到東吳', () => {
  const env = loadBot(ALL);
  env.setNow('2026-11-25T09:20:00+08:00');
  const r = sendText(env, '到校預估 士林站');
  assert.match(r.altText, /約 09:25 到站牌/);
  assert.match(r.altText, /🏫 搭上這台：09:\d\d–\d\d:\d\d 到東吳/);
});

test('趕課：選好明天第 3 節（10:10，尖峰前後）D 棟，接著傳位置 → 倒推最晚幾點出門，可以設出門提醒', () => {
  const env = loadBot(ALL);
  env.setNow('2026-11-24T21:00:00+08:00'); // 明天 11/25（三）
  env.walkSeconds = () => 6 * 60;
  const plan = sendText(env, '出門時間 明天 10:10 D');
  assert.match(plan.altText, /出門建議|上課/);
  assert.match(JSON.stringify(plan), /用我的位置算幾點出門/);
  const r = sendLoc(env, SHIPAI[0], SHIPAI[1]);
  assert.match(r.altText, /明天 10:10 上課/);
  const depart = r.altText.match(/從你這裡出發：(\d\d:\d\d) 前出門/);
  assert.ok(depart, r.altText);
  assert.match(r.altText, /走到石牌站約 6 分鐘/);
  assert.match(r.altText, /557 預計 \d\d:\d\d–\d\d:\d\d 到東吳（尖峰，已把排隊、等下一台算進去）/);
  assert.match(r.altText, /下車走到 D 棟約 \d+ 分鐘/);
  // 最晚到東吳 + 走到 D 棟 + 提早 5 分 ≤ 10:10
  const late = r.altText.match(/557 預計 \d\d:\d\d–(\d\d):(\d\d) 到東吳/);
  const walk = Number(r.altText.match(/走到 D 棟約 (\d+) 分鐘/)[1]);
  assert.ok(Number(late[1]) * 60 + Number(late[2]) + walk + 5 <= 10 * 60 + 10);
  // 出門提醒：到時間提醒「該出門了」
  const remind = JSON.parse(JSON.stringify(r)).contents.footer.contents.map(c => c.action && c.action.text).find(t => t && t.startsWith('出門提醒'));
  assert.match(remind, new RegExp('^出門提醒 明天 \\d\\d:\\d\\d 出門 ' + depart[1] + '$'));
  const set = sendText(env, remind);
  assert.match(set.altText, new RegExp('明天 ' + depart[1]));
  const row = env.sheets['發車提醒'].rows.pop();
  assert.equal(env.run('Utilities.formatDate')(new Date(row[2]), 'Asia/Taipei', 'HH:mm'), depart[1], '提醒時間就是出門時間');
  // 用過就清掉：再傳一次位置是「現在出發幾點到」
  assert.match(sendLoc(env, SHIPAI[0], SHIPAI[1]).altText, /🚇/);
});

test('沒選課直接傳位置：現在出發幾點到（不會被當成趕課）', () => {
  const env = loadBot(ALL);
  env.setNow('2026-11-25T09:05:00+08:00');
  env.walkSeconds = () => 6 * 60;
  const r = sendLoc(env, SHIPAI[0], SHIPAI[1]);
  assert.match(r.altText, /幾點到東吳/);
  assert.doesNotMatch(r.altText, /前出門/);
});

test('口語問「明天第 3 節 D 棟」也一樣：回出門建議後，接著傳位置就倒推（不會被當成現在出發）', () => {
  const env = loadBot(ALL);
  env.setNow('2026-11-24T21:00:00+08:00');
  env.walkSeconds = () => 6 * 60;
  env.run('parseWithGemini_ = () => null; rainPop_ = () => 20;');
  sendText(env, '出門時間 明天 10:10 D 士林站'); // 從士林站出發的出門建議
  const r = sendLoc(env, SHIPAI[0], SHIPAI[1]);
  assert.match(r.altText, /明天 10:10 上課/);
  assert.match(r.altText, /從你這裡出發：\d\d:\d\d 前出門/);
});

// ===== 測試模式、預估紀錄 =====
const replyOf = (env, uid, message) => {
  env.call('handleEvent_', { type: 'message', replyToken: 'r', source: { userId: uid }, message });
  return env.fetches.filter(f => f.url.endsWith('/message/reply')).pop().body.messages;
};

test('測試模式：假裝週三 09:05 → 傳位置照週三算，回覆第一行標明；只影響自己；結束後恢復', () => {
  const env = loadBot(ALL);
  env.walkSeconds = () => 6 * 60;
  const start = replyOf(env, 'A', { type: 'text', text: '測試時間 週三 09:05' });
  assert.match(start[0].altText, /測試模式開始/);
  assert.match(start[0].altText, /週三 09:05/);
  const r = replyOf(env, 'A', { type: 'location', latitude: SHIPAI[0], longitude: SHIPAI[1] });
  assert.equal(r[0].text, '🧪 測試模式：當成週三 09:05');
  assert.match(r[1].altText, /搭捷運，09:20 到士林站/);
  assert.match(r[1].altText, /09:25 到站牌/);
  assert.match(r[1].altText, /09:\d\d–\d\d:\d\d 到東吳/);
  // 換回真的時間
  assert.ok(Math.abs(env.run('Date.now()') - Date.now()) < 5000, 'Date 已經換回來');
  // 別人不受影響
  const other = replyOf(env, 'B', { type: 'location', latitude: SHIPAI[0], longitude: SHIPAI[1] });
  assert.notEqual(other[0].text, '🧪 測試模式：當成週三 09:05');
  // 預估紀錄：不記使用者和位置
  const rows = env.sheets['預估紀錄'].rows;
  assert.deepEqual(plain(rows[0]), ['記錄時間', '測試模式（假裝的時間）', '類型', '上課時間', '出發／到站牌', '推薦站牌', '預估到東吳（最早）', '預估到東吳（最晚）', '尖峰']);
  const row = rows[1];
  assert.equal(row[1], '週三 09:05');
  assert.equal(row[2], '現在出發');
  assert.match(row[4], /到站牌 \d{4}-\d\d-\d\d 09:25/);
  assert.match(row[6], / 09:\d\d$/);
  assert.equal(row[8], '是', '09:25 是尖峰');
  assert.doesNotMatch(JSON.stringify(rows), /25\.114|121\.515|"A"|"B"/);
  // 結束
  assert.match(replyOf(env, 'A', { type: 'text', text: '測試時間 結束' })[0].text, /測試模式結束/);
  const after = replyOf(env, 'A', { type: 'text', text: '選單' });
  assert.notEqual(after[0].text, '🧪 測試模式：當成週三 09:05');
});

test('測試模式：格式不對就教用法', () => {
  const env = loadBot(ALL);
  assert.match(replyOf(env, 'A', { type: 'text', text: '測試時間' })[0].text, /測試時間 週三 09:05/);
});
