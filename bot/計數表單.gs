/**
 * 士林站現場計數表單
 * 在編輯器選「建立計數表單」執行一次，就會建立 Google 表單，
 * 答案自動存進這份試算表的新分頁。網址會印在執行記錄裡。
 */
function 建立計數表單() {
  // 只建立一次：建過就印出網址。要重建的話，到指令碼屬性刪掉 COUNT_FORM_URL
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('COUNT_FORM_URL')) {
    console.log('表單已經建立過了，填寫用網址：' + props.getProperty('COUNT_FORM_URL'));
    return;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const form = FormApp.create('557 士林站現場計數');
  form.setDescription(
    '每 10 分鐘記一次排隊人數；557 到站時再多記一筆上車人數。\n'
    + '時間會自動記錄，不用填。只數人數、不拍照、不記錄任何人的長相。'
  );
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());

  const atLeastZero = () => FormApp.createTextValidation()
    .setHelpText('請填 0 以上的數字')
    .requireNumberGreaterThanOrEqualTo(0)
    .build();

  form.addTextItem().setTitle('記錄人').setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('地點')
    .setChoiceValues(['捷運士林站（中正路 205 號前）', '士林國中站（中正路 341 號前）'])
    .showOtherOption(true)
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('這筆是')
    .setChoiceValues(['每 10 分鐘的排隊人數', '557 剛到站'])
    .setRequired(true);

  form.addTextItem()
    .setTitle('現在排隊人數')
    .setHelpText('前門、後門兩排加起來。人很多時可以 5 個 5 個數。')
    .setValidation(atLeastZero())
    .setRequired(true);

  form.addTextItem()
    .setTitle('（557 到站才填）上車人數')
    .setValidation(atLeastZero());

  form.addTextItem()
    .setTitle('（557 到站才填）車開走後還留在站上的人數')
    .setHelpText('也就是沒擠上車的人')
    .setValidation(atLeastZero());

  form.addMultipleChoiceItem()
    .setTitle('天氣')
    .setChoiceValues(['晴天', '陰天', '毛毛雨', '大雨'])
    .setRequired(true);

  form.addTextItem()
    .setTitle('這段時間看到幾次插隊')
    .setHelpText('沒看到就填 0；不要拍照、不要記錄是誰')
    .setValidation(atLeastZero());

  form.addParagraphTextItem().setTitle('備註').setHelpText('例如：車子直接過站沒停、有專車、隊伍被馬路切斷');

  props.setProperty('COUNT_FORM_URL', form.getPublishedUrl());
  console.log('填寫用網址（傳給計數的同學）：' + form.getPublishedUrl());
  console.log('編輯表單網址（隊員自己用）：' + form.getEditUrl());
}
