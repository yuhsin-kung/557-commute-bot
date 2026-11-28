/**
 * 共乘等車室的網頁（共乘.gs 的 doGet 會送出這一頁）
 *
 * 每 3 秒問一次 cpRoomState，畫面上的人數、倒數、每人金額就會跟著更新；
 * 人數變多時響一聲。因為是網頁自己來問，不會用到 LINE 的推播額度。
 * __TOKEN__、__BOT__ 會在 doGet 換成這個人的代碼和 Bot 的 ID。
 */
const ROOM_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<base target="_top">
<style>
  :root { --bg:#f4f5f7; --card:#fff; --ink:#1c2330; --sub:#667085; --line:#e4e7ec; --main:#0b6e4f; --main-ink:#fff; --warn:#b54708; --soft:#e8f3ef; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#12161c; --card:#1c222b; --ink:#eef1f5; --sub:#98a2b3; --line:#2c3440; --main:#3ecf9a; --main-ink:#0c1f18; --warn:#fdb022; --soft:#1d2f29; }
  }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--ink); font:16px/1.5 -apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:18px; margin:0 auto 12px; max-width:440px; }
  .dir { font-size:14px; color:var(--sub); }
  h1 { font-size:22px; margin:2px 0 0; }
  .big { font-size:44px; font-weight:700; font-variant-numeric:tabular-nums; line-height:1.15; margin-top:10px; }
  .big small { font-size:16px; font-weight:400; color:var(--sub); }
  .hint { color:var(--sub); font-size:14px; margin-top:4px; }
  .seats { display:flex; gap:8px; margin:14px 0 4px; }
  .seat { flex:1; height:10px; border-radius:5px; background:var(--line); }
  .seat.on { background:var(--main); }
  ul { list-style:none; margin:10px 0 0; padding:0; }
  li { display:flex; justify-content:space-between; padding:9px 0; border-top:1px solid var(--line); }
  li span.tag { color:var(--sub); font-size:14px; }
  button, a.btn { display:block; width:100%; margin-top:10px; padding:14px; border-radius:12px; border:1px solid var(--line); background:var(--card); color:var(--ink); font-size:17px; text-align:center; text-decoration:none; }
  button.main, a.btn.main { background:var(--main); border-color:var(--main); color:var(--main-ink); font-weight:700; }
  button:disabled { opacity:.5; }
  .note { background:var(--soft); border-radius:10px; padding:12px; margin-top:12px; font-size:15px; }
  .warn { color:var(--warn); }
  .foot { text-align:center; color:var(--sub); font-size:13px; max-width:440px; margin:0 auto; }
</style>
</head>
<body>
<div id="app"><div class="card">載入中…</div></div>
<p class="foot" id="foot"></p>
<script>
var TOKEN = '__TOKEN__', BOT = '__BOT__';
var state = null, offset = 0, lastCount = -1, soundOn = false, audio = null, busy = false;
// 這一頁是包在 Apps Script 的框架裡顯示的，瀏覽器會擋掉框架裡的 confirm()、alert()，
// 所以「確定要離開嗎」要直接畫在頁面上。asking 是正在問的那一句，failed 是上一個動作沒送成功。
var asking = '', failed = false;
var ASK = { wait: '確定要離開這一團嗎？', formed: '已經成團了，現在離開會扣信用分。確定嗎？' };

function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function chat(text) { return 'https://line.me/R/oaMessage/' + encodeURIComponent(BOT) + '/?' + encodeURIComponent(text); }
function mmss(ms) {
  var s = Math.max(0, Math.ceil(ms / 1000));
  if (s >= 3600) return Math.floor(s / 3600) + ' 小時 ' + Math.floor(s % 3600 / 60) + ' 分';
  return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
}

function beep() {
  if (!soundOn || !audio) return;
  [0, 0.25].forEach(function (t) {
    var o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.25, audio.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.2);
    o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.2);
  });
}
function enableSound() {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); soundOn = true; beep(); } catch (e) { soundOn = false; }
  render(state);
}

function poll() {
  if (busy) return;
  google.script.run.withSuccessHandler(render).withFailureHandler(function () {}).cpRoomState(TOKEN);
}
function act(action) {
  asking = '';
  failed = false;
  busy = true;
  document.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  google.script.run
    .withSuccessHandler(function (s) { busy = false; render(s); })
    .withFailureHandler(function () { busy = false; failed = true; render(state); })
    .cpRoomAction(TOKEN, action);
}
function ask(kind) { asking = ASK[kind]; render(state); }
function keep() { asking = ''; render(state); }
function leaveButton(label, kind) {
  if (!asking) return '<button onclick="ask(\\'' + kind + '\\')">' + label + '</button>';
  return '<div class="note warn">' + esc(asking) + '</div>'
    + '<button class="main" onclick="act(\\'leave\\')">確定離開</button>'
    + '<button onclick="keep()">不要，留下來</button>';
}

