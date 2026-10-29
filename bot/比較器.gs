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
  K: ['心理學系實驗室', '心理實驗室', 6, 9], L: ['心理學系', '心理系', 5, 9], M: ['超庸館', '', 6, 10],
  N: ['圖書館', '', 6, 8], P: ['雷德樓', '教師研究一樓', 6, 10], Q: ['教師研究二樓', '', 7, 8],
  R: ['第一教學研究大樓', '一教', 8, 10], S: ['楓雅學苑', '', 9, 9], T: ['東荊學廬', '', 10, 10],
  U: ['東桂學廬', '', 9, 11], 1: ['榕華樓', '', 8, 11], 2: ['柚芳樓', '', 8, 10], 3: ['松勁樓', '', 9, 9],
  4: ['教職員宿舍', '', 10, 10], 5: ['文舍', '', 8, 7], 6: ['德舍', '', 9, 7],
};

const PERIODS = {
  1: '08:10', 2: '09:10', 3: '10:10', 4: '11:10', E: '12:10', 5: '13:10', 6: '14:10',
  7: '15:10', 8: '16:10', 9: '17:10', A: '18:25', B: '19:20', C: '20:20', D: '21:15',
};

// 學校的劍南路站師生專車：上課日 07:50 從捷運劍南路站發車，到 A 棟前（德育中心 115-1 時刻表，不適用 T-PASS）
const JIANNAN_SHUTTLE = '07:50';

const BUFFER_MIN = 5;      // 提早幾分鐘到教室
const PEAK_EXTRA_MIN = 10; // 尖峰 557 可能擠不上，要多等一兩班
const WEATHER_EXAM_EXTRA_MIN = 20; // 隔天降雨機率 60% 以上或考試週，出門時間再多留

// ===== 主流程 =====

function compareReply_(text) {
  const q = parseQuestion_(text);
  if (q.intent === '回家') return busReply_(1, ['東吳大學(錢穆故居)'], '557 東吳 → 士林');
  if (q.intent === '天氣') return rainReply_();
  if (q.intent === '站牌') return stationReply_(); // 站位變更.gs
  if (q.intent === '其他' && !q.building && !q.arriveTime) return menuUnknown_(); // 選單.gs：看不懂就給按鈕
  return compareQuery_(q, text);
}

/** q 是整理好的問題：{ arriveTime, building, day, origin }。打字問的和用按鈕點的（選單.gs）都走這裡 */
function compareQuery_(q, text) {
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
  const target = building ? building + ' 棟' : '東吳大學';
  const head = { badge: '多路線比較', title: originName + ' → ' + target, subtitle: building ? BUILDINGS[building][0] : '' };

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
    return card_(Object.assign(head, { // 卡片.gs
      notes: ['現在 ' + o.stop + ' 沒有車往東吳的即時資料，可能是末班車已過或還沒發車。'],
      footer: 'TDX 即時資料・' + nowText_(),
      buttons: [{ label: '找人共乘計程車', text: '共乘' }, { label: '排明天的出門時間', text: '出門時間 明天' }],
    }));
  }
  options.sort((a, b) => a.arrive - b.arrive);

  const rows = options.slice(0, 4).map((opt, i) => ({
    label: opt.route,
    value: (opt.waitMin <= 1 ? '即將進站' : opt.waitMin + ' 分鐘後') + '・' + fmt_(opt.arrive) + ' 到',
    sub: (opt.dest === CAMPUS ? '直接進校園' : '錢穆故居站下車') + (building ? '，走 ' + opt.walk + ' 分鐘' : '')
      + (classAt && opt.arrive > classAt ? '（會遲到）' : ''),
    best: i === 0,
  }));
  if (originName === '士林站') otherWays_(now, building, classAt).forEach(r => rows.push(r));

  const notes = [];
  const warns = [];
  const best = options[0];
  const bus557 = options.find(x => x.route === '557');
  if (best.dest === CAMPUS) {
    notes.push('目前只要搭乘 ' + best.route + '，便能最快速地抵達學校。');
  } else {
    notes.push('目前只要搭乘 ' + best.route + '，便能最快速地抵達錢穆故居站，再步行進校。');
  }
  if (originName === '士林站' && bus557 && best.route === '557' && isPeak_(now)) {
    warns.push('現在是尖峰，557 可能擠不上。其他車到錢穆故居站下車也一樣。');
  }
  if (classAt && best.arrive > classAt) warns.push(fmt_(classAt) + ' 上課，最快的車也會遲到。可以考慮共乘。');


  return card_(Object.assign(head, {
    rows: rows,
    notes: notes,
    warns: warns,
    footer: (classAt ? fmt_(classAt) + ' 上課・' : '') + 'TDX 即時資料・' + nowText_() + '・車程為估計值',
    buttons: [{ label: '找人共乘計程車', text: '共乘' }, { label: 'YouBike 車數', text: 'YouBike' }],
  }));
}

