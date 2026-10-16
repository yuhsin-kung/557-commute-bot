// 從東吳「全校課表暨授課計畫查詢」抓全校課表，存成 bot/課表.csv 和 bot/課表熱度.csv。
//
// 這個查詢頁是公開的，不用登入：校務行政資訊系統 → 一般服務 → 教務 → 全校課表暨授課計畫查詢 → 課表
// 一個班級查一次，全校大約 500 個班級，每次間隔 5 秒，跑完大約 45 分鐘。
// ⚠️ 不要調快、不要同時開兩個在跑：2026-10-13 用 1 秒間隔（還同時跑了兩份）抓到第 200 次左右，
//    學校系統就改回「連線檢查」頁面，不給課表了。程式看到那個頁面會立刻停下來；
//    隔一陣子再執行同一個指令，會從上次的地方接著抓。
// 每抓完一個班級就存進 tools/課表進度.json（不進 git），全部抓完才寫 bot/課表.csv。
// 只留科目、人數、星期、節次、教室，不存老師姓名。
//
// 用法：node tools/抓課表.js [學年] [學期]      例如 node tools/抓課表.js 115 1
//       node tools/抓課表.js 115 1 --limit 5   只抓前 5 個班級，試跑用（不存檔）
//       node tools/抓課表.js 115 1 --delay 8   每次間隔 8 秒（最少 3 秒）
//       node tools/抓課表.js --heat            不重抓，只用現有的 bot/課表.csv 重算熱度
//       node tools/抓課表.js 115 1 --import tools/公開課表.json   用在瀏覽器裡抓好的課表（程式直接抓被擋時）
//
// 人數：公開課表上的「人數」是上限。實際選課人數要登入才看得到，用 tools/抓選課人數.console.js
// 在自己的瀏覽器抓成 tools/選課人數_學年_學期.csv，這支程式看到那個檔案就會用選課編號併進來。
// bot/課表.csv、選課人數的 CSV 都不進 git（個別課程的選課人數是登入後才看得到的資料），
// 進 git 的只有加總後的 bot/課表熱度.csv 和 bot/課表熱度資料.gs。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = 'https://web.sys.scu.edu.tw';
const OUT = path.join(__dirname, '..', 'bot', '課表.csv');
const HEAT = path.join(__dirname, '..', 'bot', '課表熱度.csv');
const HEAT_GS = path.join(__dirname, '..', 'bot', '課表熱度資料.gs');
const PROGRESS = path.join(__dirname, '課表進度.json');
const HEAD = ['部別', '開課班級', '選課編號', '科目代碼', '科目名稱', '組別', '人數上限', '星期', '節次', '週別', '教室', '校區', '大樓', '選課人數'];
const DAYS = ['一', '二', '三', '四', '五', '六', '日'];
// 節次和上課時間（bot/節次.csv）
const PERIODS = { 1: '08:10', 2: '09:10', 3: '10:10', 4: '11:10', E: '12:10', 5: '13:10', 6: '14:10', 7: '15:10', 8: '16:10', 9: '17:10', A: '18:25', B: '19:20', C: '20:20', D: '21:15' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[\s　]+/g, ' ').trim();

/** 查詢頁用 JavaScript 的陣列記著每個部別有哪些系、每個系有哪些班，照它的規則列出全部班級 */
async function listClasses() {
  const html = await (await fetch(BASE + '/class401.asp')).text();
  if (isWall(html) || !/clsid1/.test(html)) {
    console.error('學校系統現在不給查（回了「連線檢查」頁面或頁面改版了），過一段時間再試。');
    process.exitCode = 2;
    return null;
  }
  const sandbox = { document: {} };
  vm.createContext(sandbox);
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { vm.runInContext(m[1].replace(/<!--|\/\/\s*-->|-->/g, ''), sandbox); } catch (err) { /* 跟班級清單無關的片段 */ }
  }
  const programs = [...html.match(/<select[^>]*name="?clsid1"?[\s\S]*?<\/select>/i)[0].matchAll(/<option[^>]*value="?([^">]+)"?/gi)].map(m => m[1]);
  const { key1, class1v } = sandbox;
  const out = [];
  programs.forEach((program, i) => {
    (key1[i] || []).filter(Boolean).forEach(dept => {
      const index = program.slice(0, 1) + dept.slice(2, 4); // 頁面上 Buildclsid34 的算法
      (class1v[index] || []).filter(Boolean).forEach(cls => out.push([program, dept, cls]));
    });
  });
  return out;
}

