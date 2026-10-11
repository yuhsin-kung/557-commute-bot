// 在電腦上預覽等車室：npm run preview，然後打開 http://localhost:4557
// 背後跑的是 bot/共乘.gs 本人（用 tests/gas-env.js 的假環境），不會碰到真的 Bot 和試算表。
// 可以假裝 A、B、C、D 四個同學傳訊息、開各自的等車室、把時間快轉。
const http = require('http');
const { loadBot } = require('./gas-env');

const PORT = 4557;
const env = loadBot(['Code.gs', '共乘.gs', '等車室.gs']);
env.context.__skip = 0;
env.run('cpNow_ = () => new Date(Date.now() + __skip)');
['A', 'B', 'C', 'D'].forEach((u, i) => { env.names[u] = ['小安', '阿哲', '芷晴', '冠廷'][i]; });

// 等車室網頁用 google.script.run 呼叫 Apps Script；預覽時改成打這台伺服器的 /rpc
const SHIM = `<script>
window.google = { script: { run: (function make(ok, fail) {
  return new Proxy({}, { get: function (_, name) {
    if (name === 'withSuccessHandler') return function (f) { return make(f, fail); };
    if (name === 'withFailureHandler') return function (f) { return make(ok, f); };
    return function () {
      fetch('/rpc', { method: 'POST', body: JSON.stringify({ fn: name, args: [].slice.call(arguments) }) })
        .then(function (r) { return r.json(); }).then(ok || function () {}, fail || function () {});
    };
  } });
})() } };
</script>`;

const textOf = answer => (Array.isArray(answer) ? answer : [answer])
  .map(m => (typeof m === 'string' ? m : m.text || (m.template && m.template.text) || '')).join('\n');

function home(result) {
  const cmds = ['共乘 去學校 現在走', '共乘 去學校 加入', '共乘 回士林 加入', '我的共乘', '取消共乘'];
  const users = ['A', 'B', 'C', 'D'].map(u => `<tr><th>${env.names[u]}（${u}）</th><td>`
    + cmds.map(c => `<a href="/say?u=${u}&t=${encodeURIComponent(c)}">${c}</a>`).join(' ｜ ')
    + ` ｜ <a href="/room?u=${u}" target="room${u}">打開等車室</a></td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>共乘預覽</title>
<style>body{font:15px/1.7 sans-serif;padding:20px;max-width:900px}th{text-align:left;padding-right:12px;white-space:nowrap}pre{background:#f3f4f6;padding:12px;border-radius:8px;white-space:pre-wrap}</style>
<h1>共乘預覽</h1>
<p>現在時間：${env.call('cpNow_').toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}
｜ <a href="/skip?min=1">快轉 1 分鐘</a> ｜ <a href="/skip?min=5">快轉 5 分鐘</a></p>
<table>${users}</table>
${result ? '<h2>Bot 回覆</h2><pre id="reply">' + result.replace(/</g, '&lt;') + '</pre>' : ''}
<h2>共乘團</h2><pre id="groups">${JSON.stringify(env.call('cpLoadGroups_').map(g => ({ 團號: g.id, 方向: g.dir, 類型: g.type, 狀態: g.status, 成員: g.members.map(m => m.name) })), null, 1)}</pre>`;
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (body, type = 'text/html; charset=utf-8') => { res.writeHead(200, { 'Content-Type': type }); res.end(body); };

  if (url.pathname === '/rpc' && req.method === 'POST') {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const { fn, args } = JSON.parse(raw);
      if (!/^cpRoom(State|Action)$/.test(fn)) { res.writeHead(400); return res.end(); }
      send(JSON.stringify(env.call(fn, ...args)), 'application/json');
    });
  } else if (url.pathname === '/room') {
    const page = env.call('doGet', { parameter: { page: 'room', t: env.call('cpUser_', url.searchParams.get('u')).token } });
    send(page.content.replace('<head>', '<head><title>' + page.title + '</title>').replace('<script>', SHIM + '<script>'));
  } else if (url.pathname === '/say') {
    send(home(textOf(env.call('cpText_', url.searchParams.get('u'), url.searchParams.get('t')))));
  } else if (url.pathname === '/skip') {
    env.context.__skip += Number(url.searchParams.get('min')) * 60000;
    env.call('共乘每分鐘檢查');
    send(home());
  } else {
    send(home());
  }
}).listen(PORT, () => console.log('共乘預覽：http://localhost:' + PORT));
