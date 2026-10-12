// 把 bot/ 裡所有 .gs 合成一個檔案：dist/全部程式碼.gs
// Apps Script 不需要分成很多檔，全部貼在同一個檔案裡一樣能跑，更新時只要貼一次。
// 執行：npm run bundle（改了 bot/ 裡任何檔案之後都要重跑；npm test 會檢查有沒有忘記）
const fs = require('fs');
const path = require('path');

const BOT = path.join(__dirname, '..', 'bot');
const OUT = path.join(__dirname, '..', 'dist', '全部程式碼.gs');

function bundle() {
  // Code.gs 放最前面，其他照檔名排
  const files = fs.readdirSync(BOT).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Code.gs' ? -1 : b === 'Code.gs' ? 1 : a < b ? -1 : 1));
  const line = '// ' + '='.repeat(76);
  const head = [
    line,
    '// 東吳通勤達人 LINE Bot：全部程式碼（' + files.length + ' 個檔案合成一個）',
    '//',
    '// 這個檔案是自動產生的，不要直接改。要改請改 bot/ 裡的檔案，再執行 npm run bundle。',
    '// 用法：Apps Script 裡只留一個「程式碼.gs」，把這整份貼進去，其他 .gs 檔全部刪掉。',
    '//       （留著其他檔案會出現「Identifier ... has already been declared」，因為同樣的東西宣告了兩次）',
    '// 包含：' + files.join('、'),
    line,
    '',
  ].join('\n');
  const body = files.map(f => [line, '// ' + f, line, '', fs.readFileSync(path.join(BOT, f), 'utf8').replace(/\r\n/g, '\n').trimEnd(), ''].join('\n')).join('\n');
  return head + '\n' + body;
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, bundle());
  const text = fs.readFileSync(OUT, 'utf8');
  console.log('已產生 dist/全部程式碼.gs：' + text.split('\n').length + ' 行，' + Math.round(Buffer.byteLength(text) / 1024) + ' KB');
}

module.exports = { bundle, OUT };