/** 查一個班級的課表，回傳每一個上課時段一列 */
async function fetchClass([program, dept, cls], year, term) {
  const body = new URLSearchParams({ clsid1: program, clsid02: dept, clsid34: cls, syear: String(year), smester: String(term) });
  const res = await fetch(BASE + '/class42.asp', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  if (isWall(html)) throw Object.assign(new Error('學校系統回了「連線檢查」頁面'), { wall: true });
  const rows = [];
  let last = null;
  for (const tr of html.split(/<tr[^>]*>/i).slice(1)) {
    const td = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => clean(m[1]));
    if (td.length < 15 || /Course|開課/.test(td[0])) continue;
    const [klass, selno, code, title, group, , , , , count, , day, section, week, room] = td;
    // 同一門課的第二個時段、演習、實習：前面幾欄是空的，沿用上一列
    if (code) last = { klass, selno, code, title, count };
    if (!last || !DAYS.includes(day) || !section) continue;
    rows.push([program.slice(1), last.klass || clean(cls.slice(6)), last.selno, last.code, last.title, group, last.count, day, section, week, room, ...place(room)]);
  }
  return rows;
}

/** 流量太大時，學校系統不回課表，改回一頁「系統偵測您使用的IP…請於 15 分鐘內登入系統」 */
function isWall(html) {
  return /Servicecheck|系統偵測您使用的IP/.test(html) && !/<td/i.test(html);
}

/** 教室代號 → [校區, 大樓]。英文字母開頭是外雙溪的大樓代號（D0317 是 D 棟）；數字開頭是城中校區 */
function place(room) {
  if (/^[A-Z]/i.test(room)) return ['外雙溪', room[0].toUpperCase()];
  if (/^[1-9]\d{3}/.test(room)) return ['城中', room[0]];
  return ['', ''];
}

const csv = rows => '﻿' + rows.map(r => r.map(v => (/[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v)).join(',')).join('\n') + '\n';

function parseCsv(text) {
  return text.replace(/^﻿/, '').trim().split(/\r?\n/).map(line => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out;
  });
}

/**
 * 課表熱度：外雙溪校區每個「星期 × 節次」有多少人「從這一節開始上課」。
 * 一門課連上 789 三節，只算在第 7 節（學生是第 7 節前到教室）。單週、雙週的課算一半。
 * 同一門課會出現在好幾個班級的課表裡，用「選課編號＋星期＋節次＋教室」去掉重複。
 * 這是「這一節開始有課的人數」，不是「這一節才到校的人數」：早八最準，下午的節次會高估（很多人早就在學校了）。
 */
