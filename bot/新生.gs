/**
 * 新生與排隊文化（模組五）：新生排隊教學（23）、排隊禮儀（28）；順便放學生自組包車的意願登記（43）
 *
 * 「新生須知」：加好友時自動跳出（選單.gs 的 menuWelcome_），也可以傳「新生須知」再看一次。
 *   重點說明＋教學短片連結（拍好後把網址放進指令碼屬性 NEWBIE_VIDEO_URL）
 * 「新生測驗」：三題小測驗，全對送積分、解鎖第一個成就（積分.gs）
 * 「排隊禮儀」：只講規則，不點名、不拍攝任何人
 * 「包車」：說明規劃中，按「我有興趣」記一筆到「意願紀錄」
 *
 * 上車地點會因捷運施工調整，所以這裡不寫死站牌位置，一律請學生按「557 站牌資訊」（站位變更.gs）。
 * 用到卡片.gs 的 choices_，共乘.gs 的 cpSheet_、cpNow_，積分.gs 的 ptAdd_、ptStats_、PT。
 */
const NB_QUIZ = [
  { q: '不確定 557 現在在哪裡上車，最可靠的方法是？', a: ['問路人', '按「557 站牌資訊」問我', '照去年的位置'], ok: 1 },
  { q: '隊伍被馬路切成兩段，你應該？', a: ['接在隊伍最後面', '從斷開的地方排進去', '站到車門旁邊等'], ok: 0 },
  { q: '557 太擠擠不上去，還可以怎麼辦？', a: ['只能等下一班 557', '搭其他公車到錢穆故居站再走進學校', '放棄上課'], ok: 1 },
];

function nbIntro_() {
  const video = PROPS.getProperty('NEWBIE_VIDEO_URL');
  return choices_([
    '🎒 新生須知：第一次搭 557，三件事先知道',
    '',
    '1️⃣ 上車地點會調整：捷運施工期間站牌搬過家，按「557 站牌資訊」看最新位置。',
    '2️⃣ 排隊看清楚：隊伍可能被馬路切成兩段，請接在最後面。',
    '3️⃣ 不一定要等 557：士林站有其他公車到錢穆故居站，走進學校大約 10 分鐘。按「比較所有公車路線」就知道哪一班最快。',
  ].concat(video ? ['', '🎬 一分鐘教學短片：' + video] : [])
    .concat(['', '看完做個小測驗，全對有 ' + PT.QUIZ + ' 點，還能解鎖第一個成就 👇']).join('\n'),
  [['新生測驗', '新生測驗'], ['557 站牌資訊', '557 站牌資訊'], ['排隊禮儀', '排隊禮儀']]);
}

/**
 * 「排隊禮儀」：一支短片，不寫一大段字。
 * 影片拍好後，把網址放進指令碼屬性 ETIQUETTE_VIDEO_URL，點畫面就會打開影片；還沒放之前先顯示影片的樣子。
 */
function nbEtiquette_() {
  const video = PROPS.getProperty('ETIQUETTE_VIDEO_URL');
  const screen = {
    type: 'box', layout: 'vertical', backgroundColor: '#2B2522', height: '170px', justifyContent: 'center', alignItems: 'center', spacing: 'sm',
    contents: [
      { type: 'box', layout: 'vertical', width: '64px', height: '64px', cornerRadius: '32px', backgroundColor: '#FFFFFFE6', justifyContent: 'center', alignItems: 'center',
        contents: [{ type: 'text', text: '▶', size: 'xxl', color: UI.brand, align: 'center' }] },
      { type: 'text', text: '1:00', size: 'xs', color: '#FFFFFFB3', align: 'center' },
    ],
  };
  if (video) screen.action = { type: 'uri', label: '看影片', uri: video };
  return {
    type: 'flex',
    altText: '排隊禮儀短片：一起排好，大家都快',
    contents: {
      type: 'bubble',
      hero: screen,
      body: { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '16px', spacing: 'sm', contents: [
        { type: 'text', text: '排隊禮儀', size: 'lg', weight: 'bold', color: UI.ink },
        { type: 'text', text: '一分鐘看懂 557 怎麼排隊，一起排好，大家都快', size: 'sm', color: UI.muted, wrap: true },
      ] },
      footer: { type: 'box', layout: 'vertical', backgroundColor: UI.paper, paddingAll: '12px', paddingTop: '0px', contents: [menuLink_()] }, // 卡片.gs
    },
  };
}

