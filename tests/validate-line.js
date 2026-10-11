// 把每一種卡片送到 LINE 的「驗證」介面：只檢查格式，不會發送任何訊息。執行：npm run validate:line
// 需要專案根目錄的 keys.env（LINE_CHANNEL_ACCESS_TOKEN）。
const fs = require('fs');
const path = require('path');
const { sampleCards } = require('./sample-cards');

const env = {};
for (const line of fs.readFileSync(path.join(__dirname, '..', 'keys.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}

(async () => {
  const cards = sampleCards();
  let failed = 0;
  for (const name of Object.keys(cards)) {
    const res = await fetch('https://api.line.me/v2/bot/message/validate/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN },
      body: JSON.stringify({ messages: [cards[name]] }),
    });
    const text = await res.text();
    if (res.status !== 200) failed++;
    console.log((res.status === 200 ? '✔ ' : '✖ ') + name + (res.status === 200 ? '' : '  ' + res.status + ' ' + text));
  }
  console.log(failed ? failed + ' 張卡片 LINE 不接受' : 'LINE 全部接受');
  process.exit(failed ? 1 : 0);
})();
