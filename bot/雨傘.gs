/**
 * 共享雨傘（20）：規劃與 Raingo 合作，在錢穆故居站和校門口設雨傘租借站，一站借、另一站還
 *
 * 借還都在 Raingo 的租借站和 App 完成，Bot 不經手，也不知道誰借了傘、借了幾把，
 * 所以這裡只告訴同學租借站在哪裡、怎麼借；借傘不給積分，每日報表也不算借傘。
 * 租借站設好後，把 Raingo 的借用說明網址放進指令碼屬性 RAINGO_URL，卡片就會多一顆「看借用方式」。
 * 用到卡片.gs 的 dsCard_（設計稿版型）。
 */
const UM_SPOTS = ['錢穆故居站', '東吳大學校門口'];

/** 文字訊息開頭是「借傘」「還傘」「共享雨傘」時由 Code.gs 轉過來（11/28 團隊設計稿的樣子） */
function umText_() {
  const guide = PROPS.getProperty('RAINGO_URL');
  return dsCard_({ // 卡片.gs
    kicker: '多元通勤服務',
    title: '☂️ 共享雨傘服務',
    badge: '規劃中',
    lead: '與 Raingo 合作，提供通勤途中雨傘租借服務。',
    blocks: [{ sec: '租借據點' }].concat(UM_SPOTS.map(spot => ({ place: { name: spot, badge: '規劃設置', note: 'Raingo 雨傘租借站' } })), [
      { sec: '租借方式' },
      { steps: [
        ['01', '前往租借站', '至錢穆故居站或東吳校門口尋找 Raingo 雨傘租借設備。'],
        ['02', '使用手機租借', '透過 Raingo 完成雨傘租借及相關操作。'],
        ['03', '跨站歸還', '可於合作租借站歸還，不必回到原租借地點。'],
      ] },
      { panel: { lines: ['ⓘ 服務提醒：本服務目前仍在規劃中，實際租借據點及使用方式以正式公告為準。'] } },
    ]),
    buttons: guide ? [{ label: '看借用方式', uri: guide }] : [],
  });
}
