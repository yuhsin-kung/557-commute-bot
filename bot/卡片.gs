/**
 * 卡片式回覆（LINE 的 Flex Message）和配色
 *
 * 配色（11/28 改）：照團隊的設計稿，白底、灰色面板、標題區白底深色字；重點色是磚紅（跟圖文選單、簡報一樣）。
 * 磚紅只當重點色用，不拿來表示警告；要提醒的事情用琥珀色的字。
 *
 * 其他檔案用 card_({ … }) 做一張卡片：
 *   badge     標題上面的小字（這張卡片是什麼）
 *   title     標題
 *   subtitle  標題下面的小字
 *   rows      一列一列的資料：{ label, value, sub, best }。best 是最推薦的那一列
 *   notes     提示（淺色底的一段話）
 *   warns     要注意的事（琥珀色字）
 *   footer    最下面的小字（資料來源、時間）
 *   buttons   按鈕：{ label, text } 按了替使用者傳出 text；{ label, uri } 按了打開網頁
 *   menu      false 就不放最下面的「回選單」
 *
 * 按鈕一律做在訊息裡，不用輸入框上面那排「快速回覆」：那排按鈕傳了新訊息就消失，也不好看。
 * 做在訊息裡的按鈕會留在聊天室，往回滑還能按。
 *   card_({ … buttons })      資料卡片，下面帶幾顆按鈕
 *   choices_(問題, 按鈕)       問一個問題、給幾顆按鈕讓人選（共乘、測驗、出門時間都用這個）
 *
 * 每張卡片都帶一份純文字版（altText）：通知預覽、訊息紀錄、LINE 不接受卡片時的備用回覆都用它。
 */
const UI = {
  // 11/28 改成團隊設計稿的樣子：白底、灰色面板；重點色用磚紅（跟圖文選單、簡報一樣）
  brand: '#A63A2B',      // 磚紅：主要按鈕、最推薦的那一列、重點數字
  brandDark: '#7A2A1F',  // 深磚紅：次要按鈕的字
  onBrand: '#FFFFFF',    // 磚紅底上的字
  onBrandSoft: '#F7DCD5', // 淺磚紅：小標籤的底色
  brandBg: '#FBF1EE',    // 更淡的磚紅：獎勵、推薦面板、可借車輛的底色
  head: '#FFFFFF',       // 標題區：白底
  headInk: '#111827',    // 標題字
  headSoft: '#6B7280',   // 標題上面的小字、副標
  paper: '#FFFFFF',      // 卡片底色
  soft: '#EEF2F7',       // 提示、次要按鈕的底色（灰色面板）
  line: '#E5E7EB',       // 分隔線
  ink: '#111827',        // 內文
  muted: '#6B7280',      // 次要文字
  warn: '#B45309',       // 要注意的事（琥珀色）
  warnBg: '#FEF3E2',     // 琥珀色提醒面板、末班車已過這種狀態標籤的底色
  good: '#15803D',       // 降雨機率低（綠）
  mid: '#C2410C',        // 降雨機率中等（橘）
};

function card_(spec) {
  return { type: 'flex', altText: cardText_(spec).slice(0, 400), contents: cardBubble_(spec) };
}

