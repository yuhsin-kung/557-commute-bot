/**
 * 兩份問卷的 Google 表單（題目和每一題對應哪個項目，見 repo 的「問卷題目.md」）
 *
 *   建立通勤問卷：① 通勤基本問卷，21 題，現在就發
 *   建立回饋問卷：② 使用後回饋，9 題，用 Bot 一週後發
 *
 * 在編輯器各執行一次，網址會印在執行記錄，答案存進這份試算表的新分頁。
 * 每份只會建立一次，再執行只會印出網址。要重建就刪掉指令碼屬性 SURVEY1_URL 或 SURVEY2_URL。
 * 兩份都匿名：不收 Email、不問姓名學號。
 */
const SURVEY_ADD_FRIEND = 'https://line.me/R/ti/p/%40311zktcn'; // 東吳通勤達人的加好友連結

function 建立通勤問卷() {
  surveyOnce_('SURVEY1_URL', buildCommuteSurvey_);
}

function 建立回饋問卷() {
  surveyOnce_('SURVEY2_URL', buildFeedbackSurvey_);
}

function surveyOnce_(key, build) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty(key)) {
    console.log('這份問卷已經建立過了，填寫用網址：' + props.getProperty(key));
    return;
  }
  const form = build();
  form.setCollectEmail(false);
  form.setProgressBar(true);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, SpreadsheetApp.getActiveSpreadsheet().getId());
  props.setProperty(key, form.getPublishedUrl());
  console.log('填寫用網址（發給同學）：' + form.getPublishedUrl());
  console.log('編輯表單網址（隊員自己用）：' + form.getEditUrl());
}

// ===== ① 通勤基本問卷 =====

function buildCommuteSurvey_() {
  const form = FormApp.create('東吳外雙溪通勤問卷');
  form.setDescription('東吳通勤小組想了解大家怎麼到外雙溪校區，結果會用來改善 557 擁擠問題。\n問卷匿名，不會收集姓名或學號，約 4 分鐘。');
  form.setConfirmationMessage('謝謝你！\n\n想幫忙測試 LINE Bot「東吳通勤達人」的話，點這裡加好友：\n' + SURVEY_ADD_FRIEND);

  section_(form, '基本資料');
  one_(form, '年級', ['大一', '大二', '大三', '大四', '碩博士班'], { other: true });
  one_(form, '一週有幾天要到外雙溪校區？', ['1 天', '2 天', '3 天', '4 天', '5 天以上']);
  one_(form, '一週有幾天有第一節（8:10）的課？', ['0 天', '1 天', '2 天', '3 天', '4 天以上']);

  section_(form, '怎麼到學校');
  many_(form, '你通常怎麼到學校？', ['557', '300', '其他公車到錢穆故居站再走路', '通勤30', '學校的劍南路站專車', '宿舍專車（泉思學舍）',
    '機車', 'YouBike', '走路', '家人接送', '計程車', '住校'], { help: '可以選好幾個' });
  one_(form, '如果搭捷運，你在哪一站下車轉公車？', ['士林站', '劍南路站（文湖線）', '大直站（文湖線）', '芝山站', '劍潭站', '不搭捷運'], { other: true });
  one_(form, '在士林站等 557，平均要等多久才上得了車？', ['不搭 557', '5 分鐘內', '5–10 分鐘', '10–20 分鐘', '20 分鐘以上']);
  one_(form, '過去一個月，你遇過幾次 557 太擠上不了車？', ['從來沒有', '1–2 次', '每週 1–2 次', '幾乎每天']);

  section_(form, '站牌');
  one_(form, '557 在士林站的上車處今年搬過。你第一次去搭的時候，有直接找到嗎？', ['直接找到', '找了一下才找到', '一開始走錯地方', '不知道有搬過', '沒有搭過']);
  one_(form, '你知道學校建議尖峰時段改到「士林國中站」排隊嗎？', ['知道，也會去那裡排', '知道，但還是在士林站排', '不知道']);
  many_(form, '下雨天你的通勤方式會改變嗎？', ['會提早出門', '本來走路或騎車，改搭 557', '改叫計程車', '不會改變'], { help: '可以選好幾個' });

  // 第 11 題選「天氣好才會」「不願意」的人才會看到第 12 題，所以第 12 題要自己一頁
  section_(form, '557 以外的選擇');
  const youbike = form.addMultipleChoiceItem().setTitle('你願意騎 YouBike（電輔車）上學嗎？').setRequired(true);

  const whyNot = form.addPageBreakItem().setTitle('YouBike');
  many_(form, '不想騎的原因是？', ['上坡太累', '怕曬或怕雨', '怕找不到車或車位', '路上車多危險', '費用'], { other: true, help: '可以選好幾個' });

  const rest = form.addPageBreakItem().setTitle('557 以外的選擇');
  youbike.setChoices([
    youbike.createChoice('願意', rest),
    youbike.createChoice('天氣好才會', whyNot),
    youbike.createChoice('校內有車可以還才會', rest),
    youbike.createChoice('不願意', whyNot),
  ]);

  one_(form, '如果有學生包車，固定時間從士林站直達校園，一趟你願意付多少？', ['不會搭', '15 元以下', '16–25 元', '26–35 元', '36–50 元', '50 元以上']);
  many_(form, '包車你需要哪些時段？', ['8:10 第一節前', '9:10 第二節前', '其他早上時段', '中午', '傍晚回家'], { required: false, help: '可以選好幾個；不會搭的話可以跳過' });
  one_(form, '士林站和學校之間搭計程車約 160 元，2 人各 80、3 人各 55、4 人各 40。如果 LINE Bot 可以幫你當場湊人或事先預約，你願意跟其他東吳同學共乘嗎？',
    ['願意', '趕時間或下雨才會', '只跟認識的人', '不願意']);

  section_(form, '如果有獎勵');
  one_(form, '有第一節課的那幾天，你通常幾點到學校？', ['7:30 以前', '7:30–7:50', '7:50–8:10', '踩線或遲到', '我沒有第一節課']);
  one_(form, '如果 7:30 前到校打卡可以換早餐，你一週會有幾天提早到？', ['0 天，我不會為了這個早起', '1–2 天', '3 天以上', '我本來就 7:30 前到'],
    { help: '提早到代表要比平常早出門。' });
  one_(form, '要換到什麼，你才會願意提早到？', ['10 元折價券就夠', '一杯飲料', '一份完整早餐（約 50 元）', '給什麼都不會']);
  one_(form, '從錢穆故居站走進學校大約 10 分鐘。如果走這一段可以累積點數換早餐或飲料，557 很擠的時候你會改搭其他公車到錢穆故居站再走進來嗎？',
    ['會，常常這樣做', '不趕時間的時候會', '下雨或很熱就不會', '不會']);

  section_(form, '最後');
  one_(form, '我們做了一個 LINE Bot，可以查 557 到站、比較其他路線、下雨天提醒。你願意加好友幫忙測試嗎？', ['願意（送出後會顯示加好友連結）', '不用了']);
  form.addParagraphTextItem().setTitle('對 557 通勤有什麼想說的？').setHelpText('選填');
  return form;
}

