/**
 * 多路線比較器（15）＋文湖線分流（16）
 *
 * 學生說「8 點在 D 棟上課」，比較 557 和其他公車，告訴他幾點出門、搭哪一條。
 * 路線清單是 2026-10-09 用 TDX StopOfRoute 查的：
 * 從捷運士林站(中正)出發，13 條公車跟 557 走同樣 6 站到錢穆故居站，557、300 再多一站進校園。
 * 車程是估計值，之後用「行車時間紀錄器」的真實資料校正。
 */
const QIAN = '東吳大學(錢穆故居)';
const CAMPUS = '東吳大學';

const ORIGINS = {
  士林站: {
    stop: '捷運士林站(中正)',
    routes: [
      ['557', 0, CAMPUS], ['300', 1, CAMPUS], ['通勤30', 1, CAMPUS],
      ['255', 1, QIAN], ['255區', 0, QIAN], ['304承德', 1, QIAN], ['304重慶', 1, QIAN],
      ['680', 1, QIAN], ['683', 0, QIAN], ['683預', 0, QIAN], ['957', 0, QIAN],
      ['北環幹線', 0, QIAN], ['紅30', 1, QIAN], ['小18', 0, QIAN], ['小19', 0, QIAN], ['市民小巴1', 0, QIAN],
    ],
    rideMin: { [QIAN]: 10, [CAMPUS]: 12 },
  },
  劍南路站: {
    stop: '捷運劍南路站',
    routes: [['268', 0, QIAN], ['681', 0, QIAN], ['683', 1, QIAN], ['683預', 1, QIAN], ['957', 1, QIAN], ['北環幹線', 1, QIAN]],
    rideMin: { [QIAN]: 8 },
  },
  大直站: {
    stop: '捷運大直站',
    routes: [['680', 0, QIAN]],
    rideMin: { [QIAN]: 12 },
  },
};

// 代號: [名稱, 別名, 從校內 557 站步行分鐘, 從錢穆故居站步行分鐘]（地圖估計，之後換成實測）
const BUILDINGS = {
  A: ['寵惠堂', '行政大樓', 1, 6], B: ['綜合大樓', '綜大', 2, 5], C: ['愛徒樓', '安素堂', 4, 3],
  D: ['第二教學研究大樓', '二教 松怡廳', 3, 4], E: ['汽機車停車場', '停車場', 2, 7], F: ['文化樓', '', 4, 8],
  G: ['戴蓀堂', '', 3, 7], H: ['哲生樓', '', 5, 8], I: ['光道廳', '', 5, 9], J: ['研討室', '', 5, 9],
  K: ['心理學系實驗室', '心理實驗室', 6, 9], L: ['心理學系', '', 5, 9], M: ['超庸館', '', 6, 10],
  N: ['圖書館', '', 6, 8], P: ['雷德樓', '教師研究一樓', 6, 10], Q: ['教師研究二樓', '', 7, 8],
  R: ['第一教學研究大樓', '一教', 8, 10], S: ['楓雅學苑', '', 9, 9], T: ['東荊學廬', '', 10, 10],
  U: ['東桂學廬', '', 9, 11], 1: ['榕華樓', '', 8, 11], 2: ['柚芳樓', '', 8, 10], 3: ['松勁樓', '', 9, 9],
  4: ['教職員宿舍', '', 10, 10], 5: ['文舍', '', 8, 7], 6: ['德舍', '', 9, 7],
};

const PERIODS = {
  1: '08:10', 2: '09:10', 3: '10:10', 4: '11:10', E: '12:10', 5: '13:10', 6: '14:10',
  7: '15:10', 8: '16:10', 9: '17:10', A: '18:25', B: '19:20', C: '20:20', D: '21:15',
};

const BUFFER_MIN = 5;      // 提早幾分鐘到教室
const PEAK_EXTRA_MIN = 10; // 尖峰 557 可能擠不上，要多等一兩班

// ===== 主流程 =====

function compareReply_(text) {
  const q = parseQuestion_(text);
  if (q.intent === '回家') return busReply_(1, ['東吳大學(錢穆故居)'], '557 東吳 → 士林');
  if (q.intent === '天氣') return rainReply_();
  if (q.intent === '其他' && !q.building && !q.arriveTime) return HELP;

  const origin = ORIGINS[q.origin] ? q.origin : '士林站';
  const building = BUILDINGS[q.building] ? q.building : '';
  const now = new Date();
  const classAt = q.arriveTime ? timeOn_(q.day === '明天' ? addMin_(now, 24 * 60) : now, q.arriveTime) : null;

  // 上課時間還很久（或是明天）→ 給出門建議；快到了 → 查即時到站
  const planAhead = classAt && (classAt - now) > 90 * 60 * 1000;
  const answer = planAhead
    ? planReply_(origin, building, classAt, q.day === '明天')
    : liveReply_(origin, building, classAt);

  logCompare_(text, origin, building, classAt, planAhead ? '出門建議' : '即時');
  return answer;
}

