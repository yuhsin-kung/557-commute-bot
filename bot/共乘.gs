/**
 * 計程車共乘（12）：東吳 ↔ 士林站，即時＋預約
 *
 * 每一團都是「方向 + 出發時間」：
 *   - 現在走：第一個人開鈴後最多等 5 分鐘，滿 4 人或時間到就成團
 *   - 預約：10 分鐘一格。出發前 5 分鐘開放現場的人加入，並提醒預約的人
 * 2 人以上平分車資；只有 1 人一樣算成團，送積分。預約沒出現扣信用分。
 * 平台只湊人、不碰錢：團主自己用叫車 App 叫車付款，其他人轉給團主。
 *
 * 等車室是一個網頁（等車室.gs），每 3 秒問一次 cpRoomState，所以不用推播額度。
 * 會用到推播的只有：預約有人加入／取消的回報、出發前 5 分鐘的提醒。
 *
 * 第一次使用：部署新版本後，在編輯器執行一次「設定共乘排程」。
 * 用到 Code.gs 的 PROPS、TZ，卡片.gs 的 choices_（訊息裡的按鈕）。
 */
const CP = {
  FARE: 160,              // 士林捷運站 ↔ 外雙溪校區的參考車資（學校公告）
  SEATS: 4,
  LIVE_WAIT_MIN: 5,       // 現在走：最多等幾分鐘
  OPEN_BEFORE_MIN: 5,     // 預約：出發前幾分鐘轉成即時團、發提醒；在這之前取消不扣分
  NO_SHOW_GRACE_MIN: 3,   // 預約：出發時間過幾分鐘還沒按「我到了」算沒出現
  SLOT_MIN: 10,           // 預約幾分鐘一格
  RESERVE_DAYS: 7,        // 最遠可以預約幾天後
  SOLO_POINTS: 1,         // 只有一個人的獎勵，一天一次（積分 5 點換 30 元學餐折價券）
  NO_SHOW_PENALTY: 5,
  LATE_CANCEL_PENALTY: 2,
  RIDE_BONUS: 1,          // 完成一次共乘加回的信用分
  MIN_CREDIT: 80,         // 信用分低於這個數字不能預約
  PUSH_KEEP: 30,          // 推播額度至少留這麼多給雨天、考試週提醒
};

const CP_DIRS = {
  去學校: { label: '士林站 → 東吳', meet: '捷運士林站 1 號出口' },
  回士林: { label: '東吳 → 士林站', meet: '東吳大學校門口（第一警衛亭旁）' },
};

const CP_BOT_ID = '@311zktcn'; // 等車室裡「回 LINE」的連結要用

const CP_GROUP_HEAD = ['團號', '方向', '類型', '出發時間', '狀態', '團主', '成員', '建立時間', '更新時間', '已提醒', '已檢查沒出現'];
const CP_USER_HEAD = ['使用者 ID', '暱稱', '信用分', '積分', '上次獨行獎勵', '等車室代碼', '加入時間'];
const CP_LOG_HEAD = ['時間', '團號', '使用者 ID', '方向', '類型', '事件', '人數', '每人金額', '積分變化', '信用分變化'];
const CP_ACTIVE = ['等待中', '已成團', '已叫車'];

// ===== LINE 訊息 =====

/** 文字訊息開頭是「共乘」「我的共乘」「取消共乘」時由 Code.gs 轉過來 */
function cpText_(uid, text) {
  return cpLocked_(() => {
    cpTick_(cpNow_());
    const p = text.trim().split(/\s+/);
    if (p[0] === '我的共乘') return cpMine_(uid);
    if (p[0] === '取消共乘') return cpCancel_(uid, p[1]);
    const dir = p[1];
    if (!CP_DIRS[dir]) return cpAskDir_();
    if (p[2] === '現在走') return cpLiveStatus_(uid, dir);
    if (p[2] === '加入') return cpJoinLive_(uid, dir);
    if (p[2] === '預約') return p[3] ? cpSlotStatus_(uid, dir, cpParseTime_(p[3], p[4])) : cpAskTime_(dir);
    if (p[2] === '確認') return cpReserve_(uid, dir, cpParseTime_(p[3], p[4]));
    return cpAskMode_(dir);
  });
}