// 公車以外的方法（「比較所有路線」）：車程是地圖估計值，之後用實測校正
const YB_RIDE_MIN = 18;   // 士林站騎 YouBike 到校內，3.5 公里有一段上坡（含借車、還車）
const TAXI_RIDE_MIN = 10; // 士林站搭計程車到校門口

/** 士林站出發的 YouBike、計程車共乘，接在公車的下面 */
function otherWays_(now, building, classAt) {
  const late = at => (classAt && at > classAt ? '（會遲到）' : '');
  const rows = [];
  const near = ybStations_().filter(s => s.toMrt <= YB_NEAR_MRT_M); // YouBike.gs
  if (near.length) {
    const bikes = near.reduce((sum, s) => sum + s.bikes, 0);
    const at = addMin_(now, YB_RIDE_MIN + walkMin_(building, CAMPUS));
    rows.push({ label: '🚲 YouBike', value: '約 ' + fmt_(at) + ' 到',
      sub: (bikes ? '士林站附近可借 ' + bikes + ' 台' : '士林站附近現在沒有車可借') + '，騎約 ' + YB_RIDE_MIN + ' 分鐘' + late(at) });
  }
  const taxi = addMin_(now, CP.LIVE_WAIT_MIN + TAXI_RIDE_MIN + walkMin_(building, CAMPUS)); // 共乘.gs
  rows.push({ label: '🚕 計程車共乘', value: '約 ' + fmt_(taxi) + ' 到',
    sub: '最多等 ' + CP.LIVE_WAIT_MIN + ' 分鐘湊人，4 人每人約 ' + cpShare_(4) + ' 元' + late(taxi) });
  return rows;
}

/** 出門建議模式：上課時間還很久，用預估車程往回推 */
function planReply_(originName, building, classAt, isTomorrow) {
  const o = ORIGINS[originName];
  const mustArrive = addMin_(classAt, -BUFFER_MIN);
  const extra = crowdExtra_(classAt);
  const peak = isPeak_(addMin_(classAt, -30));
  const rows = [];
  let remind = null; // 557 發車提醒（發車提醒.gs）：建議到士林站的時間

  if (originName === '士林站') {
    const by557 = addMin_(mustArrive, -(o.rideMin[CAMPUS] + walkMin_(building, CAMPUS) + (peak ? PEAK_EXTRA_MIN : 0) + extra.min));
    const byOther = addMin_(mustArrive, -(o.rideMin[QIAN] + walkMin_(building, QIAN) + 5 + extra.min));
    remind = fmt_(by557);
    rows.push({ label: '搭 557 進校園', value: fmt_(by557) + ' 前到士林站',
      sub: peak ? '尖峰可能要等一兩班，已多算 ' + PEAK_EXTRA_MIN + ' 分鐘' : '' });
    rows.push({ label: '搭其他車', value: fmt_(byOther) + ' 前到士林站',
      sub: '255、304、紅30、683、957、北環幹線… 哪班先來搭哪班，到錢穆故居站下車' + (building ? '，走 ' + walkMin_(building, QIAN) + ' 分鐘' : '') });
  } else {
    const by = addMin_(mustArrive, -(o.rideMin[QIAN] + walkMin_(building, QIAN) + 5 + extra.min));
    rows.push({ label: o.stop, value: fmt_(by) + ' 前到站',
      sub: '搭 ' + o.routes.map(r => r[0]).join('、') + ' 到錢穆故居站' + (building ? '，走 ' + walkMin_(building, QIAN) + ' 分鐘' : '') });
    // 學校專車進校園到 A 棟前，用「從校內站走過去」的時間估
    const shuttle = timeOn_(classAt, JIANNAN_SHUTTLE);
    const shuttleArrive = addMin_(shuttle, o.rideMin[QIAN] + 2 + walkMin_(building, CAMPUS));
    const weekday = Number(Utilities.formatDate(classAt, TZ, 'u')) <= 5;
    if (originName === '劍南路站' && weekday && shuttleArrive <= mustArrive) {
      rows.push({ label: '學校專車', value: JIANNAN_SHUTTLE + ' 發車',
        sub: '約 ' + fmt_(shuttleArrive) + ' 到教室。在【捷運劍南路站】站牌（往自強隧道方向）上車，不適用 T-PASS' });
    }
  }
  rows[0].best = true;

  return card_({ // 卡片.gs
    badge: '出門建議',
    title: (isTomorrow ? '明天 ' : '今天 ') + fmt_(classAt) + ' 上課',
    subtitle: building ? building + ' 棟 ' + BUILDINGS[building][0] : '',
    rows: rows,
    warns: extra.reasons.length ? [extra.reasons.join('、') + '，已多算 ' + extra.min + ' 分鐘。'] : [],
    footer: '依預估車程推算，出門前按「比較所有路線」可以看即時到站',
    // 這張是事先規劃：最常做的是換時間；即時到站看下面那行小字說的「比較所有路線」
    buttons: [
      { label: '換一個時間', text: '出門時間' },
      { label: '改從其他捷運站出發', text: ['出門時間', isTomorrow ? '明天' : '今天', fmt_(classAt), building || '不指定', '選出發站'].join(' ') },
      { label: '預約計程車共乘', text: originName === '士林站' ? '共乘 去學校 預約' : '共乘' },
    ].concat(remind ? [{ label: '557 發車前提醒我', text: '出門提醒 ' + (isTomorrow ? '明天' : '今天') + ' ' + remind }] : []),
  });
}