// ===== 新生測驗 =====

/** 「新生測驗」從第一題開始；「答 1」「答 2」「答 3」回答目前這一題。進度放在快取，30 分鐘沒答完就重來 */
function nbQuiz_(uid, text) {
  const cache = CacheService.getScriptCache();
  const m = text.match(/^答\s*([1-3])$/);
  const saved = m && cache.get('quiz_' + uid);
  if (!saved) return nbAsk_(uid, 0, 0);

  const state = JSON.parse(saved);
  const item = NB_QUIZ[state.i];
  const right = Number(m[1]) - 1 === item.ok;
  const score = state.score + (right ? 1 : 0);
  const feedback = right ? '⭕ 答對了！' : '❌ 正確答案是「' + item.a[item.ok] + '」。';
  if (state.i + 1 < NB_QUIZ.length) {
    return nbAsk_(uid, state.i + 1, score, feedback);
  }
  cache.remove('quiz_' + uid);
  cpSheet_('測驗紀錄', ['時間', '使用者 ID', '答對題數']).appendRow([cpNow_(), uid, score]);
  if (score < NB_QUIZ.length) {
    return choices_(feedback + '\n\n測驗結束：答對 ' + score + '/' + NB_QUIZ.length + ' 題。全對才有積分，再試一次吧！', [['新生測驗', '新生測驗']]);
  }
  // 全對只送一次積分
  const first = ptStats_(uid).測驗 === 0;
  const fresh = first ? ptAdd_(uid, '測驗', PT.QUIZ, 0, '新生測驗全對') : [];
  return feedback + '\n\n🎉 全部答對！' + (first ? '+' + PT.QUIZ + ' 點' : '（積分之前領過了）') + ptBadgeText_(fresh);
}

/** 出第 i 題。feedback 是上一題答對或答錯的說明，放在題目前面。三個選項是三顆按鈕，選項就寫在按鈕上 */
function nbAsk_(uid, i, score, feedback) {
  CacheService.getScriptCache().put('quiz_' + uid, JSON.stringify({ i: i, score: score }), 30 * 60);
  const item = NB_QUIZ[i];
  return choices_((feedback ? feedback + '\n\n' : '') + item.q,
    item.a.map((a, k) => [a, '答 ' + (k + 1)]),
    { title: '第 ' + (i + 1) + ' 題／共 ' + NB_QUIZ.length + ' 題', badge: '新生測驗', primary: false, menu: false });
}

// ===== 學生自組包車（43）：還在調查需求 =====

function charterText_(uid, text) {
  if (text.trim() === '包車 我有興趣') {
    cpSheet_('意願紀錄', ['時間', '使用者 ID', '項目', '內容']).appendRow([cpNow_(), uid, '包車', '有興趣']);
    return '收到！你的意願記下來了，包車確定開辦時會通知有訂閱提醒的同學。';
  }
  const survey = PROPS.getProperty('SURVEY1_URL'); // 問卷表單.gs「建立通勤問卷」存的網址
  return choices_([
    '🚐 學生自組包車（規劃中）',
    '',
    '想法：固定在尖峰時段從士林站直達校園，用學期訂閱制。',
    '目前在調查需求，還沒有發車。開辦前會先確認合法的業者和保險。',
  ].concat(survey ? ['', '願意付多少、需要哪些時段，請填問卷：' + survey] : []).join('\n'),
  [['我有興趣', '包車 我有興趣'], ['訂閱提醒', '訂閱提醒']]);
}