/** 「自己選時間」的日期時間選擇器 */
function cpPostback_(uid, postback) {
  const m = String(postback.data || '').match(/^cp=預約&dir=(.+)$/);
  if (!m || !CP_DIRS[m[1]] || !postback.params || !postback.params.datetime) return null;
  const parts = postback.params.datetime.split('T');
  return cpText_(uid, '共乘 ' + m[1] + ' 預約 ' + parts[0] + ' ' + parts[1]);
}

function cpAskDir_() {
  return choices_('🚕 計程車共乘\n\n湊 2～4 個同學一起搭，車資平分：2 人各 ' + cpShare_(2) + '、3 人各 ' + cpShare_(3) + '、4 人各 ' + cpShare_(4) + ' 元。\n\n要往哪個方向？',
    Object.keys(CP_DIRS).map(d => [CP_DIRS[d].label, '共乘 ' + d]).concat([['我的共乘', '我的共乘']]), { primary: false }); // 兩個方向一樣重要，不特別標一個
}

function cpAskMode_(dir) {
  return choices_('🚕 ' + CP_DIRS[dir].label + '\n\n現在就要走，還是先預約？',
    [['🔔 現在走', '共乘 ' + dir + ' 現在走'], ['📅 預約', '共乘 ' + dir + ' 預約']]);
}

// ----- 現在走 -----

function cpLiveStatus_(uid, dir) {
  const now = cpNow_();
  const groups = cpLoadGroups_();
  const mine = cpCurrentOf_(groups, uid, now);
  if (mine) return cpRoomButton_(uid, '你已經在一團裡了：' + cpWhen_(mine.depart, now) + ' ' + CP_DIRS[mine.dir].label + '，目前 ' + mine.members.length + ' 人。');

  const g = cpJoinable_(groups, dir, now);
  if (!g) {
    return choices_('🔔 ' + CP_DIRS[dir].label + '\n\n現在沒有人在等，你是第一個。\n我幫你開鈴，最多等 ' + CP.LIVE_WAIT_MIN + ' 分鐘。\n\n'
      + '一個人 ' + CP.FARE + ' 元；2 人各 ' + cpShare_(2) + '、3 人各 ' + cpShare_(3) + '、4 人各 ' + cpShare_(4) + ' 元。\n時間到還是沒人，送你 ' + CP.SOLO_POINTS + ' 點。',
      [['開鈴', '共乘 ' + dir + ' 加入'], ['改成預約', '共乘 ' + dir + ' 預約']]);
  }
  const n = g.members.length;
  const left = Math.max(1, Math.ceil((g.depart - now) / 60000));
  return choices_('🔔 ' + CP_DIRS[dir].label + '\n\n現在有 ' + n + ' 個人在等，' + (g.type === '預約' ? cpWhen_(g.depart, now) + ' 出發' : '還剩 ' + left + ' 分鐘') + '。\n'
    + '你加入就 ' + (n + 1) + ' 人，一人約 ' + cpShare_(n + 1) + ' 元（現在 ' + cpShare_(n) + ' 元）。\n集合點：' + CP_DIRS[dir].meet,
    [['加入', '共乘 ' + dir + ' 加入']]);
}

function cpJoinLive_(uid, dir) {
  const now = cpNow_();
  const groups = cpLoadGroups_();
  const mine = cpCurrentOf_(groups, uid, now);
  if (mine) return cpRoomButton_(uid, '你已經在一團裡了，打開等車室看看現在幾個人。');

  const user = cpUser_(uid);
  let g = cpJoinable_(groups, dir, now);
  if (!g) {
    g = { id: cpNewId_(), dir: dir, type: '即時', depart: new Date(now.getTime() + CP.LIVE_WAIT_MIN * 60000),
      status: '等待中', leader: uid, members: [], created: now, reminded: false, checked: false };
  }
  g.members.push({ id: uid, name: user.name, at: now.getTime(), arrived: true, boarded: false });
  cpSaveGroup_(g);
  cpLog_(g, uid, '加入', 0, 0);
  cpTick_(now); // 滿 4 人馬上成團

  const n = g.members.length;
  return cpRoomButton_(uid, (n === 1 ? '🔔 已開鈴！你是第一個，也是團主。' : '✅ 已加入，現在 ' + n + ' 人，一人約 ' + cpShare_(n) + ' 元。')
    + '\n集合點：' + CP_DIRS[dir].meet + '\n\n打開等車室，有人加入會響。');
}