// ===== ② 使用後回饋 =====

function buildFeedbackSurvey_() {
  const form = FormApp.create('東吳通勤達人使用回饋');
  form.setDescription('謝謝你試用「東吳通勤達人」！想知道哪裡好用、哪裡要改。\n問卷匿名，約 2 分鐘。');
  form.setConfirmationMessage('收到了，謝謝你的回饋！');

  many_(form, '你用過 Bot 的哪些功能？', ['557 到站', '幫我比較路線', '問上課時間和大樓（例如「8 點 D 棟」）', '天氣', '557 在哪裡搭', '訂閱提醒', '共乘'], { help: '可以選好幾個' });
  one_(form, '你有照 Bot 的建議，改搭 557 以外的公車嗎？', ['有，比較快到', '有，差不多', '有，反而比較慢', '沒有']);
  scale_(form, 'Bot 算的到站和到校時間準嗎？', 1, 5, '很不準', '很準');
  one_(form, '收到下雨或考試週提醒的那天，你有提早出門嗎？', ['有，提早 5 分鐘內', '有，提早 5–15 分鐘', '有，提早 15 分鐘以上', '沒有提早', '沒收到提醒']);
  one_(form, '「557 在哪裡搭」的資訊有幫助嗎？', ['有幫助', '普通', '沒幫助', '沒用過']);
  scale_(form, '整體滿意度', 1, 5, '很不滿意', '很滿意');
  scale_(form, '你會推薦同學使用嗎？', 0, 10, '完全不會', '一定會');
  many_(form, '最希望我們接下來做什麼？', ['步行集點', '早到早餐券', 'YouBike 即時車數', '共享雨傘', '回家路線比較'], { other: true, required: false, help: '可以選好幾個' });
  form.addParagraphTextItem().setTitle('其他建議').setHelpText('選填');
  return form;
}

// ===== 出題用的小工具 =====

function section_(form, title) {
  form.addSectionHeaderItem().setTitle(title);
}

/** 單選題。options：{ other: 要不要「其他」, required: 預設必填, help: 題目下面的小字 } */
function one_(form, title, choices, options) {
  return question_(form.addMultipleChoiceItem(), title, choices, options);
}

/** 複選題 */
function many_(form, title, choices, options) {
  return question_(form.addCheckboxItem(), title, choices, options);
}

function question_(item, title, choices, options) {
  const o = options || {};
  item.setTitle(title).setChoiceValues(choices).setRequired(o.required !== false);
  if (o.other) item.showOtherOption(true);
  if (o.help) item.setHelpText(o.help);
  return item;
}

function scale_(form, title, low, high, lowLabel, highLabel) {
  return form.addScaleItem().setTitle(title).setBounds(low, high).setLabels(lowLabel, highLabel).setRequired(true);
}