/** 即時模式：查出發站所有路線的到站時間，算出各條到教室的時間 */
function liveReply_(originName, building, classAt) {
  const o = ORIGINS[originName];
  const etas = etaAtStop_(o.stop);
  const now = new Date();

  const options = [];
  o.routes.forEach(([route, dir, dest]) => {
    const e = etas.find(x => x.RouteName.Zh_tw === route && x.Direction === dir);
    if (!e || e.EstimateTime == null) return;
    const waitMin = Math.max(0, Math.round(e.EstimateTime / 60));
    const walk = walkMin_(building, dest);
    const total = waitMin + o.rideMin[dest] + walk;
    options.push({ route, dest, waitMin, walk, arrive: addMin_(now, total) });
  });

  if (!options.length) {
    return '🚌 ' + o.stop + '\n現在沒有車往東吳的即時資料（可能是末班車已過或還沒發車）。\n\n（TDX 即時資料・' + nowText_() + '）';
  }
  options.sort((a, b) => a.arrive - b.arrive);

  const target = building ? building + ' 棟 ' + BUILDINGS[building][0] : '東吳大學';
  const lines = ['🧭 從' + o.stop + '到 ' + target, ''];
  options.slice(0, 4).forEach((opt, i) => {
    const late = classAt && opt.arrive > classAt ? ' ⚠️ 會遲到' : '';
    lines.push((i === 0 ? '⭐ ' : '・') + opt.route + '：' + (opt.waitMin <= 1 ? '即將進站' : opt.waitMin + ' 分鐘後到站')
      + '\n　→ ' + (opt.dest === CAMPUS ? '直接進校園' : '錢穆故居站下車') + (building ? '，走 ' + opt.walk + ' 分鐘' : '')
      + '\n　約 ' + fmt_(opt.arrive) + ' 到' + late);
  });

  const best = options[0];
  const bus557 = options.find(x => x.route === '557');
  if (originName === '士林站' && best.route !== '557') {
    lines.push('', '💡 ' + best.route + ' 跟 557 走一樣的路，到錢穆故居站下車就好，不用擠 557！');
  } else if (originName === '士林站' && bus557 && isPeak_(now)) {
    lines.push('', '💡 現在是尖峰，557 可能擠不上。其他車到錢穆故居站下車也一樣。');
  }
  if (classAt) lines.push('', '⏰ 上課時間 ' + fmt_(classAt));
  if (!building) lines.push('', '📝 跟我說「8 點在 D 棟上課」，可以算到教室的時間');
  lines.push('', '（TDX 即時資料・' + nowText_() + '・車程為估計值）');
  return lines.join('\n');
}

/** 出門建議模式：上課時間還很久，用預估車程往回推 */
function planReply_(originName, building, classAt, isTomorrow) {
  const o = ORIGINS[originName];
  const mustArrive = addMin_(classAt, -BUFFER_MIN);
  const lines = ['🗓 ' + (isTomorrow ? '明天' : '今天') + ' ' + fmt_(classAt) + ' 上課'
    + (building ? '（' + building + ' 棟 ' + BUILDINGS[building][0] + '）' : ''), ''];

  const extra = crowdExtra_(classAt);
  const peak = isPeak_(addMin_(classAt, -30));

  if (originName === '士林站') {
    const by557 = addMin_(mustArrive, -(o.rideMin[CAMPUS] + walkMin_(building, CAMPUS) + (peak ? PEAK_EXTRA_MIN : 0) + extra.min));
    const byOther = addMin_(mustArrive, -(o.rideMin[QIAN] + walkMin_(building, QIAN) + 5 + extra.min));
    lines.push('🚌 搭 557 進校園：' + fmt_(by557) + ' 前到士林站排隊' + (peak ? '\n　（尖峰可能要等一兩班，已多算 ' + PEAK_EXTRA_MIN + ' 分鐘）' : ''));
    lines.push('🚌 搭其他車到錢穆故居站：' + fmt_(byOther) + ' 前到士林站'
      + '\n　255、304、紅30、683、957、北環幹線… 哪班先來搭哪班' + (building ? '\n　下車後走 ' + walkMin_(building, QIAN) + ' 分鐘' : ''));
  } else {
    const by = addMin_(mustArrive, -(o.rideMin[QIAN] + walkMin_(building, QIAN) + 5 + extra.min));
    lines.push('🚇 ' + o.stop + '：' + fmt_(by) + ' 前到站'
      + '\n　可以搭 ' + o.routes.map(r => r[0]).join('、') + ' 到錢穆故居站' + (building ? '，走 ' + walkMin_(building, QIAN) + ' 分鐘' : ''));
  }

  if (extra.reasons.length) lines.push('', '⚠️ ' + extra.reasons.join('、') + '，已多算 ' + extra.min + ' 分鐘');
  if (originName === '士林站') lines.push('', '💡 住文湖線沿線？說「我從劍南路站出發」可以看其他路線');
  lines.push('', '（依預估車程推算，出門前再問我一次可以看即時到站）');
  return lines.join('\n');
}