// ----- 預約 -----

function cpAskTime_(dir) {
  const now = cpNow_();
  const day = n => Utilities.formatDate(new Date(now.getTime() + n * 86400000), TZ, 'yyyy-MM-dd');
  // 早八（08:10）、第二節（09:10）往回推車程和走路；回程抓第 8 節、第 9 節下課後
  const presets = dir === '去學校'
    ? [['明天 07:40（早八前）', day(1) + ' 07:40'], ['明天 08:40（第二節前）', day(1) + ' 08:40']]
    : [['17:10（第 8 節下課）', '17:10'], ['18:30（第 9 節下課）', '18:30']].map(([label, hm]) => {
      const today = cpParseTime_(day(0), hm) - now > CP.OPEN_BEFORE_MIN * 60000;
      return [(today ? '今天 ' : '明天 ') + label, day(today ? 0 : 1) + ' ' + hm];
    });
  const iso = d => Utilities.formatDate(d, TZ, "yyyy-MM-dd'T'HH:mm");
  const items = presets.map(([label, when]) => [label, '共乘 ' + dir + ' 預約 ' + when]);
  items.push({ label: '自己選時間', picker: {
    data: 'cp=預約&dir=' + dir, mode: 'datetime',
    initial: iso(cpRound_(new Date(now.getTime() + 30 * 60000))),
    min: iso(new Date(now.getTime() + (CP.OPEN_BEFORE_MIN + 1) * 60000)),
    max: iso(new Date(now.getTime() + CP.RESERVE_DAYS * 86400000)),
  } });
  return choices_('📅 預約 ' + CP_DIRS[dir].label + '\n\n要幾點出發？（' + CP.SLOT_MIN + ' 分鐘一班）', items); // 卡片.gs
}

function cpSlotStatus_(uid, dir, when) {
  const now = cpNow_();
  const bad = cpCheckSlot_(when, now, dir);
  if (bad) return bad;
  const g = cpSlotGroup_(cpLoadGroups_(), dir, when);
  const title = '📅 ' + cpWhen_(when, now) + ' ' + CP_DIRS[dir].label + '\n\n';
  if (g && g.members.some(m => m.id === uid)) {
    return choices_(title + '你已經預約這班了，目前 ' + g.members.length + ' 人，一人約 ' + cpShare_(g.members.length) + ' 元。', [['我的共乘', '我的共乘'], ['取消共乘', '取消共乘 ' + g.id]]);
  }
  const n = g ? g.members.length : 0;
  if (n >= CP.SEATS) return choices_(title + '這班已經滿 ' + CP.SEATS + ' 人了，換個時間吧。', [['換時間', '共乘 ' + dir + ' 預約']]);
  const iso = Utilities.formatDate(when, TZ, 'yyyy-MM-dd HH:mm');
  return choices_(title + (n ? '這個時段目前 ' + n + ' 人。你加入後 ' + (n + 1) + ' 人，一人約 ' + cpShare_(n + 1) + ' 元。' : '這個時段還沒有人，你是第一個。有人加入我會通知你。')
    + '\n集合點：' + CP_DIRS[dir].meet, [['預約', '共乘 ' + dir + ' 確認 ' + iso], ['換時間', '共乘 ' + dir + ' 預約']]);
}