function heat(rows) {
  const seen = new Set();
  const starts = {}, inClass = {};
  let used = 0;
  rows.forEach(r => {
    const [, , selno, code, , , cap, day, section, week, room, campus] = r;
    // 有併入實際選課人數（第 14 欄）就用它；沒有那一欄才退而用人數上限
    const n = Number(r.length > 13 ? r[13] : cap) * (week ? 0.5 : 1);
    if (campus !== '外雙溪' || !n || !DAYS.includes(day)) return;
    const key = [selno || code, day, section, room].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const periods = String(section).toUpperCase().split('').filter(p => PERIODS[p]);
    if (!periods.length) return;
    starts[day + periods[0]] = (starts[day + periods[0]] || 0) + n;
    periods.forEach(p => { inClass[day + p] = (inClass[day + p] || 0) + n; });
    used += 1;
  });
  // 至少到校 = 這一節在上課的人比上一節多出來的；至少離校 = 這一節上完後，下一節少掉的。
  // 學生的個別課表我們不知道，所以只能算「至少」：有人早八上完就走、同時有人十點才來，兩邊會互相抵掉。
  const order = Object.keys(PERIODS).sort((a, b) => PERIODS[a].localeCompare(PERIODS[b]));
  const out = [['星期', '節次', '上課時間', '開始上課的人數', '上課中的人數', '至少到校', '下課後至少離校']];
  DAYS.forEach(d => order.forEach((p, i) => {
    const now = inClass[d + p] || 0;
    if (!now && !starts[d + p]) return;
    const at = k => (k >= 0 && k < order.length ? inClass[d + order[k]] || 0 : 0);
    // 中午（第 E 節）很少排課，但大家是在學校吃飯、不是離校：
    // 第 5 節跟「第 4 節或中午」比，第 4 節跟「中午或第 5 節」比，才不會把午休算成一大群人離校又到校
    const before = order[i - 1] === 'E' ? Math.max(at(i - 1), at(i - 2)) : at(i - 1);
    const after = order[i + 1] === 'E' ? Math.max(at(i + 1), at(i + 2)) : at(i + 1);
    out.push([d, p, PERIODS[p], Math.round(starts[d + p] || 0), Math.round(now), Math.round(Math.max(0, now - before)), Math.round(Math.max(0, now - after))]);
  }));
  return { out, used };
}

/**
 * 把實際選課人數併進課表：公開課表上的「人數」是上限，實際選課人數要登入後才看得到
 * （差很多，例如上限 60、實際 33）。用 tools/抓選課人數.console.js 在自己的瀏覽器抓成
 * tools/選課人數_學年_學期.csv，這裡用選課編號對起來。
 * 對不到的（沒有選課編號的佔位課程，例如「通識課程（一）」）人數留空，熱度不算它。
 */
function mergeEnroll(rows, enrollRows) {
  const byNo = {};
  enrollRows.forEach(r => { byNo[String(r[0]).trim()] = String(r[3]).trim(); });
  let matched = 0, missing = 0;
  const out = rows.map(r => {
    const got = byNo[String(r[2]).trim()];
    if (got === undefined) missing += 1; else matched += 1;
    return r.slice(0, 13).concat([got === undefined ? '' : got]);
  });
  return { rows: out, matched, missing };
}