function members(s) {
  return '<ul>' + s.members.map(function (m) {
    var tags = [];
    if (m.leader) tags.push('團主');
    if (m.boarded) tags.push('已上車'); else if (s.type === '預約') tags.push(m.arrived ? '已到' : '還沒到');
    return '<li><span>' + esc(m.name) + (m.me ? '（我）' : '') + '</span><span class="tag">' + tags.join('・') + '</span></li>';
  }).join('') + '</ul>';
}
function seats(s) {
  var h = '<div class="seats">';
  for (var i = 0; i < s.seats; i++) h += '<div class="seat' + (i < s.members.length ? ' on' : '') + '"></div>';
  return h + '</div>';
}
function nextShare(s) {
  var n = s.members.length;
  if (n >= s.seats) return '';
  return '再多 1 人，每人變 ' + Math.ceil(s.total / (n + 1) / 5) * 5 + ' 元';
}

function render(s) {
  if (!s) return;
  state = s;
  var app = document.getElementById('app'), h = '';
  if (!s.ok) {
    h = '<div class="card"><h1>連結失效了</h1><p class="hint">回 LINE 傳「查看我的共乘」，再打開一次等車室。</p><a class="btn main" href="' + chat('查看我的共乘') + '">回 LINE</a></div>';
  } else if (s.none) {
    h = '<div class="card"><h1>你目前沒有共乘</h1><p class="hint">回 LINE 傳「共乘」就能開始。</p><a class="btn main" href="' + chat('共乘') + '">我要共乘</a></div>';
  } else {
    offset = s.now - Date.now();
    var n = s.members.length;
    if (lastCount >= 0 && n > lastCount) beep();
    lastCount = n;
    var head = '<div class="dir">' + esc(s.type) + '・' + esc(s.when) + ' 出發</div><h1>' + esc(s.dir) + '</h1>';
    var meet = '<div class="note">集合點：' + esc(s.meet) + '</div>';
    var arrivedBtn = (s.type === '預約' && !s.arrived) ? '<button class="main" onclick="act(\\'arrived\\')">我到了</button>' : '';

    if (s.status === '等待中') {
      h = '<div class="card">' + head
        + '<div class="big"><span id="cd">–:––</span> <small>' + (s.type === '預約' ? '後出發' : '後成團') + '</small></div>'
        + seats(s)
        + '<div class="big">' + s.share + ' <small>元／人（' + n + ' 人）</small></div>'
        + '<div class="hint">' + nextShare(s) + '</div>'
        + members(s) + meet + arrivedBtn
        + (soundOn ? '' : '<button onclick="enableSound()">🔔 開啟提示音（有人加入會響）</button>')
        + leaveButton('離開', 'wait') + '</div>';
    } else if (s.status === '已成團' || s.status === '已叫車') {
      var called = s.status === '已叫車';
      h = '<div class="card">' + head
        + '<div class="big">' + s.share + ' <small>元／人（' + n + ' 人成團）</small></div>'
        + members(s) + meet;
      if (s.boarded) {
        h += '<div class="note">✅ 已上車。' + (s.isLeader ? '車資你先付，其他人會轉 ' + s.share + ' 元給你。' : '記得轉 ' + s.share + ' 元給團主。') + '</div>';
      } else {
        h += arrivedBtn;
        if (!called && s.isLeader) {
          h += '<div class="note">你是團主：用你的叫車 App 叫車到集合點，車資你先付，其他人各轉 ' + s.share + ' 元給你。</div>'
            + '<button class="main" onclick="act(\\'call\\')">我叫車了</button>';
        } else if (!called) {
          h += '<div class="note">等團主叫車。車資團主先付，到時候轉 ' + s.share + ' 元給他。</div>';
        } else {
          h += '<div class="note">團主已經叫車了，上車後按下面的按鈕。</div>';
        }
        if (called || !s.isLeader) h += '<button class="' + (called ? 'main' : '') + '" onclick="act(\\'board\\')">上車了</button>';
        h += leaveButton('我不搭了', 'formed');
      }
      h += '</div>';
    } else if (s.status === '已出發') {
      h = '<div class="card">' + head + '<div class="big">一路順風 🚕</div><div class="note">' + n + ' 人共乘，每人 ' + s.share + ' 元。'
        + (s.isLeader ? '其他人會轉給你。' : '記得轉給團主。') + '</div></div>';
    } else if (s.status === '獨行') {
      h = '<div class="card">' + head + '<div class="big">這次沒有人順路</div>'
        + '<div class="note">' + (s.reward ? '謝謝你用共乘，送你 ' + s.reward + ' 點 🎁' : '謝謝你用共乘！今天的獎勵已經領過了。') + '</div>'
        + '<p class="hint">接下來要怎麼去？</p>'
        + '<a class="btn main" href="' + chat('比較所有路線') + '">改搭公車（比較所有路線）</a>'
        + '<a class="btn" href="' + chat('共乘') + '">再開一次鈴</a></div>';
    } else {
      h = '<div class="card">' + head + '<div class="big">這一團結束了</div><a class="btn main" href="' + chat('共乘') + '">再找一團</a></div>';
    }
    document.getElementById('foot').textContent = '信用分 ' + s.credit + '・積分 ' + s.points;
  }
  if (failed) h += '<div class="card warn">剛剛沒有送出去，請再按一次。</div>';
  app.innerHTML = h;
  tick();
}

function tick() {
  var el = document.getElementById('cd');
  if (el && state && state.departAt) el.textContent = mmss(state.departAt - (Date.now() + offset));
}

setInterval(tick, 500);
setInterval(poll, 3000);
poll();
</script>
</body>
</html>`;