function cpReserve_(uid, dir, when) {
  const now = cpNow_();
  const bad = cpCheckSlot_(when, now, dir);
  if (bad) return bad;
  const user = cpUser_(uid);
  if (user.credit < CP.MIN_CREDIT) {
    return choices_('你的信用分是 ' + user.credit + ' 分，低於 ' + CP.MIN_CREDIT + ' 分暫時不能預約。\n用「現在走」完成共乘，每次可以加回 ' + CP.RIDE_BONUS + ' 分。', [['🔔 現在走', '共乘 ' + dir + ' 現在走']]);
  }
  let g = cpSlotGroup_(cpLoadGroups_(), dir, when);
  if (g && g.members.some(m => m.id === uid)) return cpSlotStatus_(uid, dir, when);
  if (g && g.members.length >= CP.SEATS) return cpSlotStatus_(uid, dir, when);
  if (!g) g = { id: cpNewId_(), dir: dir, type: '預約', depart: when, status: '等待中', leader: uid, members: [], created: now, reminded: false, checked: false };

  const others = g.members.map(m => m.id);
  const before = g.members.length;
  g.members.push({ id: uid, name: user.name, at: now.getTime(), arrived: false, boarded: false });
  if (!g.members.some(m => m.id === g.leader)) g.leader = uid;
  cpSaveGroup_(g);
  cpLog_(g, uid, '預約', 0, 0);

  const n = g.members.length;
  const what = cpWhen_(when, now) + ' ' + CP_DIRS[dir].label;
  cpPush_(others, '🔔 ' + what + '，又有 1 人加入\n現在 ' + n + ' 人，一人約 ' + cpShare_(n) + ' 元（原本 ' + cpShare_(before) + ' 元）');

  return choices_('✅ 已預約 ' + what + '\n目前 ' + n + ' 人，一人約 ' + cpShare_(n) + ' 元\n集合點：' + CP_DIRS[dir].meet + '\n\n'
    + '・有人加入或取消，我會通知你\n・出發前 ' + CP.OPEN_BEFORE_MIN + ' 分鐘到集合點，傳「我的共乘」打開等車室按「我到了」\n'
    + '・出發 ' + CP.OPEN_BEFORE_MIN + ' 分鐘前可以免費取消；沒出現扣信用分 ' + CP.NO_SHOW_PENALTY + ' 分',
    [['我的共乘', '我的共乘'], ['取消共乘', '取消共乘 ' + g.id]]);
}

function cpCheckSlot_(when, now, dir) {
  const again = [['重新選時間', '共乘 ' + dir + ' 預約']];
  if (!when || isNaN(when)) return choices_('我看不懂這個時間，重新選一次吧。', again);
  if (when - now <= CP.OPEN_BEFORE_MIN * 60000) return choices_('這個時間太近了，' + CP.OPEN_BEFORE_MIN + ' 分鐘內要走請用「現在走」。', [['🔔 現在走', '共乘 ' + dir + ' 現在走']].concat(again));
  if (when - now > CP.RESERVE_DAYS * 86400000) return choices_('最遠只能預約 ' + CP.RESERVE_DAYS + ' 天內的時間。', again);
  return null;
}

// ----- 我的共乘、取消 -----

function cpMine_(uid) {
  const now = cpNow_();
  const mine = cpLoadGroups_().filter(g => CP_ACTIVE.indexOf(g.status) >= 0 && g.members.some(m => m.id === uid))
    .sort((a, b) => a.depart - b.depart);
  const user = cpUser_(uid);
  const me = '信用分 ' + user.credit + '・積分 ' + user.points;
  if (!mine.length) return choices_('你目前沒有共乘。\n' + me, [['🚕 共乘', '共乘']]);
  const lines = mine.map(g => '・' + cpWhen_(g.depart, now) + ' ' + CP_DIRS[g.dir].label + '（' + g.status + '，' + g.members.length + ' 人，一人約 ' + cpShare_(g.members.length) + ' 元）');
  return cpRoomButton_(uid, '🚕 我的共乘\n' + lines.join('\n') + '\n\n' + me, [['取消共乘', '取消共乘']]);
}

function cpCancel_(uid, groupId) {
  const now = cpNow_();
  const mine = cpLoadGroups_().filter(g => CP_ACTIVE.indexOf(g.status) >= 0 && g.members.some(m => m.id === uid && !m.boarded))
    .sort((a, b) => a.depart - b.depart);
  if (!mine.length) return choices_('你目前沒有可以取消的共乘。', [['🚕 共乘', '共乘']]);
  let g = groupId ? mine.filter(x => x.id === groupId)[0] : (mine.length === 1 ? mine[0] : null);
  if (!g) {
    return choices_('要取消哪一班？', mine.map(x => [cpWhen_(x.depart, now) + ' ' + (x.dir === '去學校' ? '往東吳' : '往士林'), '取消共乘 ' + x.id]));
  }
  const penalty = cpLeave_(g, uid, now);
  return choices_('已取消 ' + cpWhen_(g.depart, now) + ' ' + CP_DIRS[g.dir].label + '。'
    + (penalty ? '\n因為已經成團或快出發了，信用分扣 ' + penalty + ' 分。' : ''), [['🚕 共乘', '共乘']]);
}

