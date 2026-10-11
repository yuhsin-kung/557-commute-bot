// 假的 Apps Script 環境：讓 bot/*.gs 可以在 Node 裡跑，不連網路、不碰真的試算表。
// 試算表是記憶體裡的二維陣列，LINE／TDX 的呼叫都被攔下來記在 env.fetches。
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const BOT_DIR = path.join(__dirname, '..', 'bot');

function makeSheet() {
  const rows = [];
  return {
    rows,
    appendRow: r => { rows.push(r.slice()); },
    setFrozenRows() {},
    getLastRow: () => rows.length,
    getDataRange: () => ({ getValues: () => rows.map(r => r.slice()), getDisplayValues: () => rows.map(r => r.map(String)) }),
    getRange: (row, col, numRows = 1, numCols = 1) => ({
      getValue: () => rows[row - 1][col - 1],
      getValues: () => rows.slice(row - 1, row - 1 + numRows).map(r => r.slice(col - 1, col - 1 + numCols)),
      setValues: values => values.forEach((r, i) => r.forEach((v, j) => { rows[row - 1 + i][col - 1 + j] = v; })),
    }),
  };
}

// 假的 Google 表單：把題目記在 env.forms[n].items，測試可以檢查出了哪些題
function fakeForm(env, title) {
  const record = { title, items: [], settings: {} };
  env.forms.push(record);
  const add = type => {
    const it = { type, required: false };
    record.items.push(it);
    const api = {
      item: it,
      setTitle: t => { it.title = t; return api; },
      setHelpText: t => { it.help = t; return api; },
      setChoiceValues: c => { it.choices = c.slice(); return api; },
      setRequired: r => { it.required = r; return api; },
      showOtherOption: b => { it.other = b; return api; },
      setBounds: (low, high) => { it.bounds = [low, high]; return api; },
      setLabels: (low, high) => { it.labels = [low, high]; return api; },
      setValidation: () => api,
      createChoice: (value, page) => ({ value, goTo: page ? page.item.title : undefined }),
      setChoices: cs => { it.choices = cs.map(c => c.value); it.goTo = cs.map(c => c.goTo); return api; },
    };
    return api;
  };
  const set = key => value => { record.settings[key] = value; };
  return {
    setDescription: set('description'), setConfirmationMessage: set('confirmation'), setCollectEmail: set('collectEmail'), setProgressBar: set('progressBar'),
    setDestination: (type, id) => { record.settings.destination = id; },
    addTextItem: () => add('text'), addParagraphTextItem: () => add('paragraph'), addMultipleChoiceItem: () => add('one'), addCheckboxItem: () => add('many'),
    addScaleItem: () => add('scale'), addSectionHeaderItem: () => add('header'), addPageBreakItem: () => add('page'),
    getPublishedUrl: () => 'https://forms.example/' + env.forms.length,
    getEditUrl: () => 'https://forms.example/edit/' + env.forms.length,
  };
}

// Utilities.formatDate 用的是 Java 的格式，這裡只做 Bot 用到的那幾種
function formatDate(date, timeZone, pattern) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(date).map(p => [p.type, p.value]));
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.weekday];
  const value = {
    yyyy: parts.year, MM: parts.month, dd: parts.day, HH: parts.hour, mm: parts.minute,
    M: String(+parts.month), d: String(+parts.day), H: String(+parts.hour), u: String(weekday), E: parts.weekday,
  };
  return pattern.replace(/'([^']*)'|yyyy|MM|dd|HH|mm|M|d|H|u|E/g, (token, literal) => (literal !== undefined ? literal : value[token]));
}

/**
 * 載入 bot/ 裡的檔案，回傳可以操作的環境。
 * env.run('程式碼')：在 Bot 的環境裡執行
 * env.setNow('2026-10-12T07:30:00+08:00')：把共乘的時鐘調到這個時間
 * env.fetches：所有被攔下來的網路呼叫
 * env.quotaLeft：假裝 LINE 本月還剩幾則推播
 * env.onFetch = (url, options) => ({ code, body })：假裝某個網址的回應
 */
function loadBot(files, props = {}) {
  const sheets = {};
  const store = Object.assign({ LINE_CHANNEL_ACCESS_TOKEN: 'test-token' }, props);
  const cache = {};
  const env = { sheets, fetches: [], quotaLeft: 200, triggers: [], names: {}, forms: [], props: store };

  const fetch = (url, options = {}) => {
    env.fetches.push({ url, options, body: options.payload && typeof options.payload === 'string' ? JSON.parse(options.payload) : options.payload });
    // env.onFetch 可以假裝某個網址回什麼：回傳 { code, body }，不處理就回傳 undefined
    const custom = env.onFetch && env.onFetch(url, options);
    if (custom) return { getResponseCode: () => custom.code || 200, getContentText: () => (typeof custom.body === 'string' ? custom.body : JSON.stringify(custom.body || {})) };
    let body = {};
    if (url.includes('/v2/bot/profile/')) body = { displayName: env.names[url.split('/').pop()] || '同學' + url.slice(-1) };
    else if (url.endsWith('/message/quota')) body = { type: 'limited', value: 200 };
    else if (url.endsWith('/message/quota/consumption')) body = { totalUsage: 200 - env.quotaLeft };
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify(body) };
  };

  const html = content => ({ content, title: '', setTitle(t) { this.title = t; return this; }, addMetaTag() { return this; }, getContent() { return this.content; } });

  const context = {
    console: { log() {}, error() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getId: () => 'TEST-SHEET', getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = makeSheet()) }) },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
      getProjectTriggers: () => env.triggers,
      deleteTrigger: t => { env.triggers.splice(env.triggers.indexOf(t), 1); },
      newTrigger: fn => {
        const b = { timeBased: () => b, everyMinutes: () => b, everyHours: () => b, everyDays: () => b, atHour: () => b, inTimezone: () => b,
          create: () => { env.triggers.push({ getHandlerFunction: () => fn }); } };
        return b;
      },
    },
    UrlFetchApp: { fetch },
    Utilities: {
      formatDate,
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: s => Buffer.from(s).toString('base64url'),
      DigestAlgorithm: { MD5: 'md5' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (algorithm, text) => [...crypto.createHash(algorithm).update(text, 'utf8').digest()].map(b => (b > 127 ? b - 256 : b)),
    },
    HtmlService: { createHtmlOutput: html },
    FormApp: {
      DestinationType: { SPREADSHEET: 'SPREADSHEET' },
      createTextValidation: () => { const v = { setHelpText: () => v, requireNumberGreaterThanOrEqualTo: () => v, build: () => v }; return v; },
      create: title => fakeForm(env, title),
    },
    ContentService: { createTextOutput: text => ({ text }) },
  };
  vm.createContext(context);
  for (const file of files) vm.runInContext(fs.readFileSync(path.join(BOT_DIR, file), 'utf8'), context, { filename: file });

  env.context = context;
  env.run = code => vm.runInContext(code, context);
  env.call = (fn, ...args) => { context.__args = args; return vm.runInContext(fn + '(...__args)', context); };
  env.setNow = iso => { context.__now = new Date(iso).getTime(); vm.runInContext('cpNow_ = () => new Date(__now)', context); };
  env.addMinutes = min => { context.__now += min * 60000; };
  env.pushes = () => env.fetches.filter(f => f.url.endsWith('/message/multicast'));
  return env;
}

module.exports = { loadBot, formatDate };
