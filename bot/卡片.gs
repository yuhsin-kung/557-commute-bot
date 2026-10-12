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
 *   size      卡片寬度，預設 mega；cards_ 的一排卡片預設用小一點的 kilo
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

/** 一排可以左右滑的卡片（最多 12 張）。altText 是通知預覽和訊息紀錄看到的字 */
function cards_(specs, altText) {
  return {
    type: 'flex',
    altText: String(altText).slice(0, 400),
    contents: { type: 'carousel', contents: specs.map(spec => cardBubble_(Object.assign({ size: 'kilo' }, spec))) },
  };
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
    size: spec.size || 'mega', // 一排卡片用小一點的 kilo，一次看得到下一張的邊
    header: { type: 'box', layout: 'vertical', backgroundColor: UI.brand, paddingAll: '16px', spacing: 'xs', contents: header },
    body: { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '16px', spacing: 'md', contents: body },
  };
  const buttons = (spec.buttons || []).map(cardButton_);
  if (buttons.length) {
    bubble.footer = { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '12px', paddingTop: '0px', spacing: 'sm', contents: buttons };
  }
  return bubble;
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
