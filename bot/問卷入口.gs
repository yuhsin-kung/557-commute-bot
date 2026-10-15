/**
 * 問卷入口：A／B／C 三個版本只發一個連結，由程式分配
 *
 * 原本每個班群拿到固定一個版本的連結，結果哪個版本給了哪個年級，就決定了那個版本的人是誰
 * （例如 A 版 86% 是大二），比較三個版本時分不出差異是版本造成的還是年級造成的。
 *
 * 現在所有班群都發同一個連結：部署網址?page=survey
 *   1. 同學先點自己的年級
 *   2. 程式看「這個年級在三個版本各有幾個人」，送到最少的那個版本（一樣少就隨機）
 *   3. 打開的問卷年級已經幫他填好
 * 這樣每個年級都會平均分到 A、B、C（分層分配），三個版本的總人數也會跟著拉平。
 *
 * 設定：指令碼屬性 SURVEY_A、SURVEY_B、SURVEY_C 填三份表單的網址（編輯網址或填寫網址都可以，要是隊伍帳號的表單）。
 * 每一次分配都記在「問卷分流」分頁。
 * 用到 Code.gs 的 PROPS、TZ，共乘.gs 的 cpSheet_、cpLocked_、cpNow_，卡片.gs 的 UI。
 */
const SV_VERSIONS = ['A', 'B', 'C'];
const SV_GRADE_TITLE = '年級';    // 三份表單裡年級那一題的題目
const SV_PENDING_MIN = 20;        // 分配後多久內還沒交卷，也先算進那個版本（避免很多人同時點都被送到同一版）
const SV_HEAD = ['時間', '年級', '版本', '當時這個年級的人數 A／B／C'];

// ===== 網頁 =====

function surveyPage_() {
  let grades = [];
  try {
    grades = svGrades_();
  } catch (err) {
    console.error(err);
  }
  return HtmlService.createHtmlOutput(SV_HTML.replace('__GRADES__', JSON.stringify(grades)))
    .setTitle('東吳外雙溪通勤問卷')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** 網頁按了年級後呼叫：回傳 { ok, url } 或 { ok: false, message }。公開網頁呼叫得到，所以年級只收表單上有的選項 */
function surveyPick(grade) {
  return cpLocked_(() => { // 共乘.gs
    const forms = svForms_();
    if (!forms) return { ok: false, message: '問卷入口還沒設定好，請跟發問卷的同學說一聲。' };
    if (svGrades_().indexOf(grade) < 0) return { ok: false, message: '請重新選一次年級。' };

    const counts = svCounts_(forms, grade);
    const least = Math.min.apply(null, SV_VERSIONS.map(v => counts[v]));
    const candidates = SV_VERSIONS.filter(v => counts[v] === least);
    const version = candidates[Math.floor(Math.random() * candidates.length)];

    cpSheet_('問卷分流', SV_HEAD).appendRow([cpNow_(), grade, version, SV_VERSIONS.map(v => counts[v]).join('／')]);
    return { ok: true, url: svPrefilledUrl_(forms[version], grade) };
  });
}

// ===== 計算 =====

/** 三份表單；有一份沒設定就回傳 null */
function svForms_() {
  const ids = SV_VERSIONS.map(v => svFormId_(PROPS.getProperty('SURVEY_' + v)));
  if (ids.indexOf('') >= 0) return null;
  const forms = {};
  SV_VERSIONS.forEach((v, i) => { forms[v] = FormApp.openById(ids[i]); });
  return forms;
}

/** 網址或 ID 都可以：https://docs.google.com/forms/d/<ID>/edit → <ID> */
function svFormId_(value) {
  const m = String(value || '').match(/\/forms\/d\/(?:e\/)?([\w-]{20,})/) || String(value || '').match(/^([\w-]{20,})$/);
  return m ? m[1] : '';
}

/** 年級的選項照 A 版表單上的（例如「碩 / 博士班」），表單改了選項這裡也會跟著變 */
function svGrades_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('sv_grades');
  if (hit) return JSON.parse(hit);
  const forms = svForms_();
  if (!forms) return [];
  const grades = svGradeItem_(forms.A).getChoices().map(c => c.getValue());
  cache.put('sv_grades', JSON.stringify(grades), 600);
  return grades;
}

function svGradeItem_(form) {
  const item = form.getItems().filter(i => i.getTitle().trim() === SV_GRADE_TITLE)[0];
  if (!item) throw new Error('表單「' + form.getTitle() + '」裡找不到「' + SV_GRADE_TITLE + '」這一題');
  return item.asMultipleChoiceItem();
}

/**
 * 這個年級在每個版本有幾個人：已經交卷的＋最近 20 分鐘分配出去、可能還在填的。
 * 交卷的人數快取一分鐘，不然每個人點一下就要把三份問卷的回覆全部讀一次。
 */