// ===== 解析學生的問題 =====

function parseQuestion_(text) {
  return parseWithGemini_(text) || parseWithRules_(text);
}

function parseWithGemini_(text) {
  const key = PROPS.getProperty('GEMINI_API_KEY');
  if (!key) return null;
  const buildingList = Object.keys(BUILDINGS).map(k => k + '=' + BUILDINGS[k][0] + (BUILDINGS[k][1] ? '/' + BUILDINGS[k][1] : '')).join('、');
  const periodList = Object.keys(PERIODS).map(k => '第' + k + '節=' + PERIODS[k]).join('、');
  const body = {
    contents: [{ parts: [{ text: text }] }],
    systemInstruction: { parts: [{ text:
      '你是東吳大學外雙溪校區的通勤小幫手，把學生的訊息整理成 JSON。\n'
      + '大樓代號：' + buildingList + '\n節次：' + periodList + '。早八=08:10。\n'
      + '說「8點上課」就用 08:00。沒提到的欄位填空字串。出發地只能是：士林站、劍南路站、大直站，沒提到填空字串。' } ] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          intent: { type: 'STRING', enum: ['去學校', '回家', '天氣', '其他'] },
          arriveTime: { type: 'STRING', description: '要抵達的時間 HH:MM' },
          building: { type: 'STRING', description: '大樓代號' },
          day: { type: 'STRING', enum: ['今天', '明天', '未指定'] },
          origin: { type: 'STRING' },
        },
        required: ['intent', 'arriveTime', 'building', 'day', 'origin'],
      },
    },
  };
  try {
    const res = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() !== 200) return null;
    const q = JSON.parse(JSON.parse(res.getContentText()).candidates[0].content.parts[0].text);
    q.building = String(q.building || '').toUpperCase();
    return q;
  } catch (err) {
    console.error(err);
    return null;
  }
}

/** Gemini 不能用時的備案：用規則抓時間、大樓、出發地 */
function parseWithRules_(text) {
  const t = text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  let arriveTime = '';
  const period = t.match(/第\s*([1-9A-E])\s*節/i);
  const clock = t.match(/(\d{1,2})\s*[:：點]\s*(\d{1,2})?/);
  if (/早八/.test(t)) arriveTime = '08:10';
  else if (period) arriveTime = PERIODS[period[1].toUpperCase()];
  else if (clock) arriveTime = ('0' + clock[1]).slice(-2) + ':' + ('0' + (clock[2] || '0')).slice(-2);

  let building = '';
  const code = t.match(/([A-U1-6])\s*棟/i);
  if (code) building = code[1].toUpperCase();
  else {
    Object.keys(BUILDINGS).some(k => {
      const names = [BUILDINGS[k][0]].concat(BUILDINGS[k][1].split(' ').filter(Boolean));
      if (names.some(n => t.indexOf(n) >= 0)) { building = k; return true; }
      return false;
    });
  }

  let intent = '其他';
  if (/回家|回程|下課/.test(t)) intent = '回家';
  else if (/雨|天氣|傘/.test(t)) intent = '天氣';
  else if (arriveTime || building || /上課|學校|出門|東吳|怎麼去/.test(t)) intent = '去學校';

  return {
    intent: intent,
    arriveTime: arriveTime,
    building: building,
    day: /明天|明早/.test(t) ? '明天' : '未指定',
    origin: /劍南/.test(t) ? '劍南路站' : /大直/.test(t) ? '大直站' : '',
  };
}