/** 把人從團裡移掉；快出發或已成團才走要扣信用分。回傳扣了幾分 */
function cpLeave_(g, uid, now) {
  const late = g.status !== '等待中' || (g.type === '預約' && cpOpen_(g, now));
  const penalty = late ? CP.LATE_CANCEL_PENALTY : 0;
  const before = g.members.length;
  g.members = g.members.filter(m => m.id !== uid);
  if (!g.members.length) g.status = '取消';
  else if (g.leader === uid) g.leader = g.members[0].id;
  if (g.status === '已成團' && g.members.length === 1) g.status = '等待中'; // 剩一個人，交給 cpTick_ 判斷獨行
  cpSaveGroup_(g);
  if (penalty) cpCredit_(uid, -penalty);
  cpLog_(g, uid, late ? '臨時取消' : '取消', 0, -penalty, before);

  if (g.type === '預約' && g.members.length) {
    const n = g.members.length;
    cpPush_(g.members.map(m => m.id), cpWhen_(g.depart, now) + ' ' + CP_DIRS[g.dir].label + ' 那班有 1 人取消，現在 ' + n + ' 人，一人約 ' + cpShare_(n) + ' 元');
  }
  return penalty;
}

// ===== 每分鐘檢查：成團、獨行獎勵、沒出現、出發提醒 =====

function 共乘每分鐘檢查() {
  cpLocked_(() => cpTick_(cpNow_()));
  lvTick_(cpNow_()); // 發車提醒.gs：順便推播到時間的 557 發車提醒
}

function cpTick_(now) {
  cpLoadGroups_().filter(g => CP_ACTIVE.indexOf(g.status) >= 0).forEach(g => {
    let changed = false;

    if (g.status === '等待中') {
      if (g.type === '預約' && !g.reminded && g.members.length && cpOpen_(g, now)) {
        g.reminded = true;
        changed = true;
        const n = g.members.length;
        cpPush_(g.members.map(m => m.id), '🚕 你預約的 ' + cpWhen_(g.depart, now) + ' ' + CP_DIRS[g.dir].label + ' 快出發了\n現在 ' + n + ' 人，一人約 ' + cpShare_(n) + ' 元\n集合點：' + CP_DIRS[g.dir].meet
          + '\n\n到了請傳「我的共乘」，打開等車室按「我到了」。');
      }
      if (!g.members.length) {
        g.status = '取消';
        changed = true;
      } else if (now >= g.depart || (g.members.length >= CP.SEATS && cpOpen_(g, now))) {
        // 預約團就算提早滿了，也要等到出發前 5 分鐘才算成團（在那之前還能免費取消）
        if (g.members.length >= 2) {
          g.status = '已成團';
          changed = true;
        } else if (g.members[0].arrived) {
          cpSolo_(g);
          changed = true;
        } // 預約的那一個人還沒到：等到寬限時間再算沒出現
      }
    }

    if (g.type === '預約' && !g.checked && now - g.depart >= CP.NO_SHOW_GRACE_MIN * 60000 && CP_ACTIVE.indexOf(g.status) >= 0) {
      g.checked = true;
      changed = true;
      const size = g.members.length;
      g.members.filter(m => !m.arrived && !m.boarded).forEach(m => {
        cpCredit_(m.id, -CP.NO_SHOW_PENALTY);
        cpLog_(g, m.id, '沒出現', 0, -CP.NO_SHOW_PENALTY, size);
      });
      g.members = g.members.filter(m => m.arrived || m.boarded);
      if (!g.members.length) {
        g.status = '取消';
      } else {
        if (!g.members.some(m => m.id === g.leader)) g.leader = g.members[0].id;
        if (g.members.length === 1 && g.status !== '已叫車') cpSolo_(g);
      }
    }

    if ((g.status === '已成團' || g.status === '已叫車') && now - g.depart > 60 * 60000) {
      g.status = '已結束';
      changed = true;
    }
    if (changed) cpSaveGroup_(g);
  });
}

/** 只有一個人：一樣算成團，送積分（一天一次） */
function cpSolo_(g) {
  g.status = '獨行';
  const m = g.members[0];
  const user = cpUser_(m.id);
  const today = Utilities.formatDate(cpNow_(), TZ, 'yyyy-MM-dd');
  m.reward = user.soloDay === today || ptFull_(m.id) ? 0 : CP.SOLO_POINTS; // 積分.gs：一天最多 3 點
  if (m.reward) {
    user.points += m.reward;
    user.soloDay = today;
    cpSaveUser_(user);
  }
  cpLog_(g, m.id, '獨行', m.reward, 0);
}

