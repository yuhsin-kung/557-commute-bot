// 抓「實際選課人數」：貼到自己已經登入校務行政資訊系統的 Chrome 主控台執行（F12 → Console）。
//
// 為什麼要這樣：公開的課表只有「人數上限」，實際選課人數要登入後在
//   一般服務 → 教務 → 全校課務資料查詢 → 科目資料（學系）才看得到。
// 這支程式替你一個系一個系按查詢（每 5 秒一次，全部大約 150 次、13 分鐘），
// 只讀結果表格裡的「選課編號、科目代碼、人數上限、選課人數、班級名稱」，最後下載成 CSV。
// 不會讀成績或任何個人資料；登入狀態只留在你自己的瀏覽器裡。
//
// 用法：
//   1. 登入後，點左邊選單的「科目資料（學系）」，讓查詢畫面出現（不用按查詢）
//   2. F12 → Console，把整段貼上，按 Enter（Chrome 不讓貼就先輸入 allow pasting）
//   3. 右上角會出現進度；跑完自動下載「選課人數_115_1.csv」，放到 tools/ 資料夾
//   中途想停：關掉分頁，或在主控台輸入 __stopEnroll = true
//   被學校系統擋下來或被登出會自己停；重新登入後再貼一次，會從上次的地方接著抓
(async () => {
  const DELAY = 5000;
  const KEY = 'scu_enroll_progress';

  // 找到「科目資料（學系）」的查詢表單（在某一個框架裡）
  let host = null;
  const walk = w => {
    try {
      const f = [...w.document.forms].find(x => /course204\.asp/i.test(x.action));
      if (f) host = { win: w, doc: w.document, form: f };
      for (let i = 0; i < w.frames.length; i++) walk(w.frames[i]);
    } catch (e) { /* 別的網域的框架，跳過 */ }
  };
  walk(window.top);
  if (!host) { console.error('找不到查詢表單。請先點左邊選單的「科目資料（學系）」，再貼一次。'); return; }
  const { doc, form } = host;
  const year = form.syear.value, term = form.smester.value;
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  // 進度顯示在右上角
  const box = window.top.document.createElement('div');
  box.style.cssText = 'position:fixed;top:8px;right:8px;z-index:99999;background:#1b1d22;color:#fff;padding:10px 14px;border-radius:8px;font:14px sans-serif;max-width:320px';
  (window.top.document.body || window.top.document.documentElement).appendChild(box);
  const say = t => { box.textContent = t; console.log(t); };

  // 每個部別有哪些系：切換部別的下拉選單，讀系所清單（跟你手動點是一樣的動作）
  const combos = [];
  for (let i = 0; i < form.clsid1.options.length; i++) {
    form.clsid1.selectedIndex = i;
    if (typeof form.clsid1.onchange === 'function') form.clsid1.onchange();
    else form.clsid1.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
    [...form.clsid02.options].forEach(o => combos.push([form.clsid1.options[i].value, o.value]));
  }
  const all = [...form.clsid3.options].find(o => /全部/.test(o.text));
  if (!all) { console.error('找不到年級的「全部」選項，頁面可能改版了。'); return; }

  // 接著上次的進度
  let progress = { year, term, done: {}, rows: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && saved.year === year && saved.term === term) progress = saved;
  } catch (e) { /* 沒有進度就從頭 */ }
  const todo = combos.filter(c => !(c.join('|') in progress.done));
  say('共 ' + combos.length + ' 個系所，還要查 ' + todo.length + ' 個');

  // 用隱藏的框架送出查詢，瀏覽器會自己處理中文編碼
  const frame = doc.createElement('iframe');
  frame.name = 'enroll_result';
  frame.style.cssText = 'position:absolute;width:1px;height:1px;left:-9999px';
  doc.body.appendChild(frame);

  const query = (program, dept) => new Promise(resolve => {
    const f = doc.createElement('form');
    f.method = 'post'; f.action = form.action; f.target = frame.name; f.acceptCharset = doc.characterSet;
    [['clsid1', program], ['clsid02', dept], ['clsid3', all.value], ['syear', year], ['smester', term]].forEach(([k, v]) => {
      const input = doc.createElement('input'); input.type = 'hidden'; input.name = k; input.value = v; f.appendChild(input);
    });
    doc.body.appendChild(f);
    const timer = setTimeout(() => resolve(null), 20000);
    frame.onload = () => { clearTimeout(timer); f.remove(); resolve(frame.contentDocument); };
    f.submit();
  });

  const cell = td => td.textContent.replace(/\s+/g, ' ').trim();
  const parse = d => {
    const out = [];
    d.querySelectorAll('table').forEach(table => {
      const trs = [...table.rows].map(tr => [...tr.cells].map(cell));
      const head = trs.find(r => r.some(c => /選課\s*編號/.test(c)) && r.some(c => /選課\s*人數/.test(c)));
      if (!head) return;
      const at = re => head.findIndex(c => re.test(c));
      const iNo = at(/選課\s*編號/), iCode = at(/科目\s*代碼/), iCap = at(/人數\s*上限/), iGot = at(/選課\s*人數/), iCls = at(/班級/);
      trs.forEach(r => { if (/^\d{3,5}$/.test(r[iNo] || '')) out.push([r[iNo], r[iCode] || '', r[iCap] || '', r[iGot] || '', iCls >= 0 ? r[iCls] : '']); });
    });
    return out;
  };

  window.__stopEnroll = false;
  for (let i = 0; i < todo.length; i++) {
    if (window.__stopEnroll) { say('已手動停止。進度有存，重新貼一次會接著抓。'); return; }
    const [program, dept] = todo[i];
    const d = await query(program, dept);
    const text = d && d.body ? d.body.textContent : '';
    if (!d || /Servicecheck|系統偵測您使用的IP|學號或人事代碼|請重新登入/.test(text)) {
      say('被學校系統擋下來或被登出了，先停。已查 ' + Object.keys(progress.done).length + ' 個，進度有存；過一陣子重新登入後再貼一次。');
      return;
    }
    const rows = parse(d);
    progress.rows.push(...rows);
    progress.done[program + '|' + dept] = rows.length;
    try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (e) { /* 存不了就算了，最後還是會下載 */ }
    say((i + 1) + '/' + todo.length + '　' + dept.replace(/^.{4}/, '') + '：' + rows.length + ' 門課（累計 ' + progress.rows.length + '）');
    if (i + 1 < todo.length) await sleep(DELAY);
  }

  // 同一門課會出現在好幾個系（例如第二專長），用選課編號去掉重複
  const seen = {};
  const unique = progress.rows.filter(r => (seen[r[0]] ? false : (seen[r[0]] = true)));
  const csv = '﻿' + [['選課編號', '科目代碼', '人數上限', '選課人數', '班級名稱']].concat(unique)
    .map(r => r.map(v => (/[",\n]/.test(v) ? '"' + String(v).replace(/"/g, '""') + '"' : v)).join(',')).join('\n') + '\n';
  const a = window.top.document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = '選課人數_' + year + '_' + term + '.csv';
  window.top.document.body.appendChild(a);
  a.click();
  a.remove();
  localStorage.removeItem(KEY);
  say('完成！' + unique.length + ' 門課，已下載「' + a.download + '」。這個視窗可以關掉了。');
})();
