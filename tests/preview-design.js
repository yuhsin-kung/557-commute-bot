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

// 圖文選單（2500×1686，11/28 改成「上面一大格＋下面三格」）：主打「幾點出門、幾點到東吳」放最上面整排。
// 每一格的 text 是按了以後替使用者傳出去的字，要跟 LINE 後台設定的一樣（也要是 bot/選單.gs 認得的分類名稱）。
// rect 是這一格的位置 [x, y, 寬, 高]，LINE 後台用「上 1 下 3」的版型；用 Messaging API 設定時照這個填 bounds。
const MENU = [
  { icon: 'clock-hour-8', label: '幾點出門、幾點到東吳', hint: '傳位置就知道・要趕課幫你倒推・尖峰把排隊算進去', text: '幾點出門、幾點到東吳', primary: true, rect: [0, 0, 2500, 843] },
  { icon: 'bus', label: '出門前提醒', hint: '557 動態・天氣・上車地點', text: '出門前提醒', rect: [0, 843, 833, 843] },
  { icon: 'car', label: '557 以外的選擇', hint: '共乘・YouBike・雨傘', text: '557 以外的選擇', rect: [833, 843, 834, 843] },
  { icon: 'award', label: '積分與打卡', hint: '5 點換 30 元學餐券', text: '積分與打卡', rect: [1667, 843, 833, 843] },
];

function menuPage() {
  return `<!doctype html><meta charset="utf-8"><title>圖文選單</title>
<style>body{margin:0;padding:16px;font-family:sans-serif;background:#eee}canvas{width:100%;max-width:900px;display:block;border:1px solid #ccc}button{font-size:16px;padding:10px 18px;margin:12px 0}</style>
<button id="save" disabled>存成 PNG</button> <span id="status">載入圖示中…</span>
<canvas id="c" width="2500" height="1686"></canvas>
<script>
var MENU = ${JSON.stringify(MENU)};
var UI = { brand: '#A63A2B', brandDark: '#7A2A1F', paper: '#FBF7F0', line: '#E6D9C8', muted: '#6B6257', soft: '#F7DCD5' };
var W = 2500, H = 1686;
var canvas = document.getElementById('c'), ctx = canvas.getContext('2d');
var FONT = '"Noto Sans TC","Microsoft JhengHei",sans-serif';

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

// 字太長就縮小，左右留 pad
function fit(text, weight, size, maxW) {
  ctx.font = weight + ' ' + size + 'px ' + FONT;
  while (ctx.measureText(text).width > maxW && size > 20) { size -= 4; ctx.font = weight + ' ' + size + 'px ' + FONT; }
  return size;
}

document.fonts.ready.then(function () {
  return Promise.all(MENU.map(function (m) { return icon(m.icon, m.primary ? '#FFFFFF' : UI.brand); }));
}).then(function (icons) {
  ctx.fillStyle = UI.paper; ctx.fillRect(0, 0, W, H);
  MENU.forEach(function (m, i) {
    var x = m.rect[0], y = m.rect[1], w = m.rect[2], h = m.rect[3];
    ctx.textBaseline = 'alphabetic';
    if (m.primary) {
      // 主打：磚紅底，左邊大圖示、右邊兩行字
      ctx.fillStyle = UI.brand; ctx.fillRect(x, y, w, h);
      var s = 400, ix = x + 170, iy = y + (h - s) / 2;
      ctx.drawImage(icons[i], ix, iy, s, s);
      var tx = ix + s + 110, maxW = x + w - tx - 120;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#FFFFFF';
      fit(m.label, 700, 170, maxW);
      ctx.fillText(m.label, tx, y + h / 2 + 10);
      ctx.fillStyle = UI.soft;
      fit(m.hint, 400, 76, maxW);
      ctx.fillText(m.hint, tx, y + h / 2 + 150);
    } else {
      var s2 = 260;
      ctx.drawImage(icons[i], x + (w - s2) / 2, y + 150, s2, s2);
      ctx.textAlign = 'center';
      ctx.fillStyle = UI.brandDark;
      fit(m.label, 700, 116, w - 90);
      ctx.fillText(m.label, x + w / 2, y + 560);
      ctx.fillStyle = UI.muted;
      fit(m.hint, 400, 64, w - 90);
      ctx.fillText(m.hint, x + w / 2, y + 660);
    }
  });
  ctx.fillStyle = UI.line;
  ctx.fillRect(0, 843 - 3, W, 6);
  ctx.fillRect(833 - 3, 843, 6, H - 843);
  ctx.fillRect(1667 - 3, 843, 6, H - 843);
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
