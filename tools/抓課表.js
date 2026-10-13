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
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = 'https://web.sys.scu.edu.tw';
const OUT = path.join(__dirname, '..', 'bot', '課表.csv');
const HEAT = path.join(__dirname, '..', 'bot', '課表熱度.csv');
const HEAT_GS = path.join(__dirname, '..', 'bot', '課表熱度資料.gs');
const PROGRESS = path.join(__dirname, '課表進度.json');
const HEAD = ['部別', '開課班級', '選課編號', '科目代碼', '科目名稱', '組別', '人數', '星期', '節次', '週別', '教室', '校區', '大樓'];
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
  const table = {};
  let used = 0;
  rows.forEach(r => {
    const [, , selno, code, , , count, day, section, week, room, campus] = r;
    const n = Number(count);
    if (campus !== '外雙溪' || !n || !DAYS.includes(day)) return;
    const key = [selno || code, day, section, room].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    const first = String(section)[0].toUpperCase();
    if (!PERIODS[first]) return;
    table[day + first] = (table[day + first] || 0) + n * (week ? 0.5 : 1);
    used += 1;
  });
  const out = [['星期', '節次', '上課時間', '這一節開始上課的人數']];
  DAYS.forEach(d => Object.keys(PERIODS).sort((a, b) => PERIODS[a].localeCompare(PERIODS[b])).forEach(p => {
    if (table[d + p]) out.push([d, p, PERIODS[p], Math.round(table[d + p])]);
  }));
  return { out, used };
}

/** Bot 用的資料檔（bot/課表熱度資料.gs）：熱度只有幾十格，直接寫成程式裡的常數，不用另外匯入試算表 */
function heatGs(table, meta) {
  const data = {};
  table.slice(1).forEach(([day, period, , count]) => { (data[day] = data[day] || {})[period] = Number(count); });
  const today = new Date().toISOString().slice(0, 10);
  return [
    '/**',
    ' * 課表熱度的資料（8）。這個檔案是 tools/抓課表.js 產生的，不要手動改；換學期時重跑那支程式。',
    ' * 每一格是外雙溪校區「星期 × 節次」這一節開始上課的人數，來源是公開的全校課表（人數欄）。',
    ' */',
    'const HEAT_SOURCE = ' + JSON.stringify({ year: Number(meta.year), term: Number(meta.term), updated: today, meetings: meta.meetings }) + ';',
    'const HEAT_DATA = ' + JSON.stringify(data, null, 2) + ';',
    '',
  ].join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const flag = name => args.includes(name);
  const numbers = args.filter(a => /^\d+$/.test(a));
  const limit = flag('--limit') ? Number(args[args.indexOf('--limit') + 1]) : Infinity;
  let rows;

  if (flag('--heat')) {
    rows = parseCsv(fs.readFileSync(OUT, 'utf8')).slice(1);
  } else {
    const year = numbers[0] || 115, term = numbers[1] || 1;
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
    if (full) fs.writeFileSync(OUT, csv([HEAD].concat(rows)));
    else console.log(rows.slice(0, 10).map(r => r.join(' | ')).join('\n'));
  }

  const h = heat(rows);
  if (limit === Infinity) {
    fs.writeFileSync(HEAT, csv(h.out));
    fs.writeFileSync(HEAT_GS, heatGs(h.out, { year: numbers[0] || 115, term: numbers[1] || 1, meetings: h.used }));
  }
  console.log('課表 ' + rows.length + ' 列；外雙溪有人數的上課時段 ' + h.used + ' 個；熱度 ' + (h.out.length - 1) + ' 格');
}

if (require.main === module) main().catch(err => { console.error(err); process.exit(1); });
module.exports = { heat, place, parseCsv, csv, isWall };