// ===== 等車室網頁呼叫的函式（google.script.run） =====

function doGet(e) {
  const token = e && e.parameter && e.parameter.t;
  if (e && e.parameter && e.parameter.page === 'geo') return geoTestPage_(); // 定位測試.gs
  if (e && e.parameter && e.parameter.page === 'eta') return etaPage_(); // 到校預估.gs：定位 → 捷運 → 557 → 幾點到東吳
  if (e && e.parameter && e.parameter.page === 'survey') return surveyPage_(); // 問卷入口.gs：A／B／C 自動分配
  if (e && e.parameter && e.parameter.page === 'checkin' && /^[0-9a-f-]{36}$/.test(token || '')) return ptCheckinPage_(token); // 積分.gs
  if (e && e.parameter && e.parameter.page === 'coupon' && /^[0-9a-f-]{36}$/.test(token || '') && /^SC\d{4}-\d{4}$/.test(e.parameter.c || '')) return ptCouponPage_(token, e.parameter.c); // 積分.gs
  if (e && e.parameter && e.parameter.page === 'room' && /^[0-9a-f-]{36}$/.test(token || '')) {
    return HtmlService.createHtmlOutput(ROOM_HTML.replace('__TOKEN__', token).replace('__BOT__', CP_BOT_ID)) // 等車室.gs
      .setTitle('共乘等車室')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  }
  return ContentService.createTextOutput('東吳通勤達人');
}

function cpRoomState(token) {
  return cpLocked_(() => {
    const now = cpNow_();
    cpTick_(now);
    return cpRoomView_(token, now);
  });
}

/** action：arrived（我到了）、call（叫車）、board（上車了）、leave（離開） */
function cpRoomAction(token, action) {
  return cpLocked_(() => {
    const now = cpNow_();
    cpTick_(now);
    const user = cpUserByToken_(token);
    const g = user && cpCurrentOf_(cpLoadGroups_(), user.id, now);
    const me = g && g.members.filter(m => m.id === user.id)[0];
    if (me && CP_ACTIVE.indexOf(g.status) >= 0) {
      if (action === 'arrived') {
        me.arrived = true;
        cpSaveGroup_(g);
      } else if (action === 'leave' && !me.boarded) {
        cpLeave_(g, user.id, now);
      } else if (action === 'call' && g.leader === user.id && g.status === '已成團') {
        g.status = '已叫車';
        cpSaveGroup_(g);
        cpLog_(g, user.id, '叫車', 0, 0);
      } else if (action === 'board' && g.status !== '等待中' && !me.boarded) {
        me.boarded = true;
        me.arrived = true;
        if (g.members.every(m => m.boarded)) g.status = '已出發';
        cpSaveGroup_(g);
        cpCredit_(user.id, CP.RIDE_BONUS);
        cpLog_(g, user.id, '上車', 0, CP.RIDE_BONUS);
      }
      cpTick_(now);
    }
    return cpRoomView_(token, now);
  });
}

function cpRoomView_(token, now) {
  const user = cpUserByToken_(token);
  if (!user) return { ok: false };
  const g = cpCurrentOf_(cpLoadGroups_(), user.id, now, true);
  if (!g) return { ok: true, none: true, credit: user.credit, points: user.points };
  const me = g.members.filter(m => m.id === user.id)[0];
  const n = g.members.length;
  return {
    ok: true,
    status: g.status,
    type: g.type,
    dir: CP_DIRS[g.dir].label,
    meet: CP_DIRS[g.dir].meet,
    when: cpWhen_(g.depart, now),
    departAt: g.depart.getTime(),
    now: now.getTime(),
    total: CP.FARE,
    share: cpShare_(n),
    seats: CP.SEATS,
    isLeader: g.leader === user.id,
    arrived: !!me.arrived,
    boarded: !!me.boarded,
    reward: me.reward || 0,
    members: g.members.map(m => ({ name: m.name, leader: m.id === g.leader, me: m.id === user.id, arrived: !!m.arrived, boarded: !!m.boarded })),
    credit: user.credit,
    points: user.points,
  };
}

// ===== 資料：共乘團、共乘用戶、共乘紀錄 =====