/** Bot 用的資料檔（bot/課表熱度資料.gs）：熱度只有幾十格，直接寫成程式裡的常數，不用另外匯入試算表 */
function heatGs(table, meta) {
  const data = {};
  // 每一格：[至少到校, 開始上課, 上課中, 下課後至少離校]
  table.slice(1).forEach(([day, period, , start, now, arrive, leave]) => { (data[day] = data[day] || {})[period] = [arrive, start, now, leave].map(Number); });
  const today = new Date().toISOString().slice(0, 10);
  return [
    '/**',
    ' * 課表熱度的資料（8）。這個檔案是 tools/抓課表.js 產生的，不要手動改；換學期時重跑那支程式。',
    ' * 外雙溪校區每個「星期 × 節次」：[至少到校, 開始上課, 上課中, 下課後至少離校]（人）。',
    ' * 「至少到校」是這一節上課中的人比上一節多出來的；「至少離校」是下一節少掉的。時間和教室來自公開的全校課表，',
    ' * 人數是' + (meta.enroll ? '實際選課人數（登入後的「科目資料（學系）」）。' : '「人數上限」（還沒併入實際選課人數，會高估）。'),
    ' */',
    'const HEAT_SOURCE = ' + JSON.stringify({ year: Number(meta.year), term: Number(meta.term), updated: today, meetings: meta.meetings, count: meta.enroll ? '實際選課人數' : '人數上限' }) + ';',
    'const HEAT_DATA = {',
  ].concat(
    Object.keys(data).map(d => '  ' + d + ': ' + JSON.stringify(data[d]).replace(/"(\w)":/g, '$1: ').replace(/\],/g, '], ') + ','),
    ['};', ''],
  ).join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const flag = name => args.includes(name);
  const numbers = args.filter(a => /^\d+$/.test(a));
  const limit = flag('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
  let rows;

  const year = numbers[0] || 115, term = numbers[1] || 1;
  if (flag('--heat')) {
    rows = parseCsv(fs.readFileSync(OUT, 'utf8')).slice(1);
  } else if (flag('--import')) {
    // 在瀏覽器裡抓的（學校系統擋掉程式直接送的請求時用）：每列 11 欄，補上校區和大樓
    rows = JSON.parse(fs.readFileSync(args[args.indexOf('--import') + 1], 'utf8')).rows.map(r => r.slice(0, 11).concat(place(r[10])));
  } else {
    const delay = Math.max(3, flag('--delay') ? Number(args[args.indexOf('--delay') + 1]) || 5 : 5) * 1000;
    const full = limit === Infinity;
    const all = await listClasses();
    if (!all) return;
    const classes = all.slice(0, limit);
    // 接著上次的進度：同一個學年學期才接
    let progress = { year: String(year), term: String(term), done: {}, rows: [] };
    if (full && fs.existsSync(PROGRESS)) {
      const saved = JSON.parse(fs.readFileSync(PROGRESS, 'utf8'));
      if (saved.year === String(year) && saved.term === String(term)) progress = saved;
    }
    const todo = classes.filter(c => !(c.join('|') in progress.done));
    console.log(year + ' 學年第 ' + term + ' 學期，共 ' + classes.length + ' 個班級，還要抓 ' + todo.length + ' 個，每次間隔 ' + delay / 1000 + ' 秒');
    for (let i = 0; i < todo.length; i++) {
      try {
        const got = await fetchClass(todo[i], year, term);
        progress.rows.push(...got);
        progress.done[todo[i].join('|')] = got.length;
        if (full) fs.writeFileSync(PROGRESS, JSON.stringify(progress));
      } catch (err) {
        if (err.wall) {
          console.error('\n' + err.message + '，先停下來，不再送請求。已經抓到的存在 tools/課表進度.json。');
          console.error('過一段時間（至少 30 分鐘）再執行同一個指令，會從「' + clean(todo[i][2].slice(6)) + '」接著抓。');
          process.exitCode = 2;
          return; // 不寫 CSV：資料還不完整
        }
        console.error('抓不到 ' + todo[i][2] + '：' + err.message);
      }
      if ((i + 1) % 20 === 0) console.log((i + 1) + '/' + todo.length + '，累計 ' + progress.rows.length + ' 列');
      if (i + 1 < todo.length) await sleep(delay);
    }
    rows = progress.rows;
    if (!full) console.log(rows.slice(0, 10).map(r => r.join(' | ')).join('\n'));
  }

  // 有實際選課人數的檔案就併進來
  const enrollFile = path.join(__dirname, '選課人數_' + year + '_' + term + '.csv');
  const hasEnroll = fs.existsSync(enrollFile);
  if (hasEnroll) {
    const m = mergeEnroll(rows, parseCsv(fs.readFileSync(enrollFile, 'utf8')).slice(1));
    rows = m.rows;
    console.log('併入實際選課人數：對到 ' + m.matched + ' 列，對不到 ' + m.missing + ' 列');
  } else {
    console.log('⚠️ 沒有 ' + path.basename(enrollFile) + '，人數先用「人數上限」，會高估。見 tools/抓選課人數.console.js');
  }

  const h = heat(rows);
  if (limit === Infinity) {
    fs.writeFileSync(OUT, csv([HEAD].concat(rows)));
    fs.writeFileSync(HEAT, csv(h.out));
    fs.writeFileSync(HEAT_GS, heatGs(h.out, { year, term, meetings: h.used, enroll: hasEnroll }));
  }
  console.log('課表 ' + rows.length + ' 列；外雙溪有人數的上課時段 ' + h.used + ' 個；熱度 ' + (h.out.length - 1) + ' 格');
}

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
module.exports = { heat, place, parseCsv, csv, isWall, mergeEnroll };