function cardBubble_(spec) {
  const body = [];
  (spec.rows || []).forEach((row, i) => {
    if (i > 0) body.push({ type: 'separator', color: UI.line });
    body.push(cardRow_(row));
  });
  (spec.notes || []).filter(Boolean).forEach(note => body.push(cardNote_(note, UI.ink)));
  (spec.warns || []).filter(Boolean).forEach(warn => body.push(cardNote_(warn, UI.warn)));
  if (spec.footer) body.push({ type: 'text', text: spec.footer, size: 'xs', color: UI.muted, wrap: true });
  if (!body.length) body.push({ type: 'text', text: spec.title, size: 'sm', color: UI.ink, wrap: true }); // Flex 不接受空的內文

  const header = [];
  if (spec.badge) header.push({ type: 'text', text: spec.badge, size: 'xs', color: UI.headSoft });
  header.push({ type: 'text', text: spec.title, size: 'lg', weight: 'bold', color: UI.headInk, wrap: true });
  if (spec.subtitle) header.push({ type: 'text', text: spec.subtitle, size: 'sm', color: UI.headSoft, wrap: true });

  const bubble = {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', backgroundColor: UI.head, paddingAll: '20px', paddingBottom: '4px', spacing: 'xs', contents: header },
    body: { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '16px', spacing: 'md', contents: body },
  };
  const buttons = (spec.buttons || []).map(cardButton_);
  if (buttons.length) {
    bubble.footer = { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '12px', paddingTop: '0px', spacing: 'sm', contents: buttons };
  }
  if (spec.menu !== false) {
    if (!bubble.footer) bubble.footer = { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '12px', paddingTop: '0px', spacing: 'sm', contents: [] };
    bubble.footer.contents.push(menuLink_());
  }
  // 最後一行小字（資料來源）上面隔 8px，下面也只留 8px，看起來置中（下面接按鈕區）
  if (bubble.footer) bubble.body.paddingBottom = '8px';
  return bubble;
}

/** 每張卡片最下面的小字「回選單」：沒有輸入框上面那排按鈕之後，靠它回到全部功能 */
/**
 * 純文字也做成卡片（11/28 團隊要求：所有回覆都用卡片，不送單純的文字訊息）。
 * 第一行很短、後面空一行，就拿來當標題列（choices_ 的規則），不然標題用 Bot 的名字；最下面有「回選單」
 */
function textCard_(text) {
  return choices_(String(text), [], { primary: false });
}

function menuLink_() {
  return { type: 'text', text: '回選單 ›', size: 'xs', color: UI.muted, align: 'end', action: { type: 'message', label: '回選單', text: '選單' } };
}

/**
 * 問一個問題、給幾顆按鈕讓人選。按鈕在訊息裡，會留在聊天室。
 *   text     問題或說明（可以好幾行）
 *   items    [按鈕上的字, 按了傳出的字]，或 { label, uri }（打開網頁）、{ label, picker }（選日期時間）
 *   options  { title: 加一條標題列, badge: 標題上面的小字, primary: false 就沒有主要按鈕, menu: false 就不放「回選單」 }
 * 4 顆以內直排、第一顆是主要按鈕；超過 4 顆排成兩欄。
 */
function choices_(text, items, options) {
  const o = Object.assign({}, options || {});
  // 每張卡片上面都有紅色標題列：沒給標題時，把第一行（後面空一行的那種）拿來當標題，不然用 Bot 的名字
  if (!o.title) {
    const lines = String(text || '').split('\n');
    if (lines.length > 2 && lines[1] === '' && lines[0].length <= 24) {
      o.title = lines[0];
      text = lines.slice(2).join('\n');
    } else {
      o.title = '東吳通勤達人';
      o.quietTitle = true; // 通知預覽不要以 Bot 名字開頭
    }
  }
  const chips = items.map((item, i) => choiceChip_(item, i === 0 && o.primary !== false && items.length <= 4));
  const body = [];
  if (text) body.push({ type: 'text', text: String(text), size: 'md', color: UI.ink, wrap: true });
  if (chips.length <= 6) { // 6 顆以內排一欄：按鈕整行寬，長的名稱不會斷行、高度一致
    chips.forEach(chip => body.push(chip));
  } else {
    for (let i = 0; i < chips.length; i += 2) {
      // 單數顆的最後一顆自己一列、整列寬，不會只佔半邊看起來歪一邊
      body.push(chips[i + 1] ? { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [chips[i], chips[i + 1]] } : chips[i]);
    }
  }
  if (o.menu !== false) body.push(menuLink_());

  const bubble = { type: 'bubble', body: { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '16px', spacing: chips.length <= 6 ? 'md' : 'sm', contents: body } };
  if (o.title) {
    const header = [];
    if (o.badge) header.push({ type: 'text', text: o.badge, size: 'xs', color: UI.headSoft });
    header.push({ type: 'text', text: o.title, size: 'lg', weight: 'bold', color: UI.headInk, wrap: true });
    bubble.header = { type: 'box', layout: 'vertical', backgroundColor: UI.head, paddingAll: '20px', paddingBottom: '4px', spacing: 'xs', contents: header };
  }
  const labels = items.map(item => '［' + (Array.isArray(item) ? item[0] : item.label) + '］').join('');
  return { type: 'flex', altText: ((o.title && !o.quietTitle ? o.title + '\n' : '') + (text || '') + '\n' + labels).trim().slice(0, 400), contents: bubble };
}