function svCounts_(forms, grade) {
  const cache = CacheService.getScriptCache();
  let done = cache.get('sv_done');
  if (done) {
    done = JSON.parse(done);
  } else {
    done = {};
    SV_VERSIONS.forEach(v => {
      done[v] = {};
      forms[v].getResponses().forEach(r => {
        r.getItemResponses().forEach(ir => {
          if (ir.getItem().getTitle().trim() !== SV_GRADE_TITLE) return;
          const g = String(ir.getResponse());
          done[v][g] = (done[v][g] || 0) + 1;
        });
      });
    });
    cache.put('sv_done', JSON.stringify(done), 60);
  }
  const since = cpNow_().getTime() - SV_PENDING_MIN * 60000;
  const pending = { A: 0, B: 0, C: 0 };
  cpSheet_('問卷分流', SV_HEAD).getDataRange().getValues().slice(1)
    .filter(r => r[1] === grade && new Date(r[0]).getTime() >= since)
    .forEach(r => { if (pending[r[2]] !== undefined) pending[r[2]] += 1; });
  const counts = {};
  SV_VERSIONS.forEach(v => { counts[v] = (done[v][grade] || 0) + pending[v]; });
  return counts;
}

/** 年級已經填好的問卷網址 */
function svPrefilledUrl_(form, grade) {
  return form.createResponse().withItemResponse(svGradeItem_(form).createResponse(grade)).toPrefilledUrl();
}

// ===== 在編輯器裡手動執行 =====

/** 看看設定對不對：三份表單讀不讀得到、年級選項、每個版本每個年級現在幾個人 */
function 測試問卷入口() {
  if (tooSoon_('測試問卷入口', 60)) return; // Code.gs：公開網頁也呼叫得到，一分鐘只跑一次
  const forms = svForms_();
  if (!forms) {
    console.log('還沒設定：到指令碼屬性加 SURVEY_A、SURVEY_B、SURVEY_C，值填三份表單的網址。');
    return;
  }
  const grades = svGrades_();
  console.log('年級選項：' + grades.join('、'));
  grades.forEach(g => {
    const c = svCounts_(forms, g);
    console.log(g + '：A ' + c.A + '／B ' + c.B + '／C ' + c.C);
  });
  console.log('發給班群的連結：' + cpWebAppUrl_() + '?page=survey'); // 共乘.gs
}

const SV_HTML = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<base target="_top">
<style>
  :root { --brand:#A63A2B; --brand-dark:#7A2A1F; --paper:#FBF7F0; --soft:#F3E9DC; --ink:#1B1D22; --muted:#6B6257; }
  * { box-sizing:border-box; }
  body { margin:0; padding:16px; background:#EFE7DB; color:var(--ink); font:16px/1.6 -apple-system,"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif; }
  .card { background:var(--paper); border-radius:16px; overflow:hidden; max-width:440px; margin:0 auto; }
  .head { background:var(--brand); color:#fff; padding:18px; }
  .head small { color:#F7DCD5; }
  .head h1 { font-size:21px; margin:2px 0 0; }
  .body { padding:18px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:12px; }
  button, a.go { display:block; width:100%; padding:14px 8px; border:0; border-radius:10px; background:var(--soft); color:var(--brand-dark); font-size:17px; font-weight:700; text-align:center; text-decoration:none; }
  button:disabled { opacity:.5; }
  a.go { background:var(--brand); color:#fff; margin-top:14px; }
  .muted { color:var(--muted); font-size:14px; }
</style>
</head>
<body>
<div class="card">
  <div class="head"><small>東吳通勤達人</small><h1>外雙溪通勤問卷</h1></div>
  <div class="body" id="box"></div>
</div>
<script>
var GRADES = __GRADES__;
var box = document.getElementById('box');
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

function ask() {
  if (!GRADES.length) { box.innerHTML = '<p>問卷入口還沒設定好，請跟發問卷的同學說一聲。</p>'; return; }
  box.innerHTML = '<p>謝謝你願意幫忙！先選你的年級，我們會帶你到問卷，年級已經幫你填好。</p>'
    + '<div class="grid">' + GRADES.map(function (g, i) { return '<button onclick="pick(' + i + ')">' + esc(g) + '</button>'; }).join('') + '</div>'
    + '<p class="muted">問卷匿名，約 3～5 分鐘。</p>';
}

function pick(i) {
  document.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
  google.script.run
    .withSuccessHandler(function (r) {
      if (!r.ok) { box.innerHTML = '<p>' + esc(r.message) + '</p>'; return; }
      // Apps Script 的網頁不能自己跳轉，要讓同學再按一下
      box.innerHTML = '<p>好了！你的問卷準備好了，年級是「' + esc(GRADES[i]) + '」。</p>'
        + '<a class="go" href="' + esc(r.url) + '">開始填問卷</a>'
        + '<p class="muted">選錯年級的話，<a href="#" onclick="ask();return false;">重新選</a>。</p>';
    })
    .withFailureHandler(function () { box.innerHTML = '<p>連線不穩，請重新整理再試一次。</p>'; })
    .surveyPick(GRADES[i]);
}

ask();
</script>
</body>
</html>`;