// ===== 解析學生的問題 =====

/**
 * Gemini 免費版每分鐘只能叫幾次（gemini-3.5-flash 是 5 次），尖峰很容易用完，
 * 所以規則看得懂的句子（有時間或大樓、回家、天氣、站牌）就不叫 Gemini，看不懂的才交給它。
 */
function parseQuestion_(text) {
  const byRules = parseWithRules_(text);
  if (byRules.arriveTime || byRules.building || byRules.intent !== '其他') return byRules;
  return parseWithGemini_(text) || byRules;
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
      + '說「8點上課」就用 08:00。沒提到的欄位填空字串。出發地只能是：士林站、劍南路站、大直站，沒提到填空字串。\n'
      + '問公車在哪裡上車、站牌在哪、要去哪裡排隊，intent 填「站牌」。' } ] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          intent: { type: 'STRING', enum: ['去學校', '回家', '天氣', '站牌', '其他'] },
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
    const call = model => UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(body),
      muteHttpExceptions: true,
    });
    // 先用 lite（免費額度比較多），超過額度（429）或塞車（503）再換 flash
    let res = call('gemini-3.5-flash-lite');
    if (res.getResponseCode() !== 200) res = call('gemini-3.5-flash');
    if (res.getResponseCode() !== 200) {
      console.error('Gemini ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 200));
      return null;
    }
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
  const CN = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const t = text
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    // 「八點半」「十點」「十一點」→ 8點半、10點、11點
    .replace(/(十?[一二兩三四五六七八九]|十)(?=\s*點)/g, m => String(m === '十' ? 10 : m[0] === '十' ? 10 + CN[m[1]] : CN[m]));
  let arriveTime = '';
  const period = t.match(/第\s*([1-9A-E一二三四五六七八九])\s*節/i);
  const clock = t.match(/(\d{1,2})\s*[:：點]\s*(\d{1,2}|半)?/);
  if (/早八/.test(t)) arriveTime = '08:10';
  else if (period) arriveTime = PERIODS[CN[period[1]] || period[1].toUpperCase()];
  else if (clock) {
    let hour = Number(clock[1]);
    if (hour < 7) hour += 12; // 最早的課 8:10，「兩點」「6點」一定是下午
    const minute = clock[2] === '半' ? 30 : Number(clock[2] || 0);
    arriveTime = ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2);
  }

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
  else if (/站牌|上車|排隊|出口|去哪|哪(裡|邊|兒)/.test(t) && !arriveTime && !building) intent = '站牌';
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
    if (rain >= 60) reasons.push('降雨機率 ' + rain + '%');
  } catch (err) { console.error(err); }
  const event = calendarEvent_(when);
  if (event && event[2] === '考試') reasons.push(event[3]);
  if (reasons.length) min = WEATHER_EXAM_EXTRA_MIN; // 下雨、考試週其中一個成立就多留，兩個都成立也是一樣
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

/** 學校公告的尖峰入校時段（德育中心 115-1 時刻表）：07:20–08:20、09:00–10:00，尖峰班距 4–6 分 */
function isPeak_(when) {
  const day = Number(Utilities.formatDate(when, TZ, 'u')); // 1=週一 … 7=週日
  const hm = Utilities.formatDate(when, TZ, 'HH:mm');
  return day <= 5 && ((hm >= '07:20' && hm <= '08:20') || (hm >= '09:00' && hm <= '10:00'));
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
  if (tooSoon_('測試比較器', 60)) return; // Code.gs：公開網頁也呼叫得到，一分鐘只跑一次
  ['8點在D棟上課', '明天早八 H棟 我要幾點出門', '我從劍南路站出發，第三節在一教', '我現在要去學校'].forEach(t => {
    console.log('【' + t + '】\n' + plain_(compareReply_(t)) + '\n');
  });
}