function choiceChip_(item, primary) {
  const label = Array.isArray(item) ? item[0] : item.label;
  let action;
  if (Array.isArray(item)) action = { type: 'message', label: label.slice(0, 20), text: item[1] };
  else if (item.uri) action = { type: 'uri', label: label.slice(0, 20), uri: item.uri };
  else action = Object.assign({ type: 'datetimepicker', label: label.slice(0, 20) }, item.picker);
  return {
    type: 'box', layout: 'vertical', flex: 1, backgroundColor: primary ? UI.brand : UI.soft, cornerRadius: '10px', paddingAll: '15px', action: action,
    contents: [{ type: 'text', text: label, size: 'sm', weight: 'bold', color: primary ? UI.onBrand : UI.ink, align: 'center', wrap: true }],
  };
}

function cardRow_(row) {
  const top = {
    type: 'box', layout: 'horizontal', spacing: 'md',
    contents: [{ type: 'text', text: String(row.label), size: 'md', weight: 'bold', color: row.best ? UI.brand : UI.ink, flex: 0, wrap: true }],
  };
  if (row.value) top.contents.push({ type: 'text', text: String(row.value), size: 'md', weight: row.best ? 'bold' : 'regular', color: UI.ink, align: 'end', wrap: true });
  const box = { type: 'box', layout: 'vertical', spacing: 'xs', contents: [top] };
  if (row.sub) box.contents.push({ type: 'text', text: String(row.sub), size: 'xs', color: UI.muted, wrap: true });
  return box;
}

function cardNote_(text, color) {
  return {
    type: 'box', layout: 'vertical', backgroundColor: UI.soft, cornerRadius: '8px', paddingAll: '10px',
    contents: [{ type: 'text', text: String(text), size: 'sm', color: color, wrap: true }],
  };
}

function cardButton_(button, index) {
  const action = button.uri
    ? { type: 'uri', label: button.label.slice(0, 20), uri: button.uri }
    : { type: 'message', label: button.label.slice(0, 20), text: button.text };
  return index === 0
    ? { type: 'button', style: 'primary', color: UI.brand, height: 'sm', action: action }
    : { type: 'button', style: 'link', color: UI.brandDark, height: 'sm', action: action };
}

/** 卡片的純文字版 */
function cardText_(spec) {
  const lines = [spec.title + (spec.subtitle ? '（' + spec.subtitle + '）' : '')];
  (spec.rows || []).forEach(row => {
    lines.push((row.best ? '★ ' : '・') + row.label + (row.value ? '：' + row.value : '') + (row.sub ? '\n　' + row.sub : ''));
  });
  (spec.notes || []).concat(spec.warns || []).filter(Boolean).forEach(note => lines.push('', note));
  if (spec.footer) lines.push('', '（' + spec.footer + '）');
  return lines.join('\n');
}

/** 把回覆（文字、訊息物件，或它們的陣列）變成純文字：訊息紀錄和備用回覆用 */
function plain_(answer) {
  return (Array.isArray(answer) ? answer : [answer])
    .map(m => (typeof m === 'string' ? m : m.text || m.altText || ''))
    .filter(Boolean)
    .join('\n');
}

// ===== 設計稿版型（11/28 團隊設計稿：計程車共乘、YouBike、共享雨傘、學生包車） =====

