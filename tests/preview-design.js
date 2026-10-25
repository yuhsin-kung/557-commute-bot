// 美編預覽（npm run preview 後打開 /cards、/menu）
//   /cards：把每一種卡片畫出來看。這是照 LINE Flex 的規則自己畫的近似畫面，實際樣子以手機上的 LINE 為準
//   /menu ：畫圖文選單的圖（2500×1686），按「存成 PNG」會存到 design/圖文選單.png
const fs = require('fs');
const path = require('path');
const { sampleCards } = require('./sample-cards');

const SIZE = { xxs: 11, xs: 13, sm: 14, md: 16, lg: 19, xl: 22 };
const GAP = { none: 0, xs: 4, sm: 8, md: 12, lg: 16, xl: 20 };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function render(node, inRow) {
  if (node.type === 'text') {
    const style = [`font-size:${SIZE[node.size] || 16}px`, `color:${node.color || '#111'}`, `font-weight:${node.weight === 'bold' ? 700 : 400}`,
      `text-align:${node.align === 'end' ? 'right' : node.align === 'center' ? 'center' : 'left'}`, !inRow ? '' : node.flex === 0 ? 'flex:0 0 auto;max-width:55%' : 'flex:1 1 0;min-width:0', // 只有橫排的文字要分寬度
      node.wrap ? 'white-space:pre-wrap;overflow-wrap:anywhere' : 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis'];
    return `<div style="${style.join(';')}">${esc(node.text)}</div>`;
  }
  if (node.type === 'filler') return '<div style="flex:1 1 0"></div>';
  if (node.type === 'separator') return `<div style="height:1px;background:${node.color || '#ddd'};flex:0 0 1px"></div>`;
  if (node.type === 'button') {
    const primary = node.style === 'primary';
    return `<div style="padding:10px;border-radius:8px;text-align:center;font-size:15px;font-weight:700;${primary ? `background:${node.color};color:#fff` : `color:${node.color}`}">${esc(node.action.label)}</div>`;
  }
  if (node.type === 'box') {
    const pad = v => (v == null ? null : (GAP[v] != null ? GAP[v] + 'px' : v));
    const style = [`display:flex`, `flex-direction:${node.layout === 'horizontal' ? 'row' : 'column'}`, `gap:${GAP[node.spacing] || 0}px`];
    if (node.backgroundColor) style.push(`background:${node.backgroundColor}`);
    if (node.paddingAll) style.push(`padding:${pad(node.paddingAll)}`);
    if (node.paddingTop) style.push(`padding-top:${pad(node.paddingTop)}`);
    if (node.cornerRadius) style.push(`border-radius:${node.cornerRadius}`);
    if (inRow && node.flex === 1) style.push('flex:1 1 0', 'min-width:0'); // 兩欄的按鈕一樣寬
    return `<div style="${style.join(';')}">${node.contents.map(c => render(c, node.layout === 'horizontal')).join('')}</div>`;
  }
  return '';
}

function cardsPage() {
  const cards = sampleCards();
  const items = Object.keys(cards).map(name => {
    const c = cards[name].contents;
    const bubble = b => `<div class="bubble${b.size === 'kilo' ? ' kilo' : ''}">${['header', 'body', 'footer'].filter(k => b[k]).map(k => render(b[k], false)).join('')}</div>`;
    // 一排可以左右滑的卡片：預覽時全部攤開來看
    if (c.type === 'carousel') return `<figure class="wide"><figcaption>${esc(name)}（手機上是左右滑）</figcaption><div class="row">${c.contents.map(bubble).join('')}</div></figure>`;
    return `<figure><figcaption>${esc(name)}</figcaption>${bubble(c)}</figure>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><title>卡片預覽</title>
<style>body{margin:0;padding:24px;background:#8C9BAF;font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif}
.wrap{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}figure{margin:0}figcaption{color:#fff;font-size:14px;margin-bottom:6px}
.bubble{width:300px;border-radius:16px;overflow:hidden;background:#fff}.bubble.kilo{width:260px}.wide{flex-basis:100%}.row{display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap}</style>
<div class="wrap" id="cards">${items}</div>`;
}

// 圖文選單：四個分類（跟 bot/選單.gs 的 MENU 一樣），按了 Bot 會把那一類的功能按鈕傳到聊天室。
// 上排左到右、下排左到右。text 是按了以後替使用者傳出去的字，要跟 LINE 後台設定的一樣
const MENU = [
  { icon: 'route', label: '出門前提醒', hint: '怎麼去・幾點出門・天氣', text: '出門前提醒', primary: true },
  { icon: 'car', label: '557 以外的選擇', hint: '共乘・YouBike・雨傘', text: '557 以外的選擇' },
  { icon: 'bus-stop', label: '公車站牌與排隊', hint: '上車地點・排隊禮儀', text: '公車站牌與排隊' },
  { icon: 'award', label: '積分與打卡', hint: '3 點換 30 元學餐折價券', text: '積分與打卡' },
];

function menuPage() {
  return `<!doctype html><meta charset="utf-8"><title>圖文選單</title>
<style>body{margin:0;padding:16px;font-family:sans-serif;background:#eee}canvas{width:100%;max-width:900px;display:block;border:1px solid #ccc}button{font-size:16px;padding:10px 18px;margin:12px 0}</style>
<button id="save" disabled>存成 PNG</button> <span id="status">載入圖示中…</span>
<canvas id="c" width="2500" height="1686"></canvas>
<script>
var MENU = ${JSON.stringify(MENU)};
var UI = { brand: '#A63A2B', brandDark: '#7A2A1F', paper: '#FBF7F0', line: '#E6D9C8', muted: '#6B6257', soft: '#F7DCD5' };
var COLS = MENU.length === 4 ? 2 : 3;
var W = 2500, H = 1686, CW = W / COLS, CH = H / 2;
var canvas = document.getElementById('c'), ctx = canvas.getContext('2d');

// 圖示用 Tabler Icons（MIT 授權）。抓 SVG 回來把線條換成指定的顏色，再畫到畫布上
function icon(name, color) {
  return fetch('https://cdn.jsdelivr.net/npm/@tabler/icons@3.19.0/icons/outline/' + name + '.svg').then(function (r) {
    if (!r.ok) throw new Error('抓不到圖示 ' + name);
    return r.text();
  }).then(function (svg) {
    svg = svg.replace(/currentColor/g, color).replace(/stroke-width="2"/, 'stroke-width="1.6"');
    return new Promise(function (ok, fail) {
      var img = new Image();
      img.onload = function () { ok(img); };
      img.onerror = function () { fail(new Error('圖示畫不出來 ' + name)); };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    });
  });
}

Promise.all(MENU.map(function (m) { return icon(m.icon, m.primary ? '#FFFFFF' : UI.brand); })).then(function (icons) {
  ctx.fillStyle = UI.paper; ctx.fillRect(0, 0, W, H);
  MENU.forEach(function (m, i) {
    var x = (i % COLS) * CW, y = Math.floor(i / COLS) * CH;
    if (m.primary) { ctx.fillStyle = UI.brand; ctx.fillRect(x, y, CW, CH); }
    var s = 300;
    ctx.drawImage(icons[i], x + (CW - s) / 2, y + 190, s, s);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = m.primary ? '#FFFFFF' : UI.brandDark;
    ctx.font = '700 132px "Noto Sans TC","Microsoft JhengHei",sans-serif';
    ctx.fillText(m.label, x + CW / 2, y + 640);
    ctx.fillStyle = m.primary ? UI.soft : UI.muted;
    ctx.font = '400 72px "Noto Sans TC","Microsoft JhengHei",sans-serif';
    ctx.fillText(m.hint, x + CW / 2, y + 745);
  });
  ctx.fillStyle = UI.line;
  for (var c = 1; c < COLS; c++) ctx.fillRect(c * CW - 3, 0, 6, H);
  ctx.fillRect(0, CH - 3, W, 6);
  document.getElementById('status').textContent = '畫好了';
  document.getElementById('save').disabled = false;
  window.__ready = true;
}).catch(function (e) { document.getElementById('status').textContent = e.message; window.__error = e.message; });

document.getElementById('save').onclick = function () {
  canvas.toBlob(function (blob) {
    fetch('/save-menu', { method: 'POST', body: blob }).then(function (r) { return r.text(); }).then(function (t) {
      document.getElementById('status').textContent = t; window.__saved = t;
    });
  }, 'image/png');
};
</script>`;
}

function saveMenu(buffer) {
  const dir = path.join(__dirname, '..', 'design');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '圖文選單.png');
  fs.writeFileSync(file, buffer);
  return '已存到 design/圖文選單.png（' + Math.round(buffer.length / 1024) + ' KB）';
}

module.exports = { cardsPage, menuPage, saveMenu, MENU };
