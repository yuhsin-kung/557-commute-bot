/**
 * 共享雨傘（20）：規劃與 Raingo 合作，在錢穆故居站和校門口設雨傘租借站，一站借、另一站還
 *
 * 借還都在 Raingo 的租借站和 App 完成，Bot 不經手，也不知道誰借了傘、借了幾把，
 * 所以這裡只告訴同學租借站在哪裡、怎麼借；借傘不給積分，每日報表也不算借傘。
 * 租借站設好後，把 Raingo 的借用說明網址放進指令碼屬性 RAINGO_URL，卡片就會多一顆「看借用方式」。
 * 用到卡片.gs 的 card_。
 */
const UM_SPOTS = ['錢穆故居站', '校門口'];

/** 文字訊息開頭是「借傘」「還傘」「共享雨傘」時由 Code.gs 轉過來 */
function umText_() {
  const guide = PROPS.getProperty('RAINGO_URL');
  return card_({
    badge: '557 以外的選擇',
    title: '☂️ 共享雨傘（規劃中）',
    rows: UM_SPOTS.map(spot => ({ label: spot, value: 'Raingo 租借站' })),
    notes: [
      '規劃與 Raingo 合作，在錢穆故居站和校門口設置雨傘租借站：一站借、另一站還，借還都用手機在 Raingo 完成。',
      guide ? '' : '租借站設好後，這裡會放借用方式的說明。',
    ],
    buttons: guide ? [{ label: '看借用方式', uri: guide }] : [],
  });
}