/**
 * 跟 到校預估.gs 的 designCard_ 同一個樣子（白底、粗體標題、灰色面板、磚紅重點），但內容用一塊一塊排：
 *   kicker   最上面的小字（例：557 以外的選擇）
 *   title    粗體標題；badge 是標題右邊的小標籤（例：規劃中、目前有車可借）
 *   lead     標題下面的說明；route 是更小的一行（例：捷運士林站 → 東吳大學）
 *   blocks   照順序排的內容，每一塊是下面其中一種：
 *     { sec, note, badge }               分段標題（上面有分隔線）
 *     { text, muted }                    一段話
 *     { table: { head, rows } }          兩欄的表格
 *     { cols: [[上, 下], …], note }       並排的小格子（例：1人 $160）
 *     { stats: [[標籤, 數值], …] }         並排的統計框（例：單程距離 約 3.5 公里）
 *     { avail: { name, bikes, docks } }  YouBike 站：可借車輛、可還空位兩格
 *     { place: { name, badge, note } }   地點（例：雨傘租借站）
 *     { steps: [[01, 標題, 說明], …] }     01／02／03 步驟
 *     { info: [[標籤, 數值, 小標籤], …] }   一列一列的資訊
 *     { panel: { title, lines, tone } }  面板；tone 'brand' 是淡磚紅底，不給是灰色
 *     { small }                          最小的灰字（資料來源、更新時間）
 *   buttons  [按鈕上的字, 按了傳出的字] 或 { label, uri }；前 primaryCount 顆（預設 1）是磚紅主要按鈕
 *   alt      純文字版（不給就用卡片上的字）
 */
