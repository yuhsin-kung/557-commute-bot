/**
 * 卡片式回覆（LINE 的 Flex Message）和配色
 *
 * 配色是「磚紅米白」：標題列磚紅底白字，內文米白底深色字。
 * 紅色只當品牌色用，不拿來表示警告；要提醒的事情用琥珀色的字。
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
  brand: '#A63A2B',      // 磚紅：標題列、主要按鈕、最推薦的那一列
  brandDark: '#7A2A1F',  // 深磚紅：次要按鈕的字
  onBrand: '#FFFFFF',
  onBrandSoft: '#F7DCD5',
  paper: '#FBF7F0',      // 米白：卡片底色
  soft: '#F3E9DC',       // 提示的底色
  line: '#E6D9C8',       // 分隔線
  ink: '#1B1D22',        // 內文
  muted: '#6B6257',      // 次要文字
  warn: '#8A5A00',       // 要注意的事
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
  if (spec.badge) header.push({ type: 'text', text: spec.badge, size: 'xs', color: UI.onBrandSoft });
  header.push({ type: 'text', text: spec.title, size: 'lg', weight: 'bold', color: UI.onBrand, wrap: true });
  if (spec.subtitle) header.push({ type: 'text', text: spec.subtitle, size: 'sm', color: UI.onBrandSoft, wrap: true });

  const bubble = {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', backgroundColor: UI.brand, paddingAll: '16px', spacing: 'xs', contents: header },
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
  return bubble;
}

/** 每張卡片最下面的小字「回選單」：沒有輸入框上面那排按鈕之後，靠它回到全部功能 */
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
    if (o.badge) header.push({ type: 'text', text: o.badge, size: 'xs', color: UI.onBrandSoft });
    header.push({ type: 'text', text: o.title, size: 'lg', weight: 'bold', color: UI.onBrand, wrap: true });
    bubble.header = { type: 'box', layout: 'vertical', backgroundColor: UI.brand, paddingAll: '16px', spacing: 'xs', contents: header };
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
    type: 'box', layout: 'vertical', flex: 1, backgroundColor: primary ? UI.brand : UI.soft, cornerRadius: '8px', paddingAll: '12px', action: action,
    contents: [{ type: 'text', text: label, size: 'sm', weight: 'bold', color: primary ? UI.onBrand : UI.brandDark, align: 'center', wrap: true }],
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
