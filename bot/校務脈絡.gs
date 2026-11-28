/**
 * 出門脈絡結構化查詢（計畫書 POST /v1/campus/class-context 的函式版）。
 *
 * 只在這個倉庫裡被 menuFlow_、compareQuery_ 呼叫，不開對外 HTTP、不用向量資料庫、不查課表。
 * 只讀「行事曆」分頁、PERIODS、BUILDINGS／walkMin_。不讀任何金鑰，不呼叫 Gemini。
 * 不接收、不記錄定位或 LINE 使用者識別碼。
 *
 * query 可含：text（問句，可選）、day（今天／明天）、date（台北日期）、
 *   arriveTime（HH:MM）或 period（節次）、building（學生已提供的大樓代號）。
 * 大樓不在 BUILDINGS、或學生沒說，大樓與教室留空，不編造。
 */
function classContext_(query) {
  const q = query && typeof query === 'object' ? query : {};
  const text = typeof q.text === 'string' ? q.text : '';
  const parsed = text ? parseWithRules_(text) : null;
  const date = resolveContextDate_(q, parsed);
  const time = resolveContextTime_(q, parsed);
  const building = resolveContextBuilding_(q, parsed);
  const cal = contextCalendar_(date);
  const eventType = cal ? cal.type : '';
  const holiday = eventType === '放假';
  const exam = eventType === '考試';
  const walkMin = building ? walkMin_(building, CAMPUS) : null;
  const eventName = (holiday || exam) && cal ? cal.name : '';
  const sources = [];
  if ((holiday || exam) && cal) {
    sources.push({
      table: '行事曆',
      file: '行事曆.csv',
      type: eventType,
      name: eventName,
      date: date,
      start: cal.start,
      end: cal.end,
    });
  }
  if (building) {
    sources.push({
      table: '校園大樓表',
      file: '校園大樓.csv',
      name: BUILDINGS[building][0],
      walkMin: walkMin,
      note: '估計',
    });
  }
  if (time) sources.push({ table: '節次', file: '節次.csv', time: time });

  return {
    found: Boolean(date),
    message: date ? (holiday ? '這天不用上學' : '') : '找不到上課日期或節次',
    date: date || '',
    time: time || '',
    building: building,
    buildingName: building ? BUILDINGS[building][0] : '',
    classroom: '',
    holiday: holiday,
    exam: exam,
    walkMin: walkMin,
    eventName: eventName,
    eventType: holiday || exam ? eventType : '',
    sources: sources,
  };
}

/** 類型「放假」的那天：不出門建議，附行事曆名稱與日期。活動（含名稱裡的停課）不會進到這裡。 */
function holidayReply_(ctx) {
  const name = ctx && ctx.eventName ? ctx.eventName : '放假';
  const date = ctx && ctx.date ? ctx.date : '';
  return '這天不用上學\n' + name + '（' + date + '）\n行事曆：' + name;
}

/** planReply_ 卡片 footer。考試週附行事曆名稱；有大樓才附步行，並標明是估計不是實測。 */
function contextFooter_(classAt, building) {
  const base = '557 依監測資料預測（平常日），跟「預估到達時間」同一套算法；出門前按「比較所有路線」可以看即時到站';
  if (!classAt) return base;
  const ctx = classContext_({
    date: Utilities.formatDate(classAt, TZ, 'yyyy-MM-dd'),
    arriveTime: Utilities.formatDate(classAt, TZ, 'HH:mm'),
    building: building || '',
  });
  const lines = contextSourceLines_(ctx);
  return lines.length ? base + '・' + lines.join('・') : base;
}

function contextSourceLines_(ctx) {
  const lines = [];
  if (ctx && ctx.exam && ctx.eventName) lines.push('行事曆：' + ctx.eventName);
  if (ctx && ctx.building) lines.push('步行：校園大樓表（估計）');
  return lines;
}

function resolveContextDate_(q, parsed) {
  const explicit = contextCanonicalDate_(q.date);
  if (explicit) return explicit;
  let dayWord = '';
  if (q.day === '今天' || q.day === '明天') dayWord = q.day;
  else if (parsed && parsed.day === '明天') dayWord = '明天';
  else if (parsed && parsed.day === '今天') dayWord = '今天';
  else if (q.arriveTime || q.period || (parsed && parsed.arriveTime)) dayWord = '今天';
  if (!dayWord) return '';
  const now = new Date();
  const base = dayWord === '明天' ? addMin_(now, 24 * 60) : now;
  return Utilities.formatDate(base, TZ, 'yyyy-MM-dd');
}

function resolveContextTime_(q, parsed) {
  const given = contextHHMM_(q.arriveTime);
  if (given) return given;
  const period = String(q.period == null ? '' : q.period).trim().toUpperCase();
  if (PERIODS[period]) return PERIODS[period];
  return parsed && parsed.arriveTime ? (contextHHMM_(parsed.arriveTime) || '') : '';
}

function resolveContextBuilding_(q, parsed) {
  if (q.building != null && String(q.building).trim() !== '') {
    const code = String(q.building).trim().toUpperCase();
    return BUILDINGS[code] ? code : '';
  }
  const code = parsed && parsed.building ? String(parsed.building).toUpperCase() : '';
  return BUILDINGS[code] ? code : '';
}

/** 只認類型「放假」「考試」。calendarEvent_ 會跳過「活動」，名稱含停課也不另判。 */
function contextCalendar_(date) {
  if (!date) return null;
  const event = calendarEvent_(new Date(date + 'T12:00:00+08:00'));
  if (!event) return null;
  return {
    start: contextCanonicalDate_(event[0]) || String(event[0] == null ? '' : event[0]),
    end: contextCanonicalDate_(event[1]) || String(event[1] == null ? '' : event[1]),
    type: String(event[2] || ''),
    name: String(event[3] || ''),
  };
}

function contextCanonicalDate_(value) {
  if (value instanceof Date) return Utilities.formatDate(value, TZ, 'yyyy-MM-dd');
  const m = String(value == null ? '' : value).trim().match(/^(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!m) return '';
  const iso = m[1] + '-' + ('0' + Number(m[2])).slice(-2) + '-' + ('0' + Number(m[3])).slice(-2);
  const check = new Date(iso + 'T12:00:00+08:00');
  if (isNaN(check.getTime())) return '';
  return Utilities.formatDate(check, TZ, 'yyyy-MM-dd') === iso ? iso : '';
}

function contextHHMM_(value) {
  const m = String(value == null ? '' : value).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return '';
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return '';
  return ('0' + hour).slice(-2) + ':' + ('0' + minute).slice(-2);
}