function dsCard_(spec) {
  const body = [];
  if (spec.kicker) body.push(dsTx_(spec.kicker, 'xs', UI.muted));
  const head = [dsTx_(spec.title, 'lg', UI.ink, { weight: 'bold', flex: 1 })];
  if (spec.badge) head.push(dsBadge_(spec.badge));
  body.push({ type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm', margin: spec.kicker ? 'sm' : 'none', contents: head });
  if (spec.lead) body.push(dsTx_(spec.lead, 'sm', UI.ink, { margin: 'md' }));
  if (spec.route) body.push(dsTx_(spec.route, 'xs', UI.muted, { margin: 'sm' }));
  (spec.blocks || []).forEach(b => body.push.apply(body, dsBlock_(b)));

  const items = spec.buttons || [];
  const primaryCount = spec.primaryCount === undefined ? 1 : spec.primaryCount;
  const footer = items.map((item, i) => dsChip_(item, i < primaryCount));
  (spec.after || []).forEach(b => footer.push.apply(footer, dsBlock_(b))); // 按鈕下面的說明（例：位置隱私說明）
  if (spec.menu !== false) footer.push(menuLink_());
  const bubble = { type: 'bubble', body: { type: 'box', layout: 'vertical', paddingAll: '20px', backgroundColor: UI.paper, contents: body } };
  // 有按鈕時內文底下不再多留 20px：最後一行小字跟上面、跟按鈕的距離一樣（都是 12px），看起來置中
  if (footer.length) bubble.body.paddingBottom = '0px';
  if (footer.length) bubble.footer = { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '20px', paddingTop: '12px', backgroundColor: UI.paper, contents: footer }; // 11/28：按鈕之間拉開，不擠

  const labels = items.map(item => '［' + (Array.isArray(item) ? item[0] : item.label) + '］').join('');
  const words = [];
  dsWalkText_(bubble.body, words);
  (spec.after || []).forEach(b => dsBlock_(b).forEach(n => dsWalkText_(n, words)));
  const alt = spec.alt || words.join('\n');
  return { type: 'flex', altText: (alt + (labels ? '\n' + labels : '')).slice(0, 400), contents: bubble };
}

/**
 * 設計稿的按鈕：[字, 傳出的字]、{ label, text }、{ label, uri }、{ label, picker }。
 * primary 是磚紅底白字；style 'outline' 是白底、磚紅字、灰框；selected 也是磚紅底（選過的日期）
 */
function dsChip_(item, primary) {
  const label = Array.isArray(item) ? item[0] : item.label;
  let action;
  if (Array.isArray(item)) action = { type: 'message', label: label.slice(0, 20), text: item[1] };
  else if (item.uri) action = { type: 'uri', label: label.slice(0, 20), uri: item.uri };
  else if (item.picker) action = Object.assign({ type: 'datetimepicker', label: label.slice(0, 20) }, item.picker);
  else action = { type: 'message', label: label.slice(0, 20), text: item.text };
  const solid = (primary && !(item && item.style === 'outline')) || (item && item.selected);
  const outline = item && item.style === 'outline';
  const box = {
    type: 'box', layout: 'vertical', flex: 1, cornerRadius: '10px', paddingAll: '15px', action: action,
    backgroundColor: solid ? UI.brand : outline ? UI.paper : UI.soft,
    contents: [dsTx_(label, 'sm', solid ? UI.onBrand : outline ? UI.brand : UI.ink, { weight: 'bold', align: 'center' })],
  };
  if (outline) { box.borderWidth = '1px'; box.borderColor = UI.line; }
  return box;
}

function dsTx_(text, size, color, extra) {
  // 多行的字行距拉開一點，不擠（11/28 團隊回饋）
  return Object.assign({ type: 'text', text: String(text), size: size, color: color || UI.ink, wrap: true, lineSpacing: /^(xl|xxl|3xl)$/.test(size) ? undefined : '5px' }, extra || {});
}

function dsBadge_(text) {
  return { type: 'box', layout: 'vertical', flex: 0, backgroundColor: UI.onBrandSoft, cornerRadius: '12px', paddingAll: '4px', paddingStart: '8px', paddingEnd: '8px',
    contents: [dsTx_(text, 'xxs', UI.brandDark, { wrap: false })] };
}

/** 灰色（或淡磚紅）圓角小框 */
function dsBox_(contents, extra) {
  return Object.assign({ type: 'box', layout: 'vertical', backgroundColor: UI.soft, cornerRadius: '12px', paddingAll: '14px', contents: contents }, extra || {});
}

/** 一塊內容 → 卡片元件（可能好幾個） */
function dsBlock_(b) {
  if (b.sec) {
    const head = [dsTx_(b.sec, 'md', UI.ink, { weight: 'bold', flex: 1 })];
    if (b.badge) head.push(dsBadge_(b.badge));
    const out = [{ type: 'separator', margin: 'lg', color: UI.line }, { type: 'box', layout: 'horizontal', margin: 'lg', alignItems: 'center', contents: head }];
    if (b.note) out.push(dsTx_(b.note, 'xs', UI.muted, { margin: 'xs' }));
    return out;
  }
  if (b.hr) return [{ type: 'separator', margin: 'lg', color: UI.line }];
  if (b.numbered) {
    // 一則一個灰色面板：左上小編號標籤＋粗體標題，下面灰字說明（例：新生須知三件事）
    return b.numbered.map(n => dsBox_([
      { type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm', contents: [dsBadge_(n[0]), dsTx_(n[1], 'md', UI.ink, { weight: 'bold', flex: 1 })] },
      dsTx_(n[2], 'xs', UI.muted, { margin: 'sm' }),
    ], { margin: 'md', paddingAll: '14px' }));
  }
  if (b.points) {
    // 磚紅大字獎勵＋旁邊灰字條件（例：+1 點 完成兩次定位打卡即可獲得）
    return [{ type: 'box', layout: 'baseline', margin: 'md', spacing: 'sm', contents: [
      dsTx_(b.points[0], 'xl', UI.brand, { weight: 'bold', flex: 0, wrap: false }),
      dsTx_(b.points[1], 'xs', UI.muted, { flex: 1 }),
    ] }];
  }
  if (b.flow) {
    // 打卡步驟：編號標籤、粗體標題、灰字說明、可選的小標籤（第一次打卡＝淡磚紅、第二次打卡＝淡綠），步驟之間有分隔線
    const out = [];
    b.flow.forEach((s, i) => {
      if (i) out.push({ type: 'separator', margin: 'lg', color: UI.line });
      const inner = [dsTx_(s[1], 'sm', UI.ink, { weight: 'bold' }), dsTx_(s[2], 'xs', UI.muted, { margin: 'xs' })];
      if (s[3]) {
        const green = s[4] === 'green';
        inner.push({ type: 'box', layout: 'horizontal', margin: 'sm', contents: [{ type: 'box', layout: 'vertical', flex: 0, cornerRadius: '12px', paddingAll: '4px', paddingStart: '8px', paddingEnd: '8px',
          backgroundColor: green ? '#DCFCE7' : UI.onBrandSoft, contents: [dsTx_(s[3], 'xxs', green ? UI.good : UI.brandDark, { wrap: false })] }, { type: 'filler' }] });
      }
      out.push({ type: 'box', layout: 'horizontal', margin: 'lg', spacing: 'md', contents: [
        { type: 'box', layout: 'vertical', flex: 0, contents: [dsBadge_(s[0])] },
        { type: 'box', layout: 'vertical', flex: 1, contents: inner },
      ] });
    });
    return out;
  }
  // 磚紅小標（例：557 上車地點的「捷運士林站」）
  if (b.label) return [dsTx_(b.label, 'sm', UI.brand, { weight: 'bold', margin: 'xl' })];
  if (b.report) {
    // 回報成功：站名、回報時間，分隔線，磚紅大字人數，說明
    const r = b.report;
    return [dsBox_([
      dsTx_(r.stop, 'md', UI.ink, { weight: 'bold' }),
      dsTx_(r.time, 'xs', UI.muted, { margin: 'sm' }),
      { type: 'separator', margin: 'lg', color: UI.line },
      dsTx_(r.count, 'xxl', UI.brand, { weight: 'bold', margin: 'lg' }),
      dsTx_(r.note, 'xs', UI.muted, { margin: 'sm' }),
    ], { margin: 'md', paddingAll: '16px' })];
  }
  if (b.h) return [dsTx_(b.h, 'md', UI.ink, { weight: 'bold', margin: b.first ? 'md' : 'lg' })];
  if (b.text) return [dsTx_(b.text, 'sm', b.muted ? UI.muted : UI.ink, { margin: b.tight ? 'sm' : 'lg' })]; // 上下留一樣的空間（12px）；tight 是緊接在標題下面的說明
  if (b.chips) {
    // 卡片裡的按鈕（例：選哪一天、第幾節），預設排兩欄；selected 的那顆是磚紅
    const cols = b.cols || 2;
    const chips = b.chips.map(item => dsChip_(item, false));
    const rows = [];
    for (let i = 0; i < chips.length; i += cols) {
      const row = chips.slice(i, i + cols);
      while (row.length < cols) row.push({ type: 'filler' });
      rows.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: row });
    }
    return [{ type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: rows }];
  }
  if (b.group) {
    // 灰色面板裡一列一列（中間有分隔線）：[標題, 右邊的值, 下面的小字]
    const inner = [];
    b.group.forEach((r, i) => {
      if (i) inner.push({ type: 'separator', margin: 'md', color: UI.line });
      const top = [dsTx_(r[0], 'sm', UI.ink, { weight: 'bold', flex: 1 })];
      if (r[1]) top.push(dsTx_(r[1], 'sm', UI.ink, { weight: 'bold', align: 'end', flex: 0, wrap: false }));
      inner.push({ type: 'box', layout: 'horizontal', margin: i ? 'md' : 'none', contents: top });
      if (r[2]) inner.push(dsTx_(r[2], 'xs', UI.muted, { margin: 'xs' }));
    });
    return [dsBox_(inner, { margin: 'md', paddingAll: '14px' })];
  }
  if (b.hero) {
    // 推薦的那一個：灰色面板，名稱磚紅大字、右上小標籤、大的時間
    const h = b.hero;
    const top = [dsTx_(h.name, 'xl', UI.brand, { weight: 'bold', flex: 1 })];
    if (h.badge) top.push(dsBadge_(h.badge));
    const inner = [{ type: 'box', layout: 'horizontal', alignItems: 'center', contents: top }];
    if (h.big) inner.push(dsTx_(h.big, 'xl', UI.ink, { weight: 'bold', margin: 'sm' }));
    if (h.note) inner.push(dsTx_(h.note, 'xs', UI.muted, { margin: 'xs' }));
    if (h.sub) inner.push(dsTx_(h.sub, 'xs', UI.ink, { margin: 'md' }));
    return [dsBox_(inner, { margin: 'md', paddingAll: '14px' })];
  }
  if (b.list) {
    // 簡潔列表：[名稱, 名稱下的小字, 右邊的值, 值下的小字]，中間有分隔線
    const out = [];
    b.list.forEach((r, i) => {
      if (i) out.push({ type: 'separator', margin: 'md', color: UI.line });
      out.push({ type: 'box', layout: 'horizontal', margin: 'md', contents: [
        { type: 'box', layout: 'vertical', flex: 1, contents: [dsTx_(r[0], 'sm', UI.ink)].concat(r[1] ? [dsTx_(r[1], 'xxs', UI.muted, { margin: 'xs' })] : []) },
        { type: 'box', layout: 'vertical', flex: 0, contents: [dsTx_(r[2], 'sm', UI.ink, { weight: 'bold', align: 'end', wrap: false })].concat(r[3] ? [dsTx_(r[3], 'xxs', UI.muted, { align: 'end', margin: 'xs' })] : []) },
      ] });
    });
    return out;
  }
  if (b.stat) {
    // 灰色面板：小標、磚紅大字、說明（例：提醒時間 每晚 9:00、預計抵達 557 站牌 21:54）
    const s = b.stat;
    const inner = [dsTx_(s.label, 'sm', s.boldLabel ? UI.ink : UI.muted, s.boldLabel ? { weight: 'bold' } : {}), dsTx_(s.value, 'xxl', UI.brand, { weight: 'bold', margin: 'sm' })];
    if (s.note) inner.push(dsTx_(s.note, 'xs', UI.muted, { margin: 'sm' }));
    return [dsBox_(inner, { margin: 'md', paddingAll: '14px' })];
  }
  if (b.metric) {
    // 左邊標籤、右邊有顏色的大數字（例：降雨機率 10%）
    return [{ type: 'box', layout: 'horizontal', margin: 'lg', alignItems: 'center', contents: [
      dsTx_(b.metric[0], 'md', UI.ink, { weight: 'bold', flex: 1 }),
      dsTx_(b.metric[1], 'xxl', b.metric[2] || UI.brand, { weight: 'bold', flex: 0, align: 'end' }),
    ] }];
  }
  if (b.status) {
    // 站名＋右邊的狀態：[站名, 狀態文字, true＝狀態標籤（末班車已過這種，琥珀色）]
    const out = [];
    b.status.forEach((r, i) => {
      if (i) out.push({ type: 'separator', margin: 'md', color: UI.line });
      const right = r[2]
        ? { type: 'box', layout: 'vertical', flex: 0, backgroundColor: UI.warnBg, cornerRadius: '12px', paddingAll: '4px', paddingStart: '8px', paddingEnd: '8px', contents: [dsTx_(r[1], 'xxs', UI.warn, { wrap: false })] }
        : dsTx_(r[1], 'sm', UI.ink, { weight: 'bold', align: 'end', flex: 0 });
      out.push({ type: 'box', layout: 'horizontal', margin: 'md', alignItems: 'center', spacing: 'md', contents: [dsTx_(r[0], 'sm', UI.ink, { weight: 'bold', flex: 1 }), right] });
    });
    return out;
  }
  if (b.small) return [dsTx_(b.small, 'xxs', UI.muted, { margin: 'lg' })];
  if (b.table) {
    const row = (cells, bold) => ({ type: 'box', layout: 'horizontal', paddingAll: '10px', contents: [
      dsTx_(cells[0], 'sm', bold ? UI.muted : UI.ink, { flex: 1 }),
      dsTx_(cells[1], 'sm', bold ? UI.muted : UI.ink, { flex: 1, align: 'end', weight: bold ? 'regular' : 'bold' }),
    ] });
    const rows = [row(b.table.head, true)];
    b.table.rows.forEach(r => { rows.push({ type: 'separator', color: UI.line }); rows.push(row(r, false)); });
    return [dsBox_(rows, { margin: 'md', paddingAll: '4px' })];
  }
  if (b.cols) {
    const out = [{ type: 'box', layout: 'horizontal', margin: 'md', spacing: 'sm', contents: b.cols.map(c => dsBox_([
      dsTx_(c[0], 'xs', UI.muted, { align: 'center' }),
      dsTx_(c[1], 'md', UI.ink, { align: 'center', weight: 'bold', margin: 'xs' }),
    ], { flex: 1, paddingAll: '8px' })) }];
    if (b.note) out.push(dsTx_(b.note, 'xs', UI.muted, { margin: 'sm' }));
    return out;
  }
  if (b.stats) {
    return [{ type: 'box', layout: 'horizontal', margin: 'md', spacing: 'sm', contents: b.stats.map(s => dsBox_([
      dsTx_(s[0], 'xs', UI.muted),
      dsTx_(s[1], 'md', UI.ink, { weight: 'bold', margin: 'xs' }),
    ], { flex: 1 })) }];
  }
  if (b.avail) {
    const a = b.avail;
    const cell = (label, n, bg, ink) => dsBox_([
      dsTx_(label, 'xs', ink),
      dsTx_(n === null || n === undefined ? '—' : String(n), 'xl', ink, { weight: 'bold', margin: 'xs' }),
    ], { flex: 1, backgroundColor: bg, paddingAll: '10px' });
    return [
      dsTx_(a.name, 'sm', UI.ink, { weight: 'bold', margin: 'md' }),
      { type: 'box', layout: 'horizontal', margin: 'sm', spacing: 'sm', contents: [
        cell('可借車輛', a.bikes, UI.brandBg, UI.brandDark), // 可借：淡磚紅
        cell('可還空位', a.docks, UI.soft, UI.ink),            // 可還：灰藍
      ] },
    ];
  }
  if (b.place) {
    const p = b.place;
    const head = [dsTx_(p.name, 'md', UI.ink, { weight: 'bold', flex: 1 })];
    if (p.badge) head.push(dsBadge_(p.badge));
    const inner = [{ type: 'box', layout: 'horizontal', alignItems: 'center', spacing: 'sm', contents: head }];
    if (p.note) inner.push(dsTx_(p.note, 'xs', UI.muted, { margin: 'xs' }));
    return [dsBox_(inner, { margin: 'md' })];
  }
  if (b.steps) {
    return b.steps.map(s => ({ type: 'box', layout: 'horizontal', margin: 'md', spacing: 'md', contents: [
      dsTx_(s[0], 'lg', UI.brand, { weight: 'bold', flex: 0, wrap: false }),
      { type: 'box', layout: 'vertical', flex: 1, contents: [
        dsTx_(s[1], 'sm', UI.ink, { weight: 'bold' }),
        dsTx_(s[2], 'xs', UI.muted, { margin: 'xs' }),
      ] },
    ] }));
  }
  if (b.info) {
    const inner = [];
    b.info.forEach((r, i) => {
      if (i) inner.push({ type: 'separator', margin: 'lg', color: UI.line });
      inner.push(dsTx_(r[0], 'xs', UI.muted, { margin: i ? 'lg' : 'none' }));
      inner.push(dsTx_(r[1], 'md', UI.ink, { weight: 'bold', margin: 'sm' }));
      if (r[2]) inner.push({ type: 'box', layout: 'horizontal', margin: 'sm', contents: [dsBadge_(r[2]), { type: 'filler' }] });
    });
    return [dsBox_(inner, { margin: 'md', paddingAll: '16px' })];
  }
  if (b.panel) {
    const p = b.panel;
    const brand = p.tone === 'brand', warn = p.tone === 'warn';
    const inner = [];
    if (p.title) inner.push(dsTx_(p.title, 'sm', brand ? UI.brandDark : warn ? UI.warn : UI.ink, { weight: 'bold' }));
    const lineColor = brand ? UI.brandDark : (p.quiet || warn) ? UI.muted : UI.ink; // quiet：說明用灰字
    (p.lines || []).forEach((t, i) => inner.push(dsTx_(t, p.quiet || warn ? 'xs' : 'sm', lineColor, { margin: i || p.title ? 'sm' : 'none' })));
    return [dsBox_(inner, { margin: p.margin || 'lg', backgroundColor: brand ? UI.brandBg : warn ? UI.warnBg : UI.soft, paddingAll: '14px' })];
  }
  return [];
}

/** 卡片上所有的字（純文字版用） */
function dsWalkText_(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'text') { out.push(node.text); return; }
  if (Array.isArray(node.contents)) node.contents.forEach(c => dsWalkText_(c, out));
}