function cpLoadGroups_() {
  return cpSheet_('共乘團', CP_GROUP_HEAD).getDataRange().getValues().slice(1).map((r, i) => ({
    row: i + 2, id: r[0], dir: r[1], type: r[2], depart: new Date(r[3]), status: r[4], leader: r[5],
    members: JSON.parse(r[6] || '[]'), created: new Date(r[7]), updated: new Date(r[8]),
    reminded: r[9] === true, checked: r[10] === true,
  }));
}

function cpSaveGroup_(g) {
  const sheet = cpSheet_('共乘團', CP_GROUP_HEAD);
  g.updated = cpNow_();
  const row = [g.id, g.dir, g.type, g.depart, g.status, g.leader, JSON.stringify(g.members), g.created, g.updated, !!g.reminded, !!g.checked];
  if (g.row) {
    sheet.getRange(g.row, 1, 1, row.length).setValues([row]);
  } else {
    sheet.appendRow(row);
    g.row = sheet.getLastRow();
  }
}

/** 這個方向現在可以加入的團：即時團，或 5 分鐘內要出發的預約團 */
function cpJoinable_(groups, dir, now) {
  return groups.filter(g => g.dir === dir && g.status === '等待中' && g.members.length < CP.SEATS && now < g.depart && cpOpen_(g, now))
    .sort((a, b) => a.depart - b.depart)[0];
}

/** 即時團一直是開放的；預約團要到出發前 5 分鐘才開放現場加入 */
function cpOpen_(g, now) {
  return g.type === '即時' || g.depart - now <= CP.OPEN_BEFORE_MIN * 60000;
}

function cpSlotGroup_(groups, dir, when) {
  return groups.filter(g => g.dir === dir && g.type === '預約' && g.status === '等待中' && g.depart.getTime() === when.getTime())[0];
}

/**
 * 這個人「現在」所在的團：即時團，或已經開放現場加入的預約團。
 * withRecent=true 時，15 分鐘內剛結束的團也算（等車室要顯示結果）。
 */
function cpCurrentOf_(groups, uid, now, withRecent) {
  const mine = groups.filter(g => g.members.some(m => m.id === uid));
  const live = mine.filter(g => CP_ACTIVE.indexOf(g.status) >= 0 && cpOpen_(g, now))
    .sort((a, b) => a.depart - b.depart)[0];
  if (live || !withRecent) return live;
  const upcoming = mine.filter(g => CP_ACTIVE.indexOf(g.status) >= 0).sort((a, b) => a.depart - b.depart)[0];
  if (upcoming) return upcoming;
  return mine.filter(g => now - g.updated <= 15 * 60000).sort((a, b) => b.updated - a.updated)[0];
}

function cpUser_(uid) {
  const sheet = cpSheet_('共乘用戶', CP_USER_HEAD);
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === uid) return cpUserFromRow_(rows[i], i + 1);
  }
  const user = { id: uid, name: cpLineName_(uid), credit: 100, points: 0, soloDay: '', token: Utilities.getUuid(), joined: cpNow_() };
  sheet.appendRow([user.id, user.name, user.credit, user.points, user.soloDay, user.token, user.joined]);
  user.row = sheet.getLastRow();
  return user;
}

function cpUserByToken_(token) {
  const rows = cpSheet_('共乘用戶', CP_USER_HEAD).getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (token && rows[i][5] === token) return cpUserFromRow_(rows[i], i + 1);
  }
  return null;
}

function cpUserFromRow_(r, row) {
  // 試算表會把「2026-10-12」自動轉成日期，讀回來時統一成字串
  const soloDay = r[4] instanceof Date ? Utilities.formatDate(r[4], TZ, 'yyyy-MM-dd') : String(r[4] || '');
  return { row: row, id: r[0], name: r[1], credit: Number(r[2]), points: Number(r[3]), soloDay: soloDay, token: r[5], joined: r[6] };
}

function cpSaveUser_(user) {
  cpSheet_('共乘用戶', CP_USER_HEAD).getRange(user.row, 1, 1, 7)
    .setValues([[user.id, user.name, user.credit, user.points, user.soloDay, user.token, user.joined]]);
}

function cpCredit_(uid, delta) {
  const user = cpUser_(uid);
  user.credit = Math.max(0, Math.min(100, user.credit + delta));
  cpSaveUser_(user);
}