// ===== 小工具 =====

/** 一次抓出發站所有路線的到站時間（快取 30 秒，避免 TDX 限流） */
function etaAtStop_(stopName) {
  const cache = CacheService.getScriptCache();
  const key = 'eta_' + Utilities.base64EncodeWebSafe(stopName);
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);
  const filter = "StopName/Zh_tw eq '" + stopName + "'";
  const etas = tdx_('EstimatedTimeOfArrival/City/Taipei?$format=JSON&$select=RouteName,Direction,EstimateTime,StopStatus&$filter=' + encodeURIComponent(filter));
  cache.put(key, JSON.stringify(etas), 30);
  return etas;
}

function walkMin_(building, dest) {
  if (!building) return 0;
  return BUILDINGS[building][dest === CAMPUS ? 2 : 3];
}

/** 下雨、考試週要多留時間 */
function crowdExtra_(when) {
  const reasons = [];
  let min = 0;
  try {
    const rain = rainPop_(when);
    if (rain >= 60) { reasons.push('降雨機率 ' + rain + '%'); min += 10; }
  } catch (err) { console.error(err); }
  const event = calendarEvent_(when);
  if (event && event[2] === '考試') { reasons.push(event[3]); min += 10; }
  return { min: min, reasons: reasons };
}

/** 讀「行事曆」分頁，找這一天的事件：[開始, 結束, 類型, 名稱, 影響] */
function calendarEvent_(when) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('行事曆');
  if (!sheet) return null;
  const day = Utilities.formatDate(when, TZ, 'yyyy-MM-dd');
  // 試算表可能把日期轉成 Date 或「2026/9/14」，統一成 yyyy-MM-dd 再比
  const toDay = v => v instanceof Date
    ? Utilities.formatDate(v, TZ, 'yyyy-MM-dd')
    : String(v).replace(/(\d{4})\D(\d{1,2})\D(\d{1,2})/, (m, y, mo, d) => y + '-' + ('0' + mo).slice(-2) + '-' + ('0' + d).slice(-2));
  const rows = sheet.getDataRange().getValues().slice(1);
  return rows.find(r => toDay(r[0]) <= day && day <= toDay(r[1]) && r[2] !== '活動') || null;
}

/** 某個時間點所在的 3 小時降雨機率 */
function rainPop_(when) {
  const url = 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/F-D0047-061'
    + '?Authorization=' + PROPS.getProperty('CWA_API_KEY')
    + '&LocationName=' + encodeURIComponent('士林區')
    + '&ElementName=' + encodeURIComponent('3小時降雨機率');
  const times = JSON.parse(UrlFetchApp.fetch(url).getContentText()).records.Locations[0].Location[0].WeatherElement[0].Time;
  const slot = times.find(t => new Date(t.StartTime) <= when && when < new Date(t.EndTime));
  return slot ? Number(slot.ElementValue[0].ProbabilityOfPrecipitation) : 0;
}

function isPeak_(when) {
  const day = Number(Utilities.formatDate(when, TZ, 'u')); // 1=週一 … 7=週日
  const hm = Utilities.formatDate(when, TZ, 'HH:mm');
  return day <= 5 && hm >= '07:20' && hm <= '09:10';
}

function timeOn_(date, hhmm) {
  return new Date(Utilities.formatDate(date, TZ, 'yyyy-MM-dd') + 'T' + hhmm + ':00+08:00');
}

function addMin_(date, min) {
  return new Date(date.getTime() + min * 60 * 1000);
}

function fmt_(date) {
  return Utilities.formatDate(date, TZ, 'HH:mm');
}

/** 每次比較都記一筆，之後可以統計大家從哪裡出發、幾點上課（測試數據） */
function logCompare_(text, origin, building, classAt, mode) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('比較器紀錄');
  if (!sheet) {
    sheet = ss.insertSheet('比較器紀錄');
    sheet.appendRow(['時間', '學生問的', '出發站', '大樓', '上課時間', '模式']);
    sheet.setFrozenRows(1);
  }
  sheet.appendRow([new Date(), text, origin, building, classAt ? fmt_(classAt) : '', mode]);
}

function 測試比較器() {
  ['8點在D棟上課', '明天早八 H棟 我要幾點出門', '我從劍南路站出發，第三節在一教', '我現在要去學校'].forEach(t => {
    console.log('【' + t + '】\n' + compareReply_(t) + '\n');
  });
}