/** 每個動作都記一筆，之後算配對成功率、平均等候時間（測試數據） */
function cpLog_(g, uid, event, points, credit, size) {
  const n = size || g.members.length;
  cpSheet_('共乘紀錄', CP_LOG_HEAD).appendRow([cpNow_(), g.id, uid, g.dir, g.type, event, n, cpShare_(n), points, credit]);
}

function cpSheet_(name, head) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(head);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ===== LINE：暱稱、推播、訊息格式 =====

/** 等車室裡顯示的名字用 LINE 暱稱（只有同一團的人看得到） */
function cpLineName_(uid) {
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/profile/' + uid, {
      headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
      muteHttpExceptions: true,
    });
    if (res.getResponseCode() === 200) return String(JSON.parse(res.getContentText()).displayName || '').slice(0, 10) || '同學';
  } catch (err) {
    console.error(err);
  }
  return '同學';
}

/** 推播給一群人。額度不夠就不發（回傳 false），把剩下的留給雨天、考試週提醒 */
function cpPush_(uids, text) {
  if (!uids.length) return false;
  try {
    if (cpQuotaLeft_() - uids.length < CP.PUSH_KEEP) return false;
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/multicast', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
      payload: JSON.stringify({ to: uids, messages: [choices_(text, [['我的共乘', '我的共乘'], ['取消共乘', '取消共乘']])] }),
    });
    return true;
  } catch (err) {
    console.error(err); // 推播失敗不能讓預約本身失敗
    return false;
  }
}

function cpQuotaLeft_() {
  const get = path => JSON.parse(UrlFetchApp.fetch('https://api.line.me/v2/bot/message/' + path, {
    headers: { Authorization: 'Bearer ' + PROPS.getProperty('LINE_CHANNEL_ACCESS_TOKEN') },
  }).getContentText());
  const quota = get('quota');
  return quota.type === 'none' ? Infinity : quota.value - get('quota/consumption').totalUsage;
}

/** 回一段話加「打開等車室」的按鈕；items 是另外要放的按鈕 */
function cpRoomButton_(uid, text, items) {
  const url = cpWebAppUrl_() + '?page=room&t=' + cpUser_(uid).token;
  return choices_(text, [{ label: '打開等車室', uri: url }].concat(items || [])); // 卡片.gs
}

/** 等車室的網址就是 Bot 的部署網址；抓不到時可以在指令碼屬性設 WEBAPP_URL */
function cpWebAppUrl_() {
  return PROPS.getProperty('WEBAPP_URL') || ScriptApp.getService().getUrl();
}

// ===== 小工具 =====

function cpNow_() {
  return new Date();
}

/** 車資平分，進位到 5 元：2 人 80、3 人 55、4 人 40 */
function cpShare_(n) {
  return n <= 1 ? CP.FARE : Math.ceil(CP.FARE / n / 5) * 5;
}

function cpParseTime_(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{1,2}:\d{2}$/.test(time || '')) return null;
  return cpRound_(new Date(date + 'T' + ('0' + time).slice(-5) + ':00+08:00'));
}

function cpRound_(date) {
  const step = CP.SLOT_MIN * 60000;
  return new Date(Math.round(date.getTime() / step) * step);
}

function cpWhen_(date, now) {
  const day = d => Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  const hm = Utilities.formatDate(date, TZ, 'HH:mm');
  if (day(date) === day(now)) return '今天 ' + hm;
  if (day(date) === day(new Date(now.getTime() + 86400000))) return '明天 ' + hm;
  return Utilities.formatDate(date, TZ, 'M/d') + ' ' + hm;
}

function cpNewId_() {
  return 'G' + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** 兩個人同時按「加入」時，一次只讓一個人改試算表 */
function cpLocked_(work) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

// ===== 在編輯器裡手動執行 =====

/** 執行一次就好：每分鐘檢查成團、沒出現、出發提醒 */
function 設定共乘排程() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === '共乘每分鐘檢查')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('共乘每分鐘檢查').timeBased().everyMinutes(1).create();
  ['共乘團', '共乘用戶', '共乘紀錄'].forEach((name, i) => cpSheet_(name, [CP_GROUP_HEAD, CP_USER_HEAD, CP_LOG_HEAD][i]));
  console.log('✅ 已設定：每分鐘檢查一次共乘');
  console.log('等車室網址：' + cpWebAppUrl_() + '?page=room&t=…');
}
