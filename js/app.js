// ============================================================
// app.js — タイムラインアプリロジック
// ============================================================

// ============================================================
// 定数
// ============================================================
const TIME_SLOTS = (() => {
  const slots = [];
  for (let h = 5; h <= 21; h++) {
    slots.push(String(h).padStart(2, '0') + ':00');
    slots.push(String(h).padStart(2, '0') + ':30');
  }
  return slots; // 34スロット: 05:00, 05:30 ... 21:00, 21:30
})();

const CATEGORIES = [
  { key: 'ジナンの価値を上げる',        icon: '🚀' },
  { key: '健康・片付け',                icon: '💪' },
  { key: 'チーム関係（YouTube・運営）',  icon: '🎥' },
  { key: '投資・お金',                  icon: '💰' },
  { key: 'やるべきリスト',              icon: '✅' },
];

const DEFAULT_PRESETS = {
  'ジナンの価値を上げる': ['アウトプット', 'おすすめ整理（店・本・動画）', 'AIファイルの整理'],
  '健康・片付け': ['運動', 'パートナー', '部屋の片付け'],
  'チーム関係（YouTube・運営）': ['企画シート', 'ざわつかせた地図', 'ジナン業務'],
  '投資・お金': ['確定申告', '個人簿記', '法人簿記', '銀行整理'],
  'やるべきリスト': [
    '船舶免許の住所変更', '山手皮膚科の予約', 'クレカ更新（エニタイム・Zoom）',
    'ミニミニに確認（太陽光）', '太陽光発電の会社に連絡', 'Google / YouTube住所変更',
    'プルデンシャル解約', '火災保険の継続→切替', 'デスク購入', 'iPhone購入',
    '電子レンジ購入', 'ベッド購入', '人に会う（ヨンサン・イチパパ・ツボツボ）',
  ],
};

// ============================================================
// 状態
// ============================================================
let _presetDrag = null; // プリセット項目ドラッグ状態 { routineId, fromIdx }

const State = {
  routines:          [],
  today:             '',   // 表示中の左列の日付
  tomorrow:          '',   // 表示中の右列の日付
  actualToday:       '',   // 実際の今日（変わらない基準値）
  dateOffset:        0,    // 0=今日/明日, -1=昨日/今日, ...
  todayTimeline:     [],  // [{itemType, itemId, timeSlot, title, score}]
  tomorrowTimeline:  [],
  todayCalEvents:    [],
  tomorrowCalEvents: [],
  dragging:          null,
  editRoutineId:     null,
  panelTab:          'routine',  // 'routine' | 'onetime'
  routineSelections: {},         // { [routineId]: selectedIndex }
};

// ============================================================
// ユーティリティ
// ============================================================
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// dateStr から n 日後（負なら過去）の日付文字列を返す
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 左列ラベル：今日基準なら「今日」、前後なら日付
function colLabel(dateStr, actualToday) {
  const diff = Math.round((new Date(dateStr + 'T00:00:00') - new Date(actualToday + 'T00:00:00')) / 86400000);
  if (diff === 0) return '今日 ' + formatDateJP(dateStr);
  if (diff === 1) return '明日 ' + formatDateJP(dateStr);
  if (diff === -1) return '昨日 ' + formatDateJP(dateStr);
  return (diff < 0 ? `${Math.abs(diff)}日前 ` : `${diff}日後 `) + formatDateJP(dateStr);
}

function formatDateJP(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}/${d.getDate()}（${days[d.getDay()]}）`;
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className = 'toast ' + type;
  toast.classList.remove('hidden');
  clearTimeout(showToast._timer);
  const duration = type === 'error' ? 8000 : 3000;
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), duration);
}

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  document.getElementById(id).classList.add('active');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  document.getElementById(id).classList.remove('active');
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadPresets() {
  const stored = Store.get(CONFIG.LS.PRESETS);
  if (stored) {
    try { return JSON.parse(stored); } catch {}
  }
  return JSON.parse(JSON.stringify(DEFAULT_PRESETS));
}

function savePresets(presets) {
  Store.set(CONFIG.LS.PRESETS, JSON.stringify(presets));
}

function getRoutineIcon(routineId) {
  const r = State.routines.find(r => r.id === routineId);
  if (!r) return '📌';
  const cat = CATEGORIES.find(c => c.key === r.category);
  return cat ? cat.icon : '📌';
}

// カレンダーの時刻を 30 分単位スロットに丸める
function roundToSlot(timeStr) {
  if (!timeStr || timeStr === '終日') return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (isNaN(h) || h < 5 || h > 21) return null;
  const roundedM = m >= 30 ? 30 : 0;
  const slot = String(h).padStart(2, '0') + ':' + String(roundedM).padStart(2, '0');
  return TIME_SLOTS.includes(slot) ? slot : null;
}

// ============================================================
// Google Identity Services のロード待ち
// ============================================================
function waitForGoogle(callback) {
  if (typeof google !== 'undefined' && google.accounts) {
    callback();
  } else {
    setTimeout(() => waitForGoogle(callback), 100);
  }
}

// ============================================================
// セットアップ画面
// ============================================================
function initSetup() {
  document.getElementById('showClientIdHelp').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('clientIdHelp').classList.toggle('hidden');
  });

  // Step 1 → Step 2
  document.getElementById('btnStep1Next').addEventListener('click', () => {
    const clientId = document.getElementById('inputClientId').value.trim();
    if (!clientId) { showToast('Client IDを入力してください', 'error'); return; }
    Store.set(CONFIG.LS.CLIENT_ID, clientId);
    waitForGoogle(() => {
      Auth.init();
      showStep('step2');
    });
  });

  // Step 2: Google サインイン
  document.getElementById('btnGoogleSignIn').addEventListener('click', () => {
    Auth.signIn(
      async (res) => {
        try {
          const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': 'Bearer ' + res.access_token },
          }).then(r => r.json());
          Store.set(CONFIG.LS.USER_NAME,  info.name  || '');
          Store.set(CONFIG.LS.USER_EMAIL, info.email || '');
        } catch {}
        document.getElementById('authStatus').classList.remove('hidden');
        document.getElementById('btnStep2Next').classList.remove('hidden');
      },
      (err) => showToast('認証エラー: ' + err, 'error'),
    );
  });

  document.getElementById('btnStep2Next').addEventListener('click', () => showStep('step3'));

  // Step 3: スプレッドシート作成 or 入力
  document.getElementById('btnCreateSheet').addEventListener('click', async () => {
    const btn = document.getElementById('btnCreateSheet');
    btn.textContent = '作成中...';
    btn.disabled = true;
    try {
      const sheetId = await Sheets.createNewSheet('Daily Tracker データ');
      Store.set(CONFIG.LS.SHEET_ID, sheetId);
      const status = document.getElementById('sheetStatus');
      status.textContent = '✅ 作成完了！ID: ' + sheetId;
      status.className = 'sheet-status success';
      status.classList.remove('hidden');
      document.getElementById('btnStep3Next').classList.remove('hidden');
    } catch (e) {
      showToast(e.message, 'error');
    } finally {
      btn.textContent = '📊 新規スプレッドシートを自動作成';
      btn.disabled = false;
    }
  });

  document.getElementById('inputSheetId').addEventListener('input', () => {
    const val = document.getElementById('inputSheetId').value.trim();
    document.getElementById('btnStep3Next').classList.toggle('hidden', !val);
  });

  // Step 3 完了 → アプリ起動
  document.getElementById('btnStep3Next').addEventListener('click', async () => {
    const inputId = document.getElementById('inputSheetId').value.trim();
    if (inputId) Store.set(CONFIG.LS.SHEET_ID, inputId);
    const sheetId = Store.get(CONFIG.LS.SHEET_ID);
    if (!sheetId) { showToast('スプレッドシートIDが未設定です', 'error'); return; }
    Sheets.init(sheetId);
    try {
      await Sheets.setupSheets();
    } catch (e) {
      showToast(e.message, 'error'); return;
    }
    Store.set(CONFIG.LS.SETUP_DONE, '1');
    launchApp();
  });
}

function showStep(stepId) {
  document.querySelectorAll('.setup-step').forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('active');
  });
  const target = document.getElementById(stepId);
  target.classList.remove('hidden');
  target.classList.add('active');
}

// ============================================================
// アプリ起動
// ============================================================
async function launchApp() {
  document.getElementById('setupModal').classList.add('hidden');
  document.getElementById('setupModal').classList.remove('active');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('app').classList.add('active');

  const name = Store.get(CONFIG.LS.USER_NAME) || 'ユーザー';
  document.getElementById('userName').textContent   = name;
  document.getElementById('userAvatar').textContent = name[0] || 'U';

  State.actualToday = todayStr();
  State.dateOffset  = 0;
  State.today    = State.actualToday;
  State.tomorrow = tomorrowStr();

  loadMemo();
  renderAll();

  Sheets.init(Store.get(CONFIG.LS.SHEET_ID));

  // サイレント再認証を試みる（Googleにログイン済みならポップアップなしで成功）
  if (Auth.isExpired()) {
    try {
      await Auth.silentSignIn();
    } catch (_) {
      // サイレント失敗 → 手動ボタンを促す
      showToast('右下の🔄ボタンを押してGoogleにサインインしてください', 'error');
      return;
    }
  }

  try {
    await Sheets.ensureTimelineSheet();
    await loadAll();
  } catch (e) {
    showToast('読み込みエラー。右下の🔄ボタンを押してください', 'error');
  }
}

// ============================================================
// デフォルトルーティン初期化（初回のみ）
// ============================================================
async function initDefaultRoutines() {
  const defaults = [
    { name: 'ジナンの価値を上げる',       category: 'ジナンの価値を上げる',
      items: ['アウトプット', 'おすすめ整理（店・本・動画）', 'AIファイルの整理'] },
    { name: '健康・片付け',               category: '健康・片付け',
      items: ['運動', 'パートナー', '部屋の片付け'] },
    { name: 'チーム関係（YouTube・運営）', category: 'チーム関係（YouTube・運営）',
      items: ['企画シート', 'ざわつかせた地図', 'ジナン業務'] },
    { name: '投資・お金',                 category: '投資・お金',
      items: ['確定申告', '個人簿記', '法人簿記', '銀行整理'] },
    { name: 'やるべきリスト',             category: 'やるべきリスト',
      items: ['船舶免許の住所変更', '山手皮膚科の予約', 'クレカ更新（エニタイム・Zoom）',
              'ミニミニに確認（太陽光）', '太陽光発電の会社に連絡', 'Google / YouTube住所変更',
              'プルデンシャル解約', '火災保険の継続→切替', 'デスク購入', 'iPhone購入',
              '電子レンジ購入', 'ベッド購入', '人に会う（ヨンサン・イチパパ・ツボツボ）'] },
  ];
  const p = loadPresets();
  defaults.forEach((d, i) => {
    const id = genId();
    State.routines.push({ id, name: d.name, category: d.category, duration: '', active: true, order: i, onetime: false });
    p[id] = d.items;
  });
  savePresets(p);
  await Sheets.saveAllRoutines(State.routines);
}

// ============================================================
// データ読み込み
// ============================================================
async function loadAll() {
  // トークンが期限切れの場合は再認証してから進む（🔄ボタン経由なのでポップアップOK）
  if (Auth.isExpired()) {
    try {
      await Auth.getToken();
    } catch (e) {
      showToast('認証に失敗しました。もう一度🔄を押してください', 'error');
      return;
    }
  }

  try {
    const [routines, todayTl, tomorrowTl] = await Promise.all([
      Sheets.getRoutines(),
      Sheets.getTimeline(State.today),
      Sheets.getTimeline(State.tomorrow),
    ]);

    State.routines        = routines;
    State.todayTimeline   = todayTl;
    State.tomorrowTimeline = tomorrowTl;

    // v3マイグレーション（フラグがなければ必ず1回実行）
    if (!Store.get('dt_migrated_v3')) {
      State.routines = State.routines.filter(r => r.onetime);
      await initDefaultRoutines();
      // タイムラインをカレンダー以外クリア
      State.todayTimeline    = State.todayTimeline.filter(i => i.itemType === 'calendar');
      State.tomorrowTimeline = State.tomorrowTimeline.filter(i => i.itemType === 'calendar');
      await Promise.all([
        Sheets.saveTimeline(State.today,    State.todayTimeline),
        Sheets.saveTimeline(State.tomorrow, State.tomorrowTimeline),
      ]).catch(() => {});
      Store.set('dt_migrated_v3', '1');
    }

    // 存在しないルーティンIDのタイムライン項目を削除（安全策）
    const validIds = new Set(State.routines.map(r => r.id));
    const cleanTimeline = tl => tl.filter(i => i.itemType !== 'routine' || validIds.has(i.itemId));
    const todayCleaned    = State.todayTimeline.some(i => i.itemType === 'routine' && !validIds.has(i.itemId));
    const tomorrowCleaned = State.tomorrowTimeline.some(i => i.itemType === 'routine' && !validIds.has(i.itemId));
    State.todayTimeline    = cleanTimeline(State.todayTimeline);
    State.tomorrowTimeline = cleanTimeline(State.tomorrowTimeline);
    if (todayCleaned)    await Sheets.saveTimeline(State.today,    State.todayTimeline).catch(() => {});
    if (tomorrowCleaned) await Sheets.saveTimeline(State.tomorrow, State.tomorrowTimeline).catch(() => {});

    // カレンダーを自動取得（失敗しても続行）
    try {
      const [todayCal, tomorrowCal] = await Promise.all([
        Calendar.getEvents(State.today),
        Calendar.getEvents(State.tomorrow),
      ]);
      State.todayCalEvents    = todayCal;
      State.tomorrowCalEvents = tomorrowCal;
      mergeCalEvents(State.todayTimeline,    todayCal);
      mergeCalEvents(State.tomorrowTimeline, tomorrowCal);
    } catch (calErr) {
      console.warn('カレンダー取得エラー:', calErr);
      showToast('カレンダー取得失敗: ' + calErr.message, 'error');
    }

    renderAll();
    showToast('読み込み完了 ✅');
  } catch (e) {
    renderAll();
    showToast('読み込みエラー: ' + e.message + ' — 同期ボタン🔄で再試行', 'error');
  }
}

// ============================================================
// 日付ナビゲーション（← → ボタン）
// ============================================================
async function navigateDates(delta) {
  State.dateOffset  += delta;
  State.today    = addDays(State.actualToday, State.dateOffset);
  State.tomorrow = addDays(State.actualToday, State.dateOffset + 1);

  // 表示だけ先に更新
  State.todayTimeline    = [];
  State.tomorrowTimeline = [];
  renderAll();

  // データを再取得
  try {
    const [todayTl, tomorrowTl] = await Promise.all([
      Sheets.getTimeline(State.today),
      Sheets.getTimeline(State.tomorrow),
    ]);
    State.todayTimeline    = todayTl;
    State.tomorrowTimeline = tomorrowTl;

    // カレンダーも再取得（失敗しても続行）
    try {
      const [todayCal, tomorrowCal] = await Promise.all([
        Calendar.getEvents(State.today),
        Calendar.getEvents(State.tomorrow),
      ]);
      State.todayCalEvents    = todayCal;
      State.tomorrowCalEvents = tomorrowCal;
      mergeCalEvents(State.todayTimeline,    todayCal);
      mergeCalEvents(State.tomorrowTimeline, tomorrowCal);
    } catch (_) {}

    renderAll();
  } catch (e) {
    showToast('読み込みエラー: ' + e.message, 'error');
  }
}

// カレンダーイベントをタイムラインへ自動配置（未配置のものだけ）
function mergeCalEvents(timeline, calEvents) {
  const existingIds = timeline
    .filter(item => item.itemType === 'calendar')
    .map(item => item.itemId);

  for (const event of calEvents) {
    if (existingIds.includes(event.id)) continue;
    const slot = roundToSlot(event.time);
    if (!slot) continue;
    timeline.push({ itemType: 'calendar', itemId: event.id, timeSlot: slot, title: event.title });
  }
}

// ============================================================
// レンダリング
// ============================================================
function renderAll() {
  renderRoutinesPanel();
  renderTimeline('todayTimeline',    State.todayTimeline,    State.today);
  renderTimeline('tomorrowTimeline', State.tomorrowTimeline, State.tomorrow);
  renderRoutineSettings();
}

// ============================================================
// 左パネル レンダリング
// ============================================================
function renderRoutinesPanel() {
  document.querySelectorAll('.panel-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === State.panelTab);
  });
  document.getElementById('btnAddRoutinePanel').classList.toggle('hidden', State.panelTab !== 'routine');
  document.getElementById('btnAddOnetimePanel').classList.toggle('hidden', State.panelTab !== 'onetime');

  const container = document.getElementById('routinesPanel');

  // 単発タブ: 従来通り
  if (State.panelTab === 'onetime') {
    const items = State.routines.filter(r => r.onetime);
    if (items.length === 0) {
      container.innerHTML = '<div class="empty-state">単発タスクを追加してください</div>';
      return;
    }
    container.innerHTML = items.map(r => {
      const safeTitle = r.name.replace(/"/g, '&quot;');
      return `
        <div class="routine-card onetime-card" draggable="true"
             data-type="onetime" data-id="${r.id}"
             data-slot="unplaced" data-date="unplaced"
             data-title="${safeTitle}">
          <span class="routine-card-icon">⚡</span>
          <span class="routine-card-name">${r.name}</span>
        </div>`;
    }).join('');
    container.querySelectorAll('.routine-card').forEach(el => {
      el.addEventListener('dragstart', onItemDragStart);
      el.addEventListener('dragend',   onItemDragEnd);
      el.addEventListener('dragover',  onPanelCardDragOver);
      el.addEventListener('dragleave', onPanelCardDragLeave);
      el.addEventListener('drop',      onPanelCardDrop);
    });
    return;
  }

  // ルーティンタブ: 5つの固定カード（プルダウン付き）
  const routines = State.routines.filter(r => r.active && !r.onetime);
  if (routines.length === 0) {
    container.innerHTML = '<div class="empty-state">ルーティン設定からルーティンを追加してください</div>';
    return;
  }

  const presets = loadPresets();
  container.innerHTML = routines.map(r => {
    const icon    = CATEGORIES.find(c => c.key === r.category)?.icon || '📌';
    const items   = presets[r.id] || [];
    const currentIdx = State.routineSelections[r.id] ?? 0;
    const options = items.length > 0
      ? items.map((item, idx) => `<option value="${item.replace(/"/g, '&quot;')}" ${idx === currentIdx ? 'selected' : ''}>${item}</option>`).join('')
      : '<option value="">（項目なし）</option>';
    return `
      <div class="routine-card routine-card-v2" draggable="true"
           data-type="routine" data-id="${r.id}"
           data-slot="unplaced" data-date="unplaced">
        <div class="routine-card-top">
          <span class="routine-card-icon">${icon}</span>
          <span class="routine-card-name">${r.name}</span>
        </div>
        <select class="routine-card-select">${options}</select>
      </div>`;
  }).join('');

  container.querySelectorAll('.routine-card-v2').forEach(el => {
    el.addEventListener('dragstart', onRoutineV2DragStart);
    el.addEventListener('dragend',   onItemDragEnd);
    el.addEventListener('dragover',  onPanelCardDragOver);
    el.addEventListener('dragleave', onPanelCardDragLeave);
    el.addEventListener('drop',      onPanelCardDrop);
    // selectをクリックしてもドラッグが始まらないように
    el.querySelector('.routine-card-select').addEventListener('mousedown', e => e.stopPropagation());
  });
}

function onRoutineV2DragStart(e) {
  const el     = e.currentTarget;
  const select = el.querySelector('.routine-card-select');
  const title  = select ? select.value.trim() : '';
  if (!title) {
    e.preventDefault();
    showToast('プルダウンで項目を選んでからドラッグしてください', 'error');
    return;
  }
  State.dragging = {
    itemType: 'routine',
    itemId:   el.dataset.id,
    title,
    fromSlot: 'unplaced',
    fromDate: 'unplaced',
  };
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => el.classList.add('dragging'), 0);
}

// 日別合計点を計算
function calcDayScore(timeline) {
  return timeline.reduce((sum, item) => {
    return sum + (item.score !== null && item.score !== undefined ? item.score : 0);
  }, 0);
}

function renderTimeline(containerId, timeline, date) {
  const container = document.getElementById(containerId);

  // ヘッダーラベルと合計点を更新
  const labelId = containerId === 'todayTimeline' ? 'todayLabel' : 'tomorrowLabel';
  const totalScore = calcDayScore(timeline);
  const scoredItems = timeline.filter(i => i.score !== null && i.score !== undefined);
  const scoreText = scoredItems.length > 0 ? `　${totalScore}点` : '';
  document.getElementById(labelId).innerHTML =
    `${colLabel(date, State.actualToday)}<span class="header-score">${scoreText}</span>`;

  // ナビバーの日付範囲テキストを更新（左列のときだけ）
  if (containerId === 'todayTimeline') {
    const tomorrowLabel = colLabel(State.tomorrow, State.actualToday).split(' ')[0];
    document.getElementById('dateNavRange').textContent =
      `${formatDateJP(State.today)} 〜 ${formatDateJP(State.tomorrow)}`;
  }

  // 過去の日付は読み取り専用（actualToday より前）
  const isPast = date < State.actualToday;
  const colBody = container.parentElement;
  colBody.classList.toggle('tl-readonly', isPast);

  container.innerHTML = TIME_SLOTS.map(slot => {
    const isHour = slot.endsWith(':00');
    const items  = timeline.filter(item => item.timeSlot === slot);
    const itemsHtml = items.map(item => renderTlItem(item, date)).join('');

    return `
      <div class="tl-slot ${isHour ? 'tl-hour' : ''}">
        <div class="tl-time">${slot}</div>
        <div class="tl-zone" data-time="${slot}" data-date="${date}">
          ${itemsHtml}
          <button class="tl-add-btn" data-slot="${slot}" data-date="${date}" title="手動タスクを追加">＋</button>
        </div>
      </div>`;
  }).join('');

  if (!isPast) {
    container.querySelectorAll('.tl-zone').forEach(zone => {
      zone.addEventListener('dragover',  onSlotDragOver);
      zone.addEventListener('dragleave', onSlotDragLeave);
      zone.addEventListener('drop',      onSlotDrop);
    });
  }

  container.querySelectorAll('.tl-item').forEach(el => {
    if (!isPast) {
      el.addEventListener('dragstart', onItemDragStart);
      el.addEventListener('dragend',   onItemDragEnd);
    } else {
      el.setAttribute('draggable', 'false');
    }
    el.addEventListener('click', e => {
      if (isPast) return;
      if (e.target.closest('.tl-item-remove')) return;
      if (e.target.closest('.tl-item-select')) return;
      e.stopPropagation();
      openScorePicker(el.dataset.id, el.dataset.slot, el.dataset.date, el);
    });
  });

  if (!isPast) {
    container.querySelectorAll('.tl-item-select').forEach(sel => {
      sel.addEventListener('mousedown', e => e.stopPropagation());
      sel.addEventListener('click',     e => e.stopPropagation());
      sel.addEventListener('change', e => {
        e.stopPropagation();
        const tl = sel.dataset.date === State.today ? State.todayTimeline : State.tomorrowTimeline;
        const item = tl.find(i => i.itemId === sel.dataset.id && i.timeSlot === sel.dataset.slot);
        if (item) {
          item.title = sel.value;
          sel.closest('.tl-item').dataset.title = sel.value;
          scheduleSave(sel.dataset.date);
        }
      });
    });

    container.querySelectorAll('.tl-item-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        removeTimelineItem(btn.dataset.id, btn.dataset.slot, btn.dataset.date);
      });
    });

    container.querySelectorAll('.tl-add-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        openManualTaskModal(btn.dataset.slot, btn.dataset.date);
      });
    });
  }
}

function renderTlItem(item, date) {
  let icon, cls;
  if (item.itemType === 'calendar') {
    icon = '📅'; cls = 'tl-calendar';
  } else if (item.itemType === 'manual') {
    icon = '✏️'; cls = 'tl-manual';
  } else if (item.itemType === 'onetime') {
    icon = '⚡'; cls = 'tl-onetime';
  } else {
    icon = getRoutineIcon(item.itemId); cls = 'tl-routine';
  }
  const safe = item.title.replace(/"/g, '&quot;');
  const scoreLabel = item.score !== null && item.score !== undefined
    ? `<span class="tl-score-badge">${item.score}点</span>`
    : `<span class="tl-score-badge empty">採点</span>`;

  let titleHtml;
  if (item.itemType === 'routine') {
    const routineItems = (loadPresets()[item.itemId]) || [];
    if (routineItems.length > 0) {
      const opts = routineItems.map(i =>
        `<option value="${i.replace(/"/g, '&quot;')}" ${i === item.title ? 'selected' : ''}>${i}</option>`
      ).join('');
      titleHtml = `<select class="tl-item-select" data-id="${item.itemId}" data-slot="${item.timeSlot}" data-date="${date}">${opts}</select>`;
    } else {
      titleHtml = `<span class="tl-item-name">${item.title}</span>`;
    }
  } else {
    titleHtml = `<span class="tl-item-name">${item.title}</span>`;
  }

  return `
    <div class="tl-item ${cls}" draggable="true"
         data-type="${item.itemType}" data-id="${item.itemId}"
         data-slot="${item.timeSlot}" data-date="${date}"
         data-title="${safe}">
      <span class="tl-item-icon">${icon}</span>
      ${titleHtml}
      ${scoreLabel}
      <button class="tl-item-remove"
              data-id="${item.itemId}" data-slot="${item.timeSlot}" data-date="${date}">✕</button>
    </div>`;
}

// ============================================================
// タイムラインアイテム削除（パネルへ戻す）
// ============================================================
function removeTimelineItem(itemId, slot, date) {
  const tl  = date === State.today ? State.todayTimeline : State.tomorrowTimeline;
  const idx = tl.findIndex(item => item.itemId === itemId && item.timeSlot === slot);
  if (idx !== -1) tl.splice(idx, 1);
  renderAll();
  scheduleSave(date);
}

// ============================================================
// ドラッグ & ドロップ
// ============================================================
function onItemDragStart(e) {
  const el = e.currentTarget;
  State.dragging = {
    itemType: el.dataset.type,
    itemId:   el.dataset.id,
    title:    el.dataset.title,
    fromSlot: el.dataset.slot,
    fromDate: el.dataset.date,
  };
  e.dataTransfer.effectAllowed = 'move';
  setTimeout(() => el.classList.add('dragging'), 0);
}

function onItemDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
}

function onSlotDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  e.currentTarget.classList.add('drag-over');
}

function onSlotDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onSlotDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (!State.dragging) return;

  const toSlot = e.currentTarget.dataset.time;
  const toDate = e.currentTarget.dataset.date;
  const { itemType, itemId, title, fromSlot, fromDate } = State.dragging;

  // 元の位置から削除
  if (fromDate !== 'unplaced') {
    const tl  = fromDate === State.today ? State.todayTimeline : State.tomorrowTimeline;
    const idx = tl.findIndex(item => item.itemId === itemId && item.timeSlot === fromSlot);
    if (idx !== -1) tl.splice(idx, 1);
  }

  // 新しい位置に追加
  const targetTl = toDate === State.today ? State.todayTimeline : State.tomorrowTimeline;
  targetTl.push({ itemType, itemId, timeSlot: toSlot, title, score: null });

  // ルーティンパネルからのドロップなら選択を次の項目へ進める
  if (fromDate === 'unplaced' && itemType === 'routine') {
    const presets = loadPresets();
    const items = presets[itemId] || [];
    if (items.length > 0) {
      const currentIdx = State.routineSelections[itemId] ?? 0;
      State.routineSelections[itemId] = (currentIdx + 1) % items.length;
    }
  }

  // 単発タスクはパネルから削除
  if (fromDate === 'unplaced' && itemType === 'onetime') {
    State.routines = State.routines.filter(r => r.id !== itemId);
    Sheets.saveAllRoutines(State.routines).catch(() => {});
  }

  State.dragging = null;
  renderAll();
  scheduleSave(toDate);
  if (fromDate !== 'unplaced' && fromDate !== toDate) scheduleSave(fromDate);
}

// ルーティンパネルへのドロップ（タイムラインから削除）
function onPanelDrop(e) {
  e.preventDefault();
  document.getElementById('routinesPanelWrap').classList.remove('drag-over');
  if (!State.dragging) return;

  const { itemId, fromSlot, fromDate } = State.dragging;
  if (fromDate !== 'unplaced') {
    const tl  = fromDate === State.today ? State.todayTimeline : State.tomorrowTimeline;
    const idx = tl.findIndex(item => item.itemId === itemId && item.timeSlot === fromSlot);
    if (idx !== -1) tl.splice(idx, 1);
    renderAll();
    scheduleSave(fromDate);
  }
  State.dragging = null;
}

// ============================================================
// パネルカード内ドラッグ並び替え
// ============================================================
function onPanelCardDragOver(e) {
  // パネルアイテム同士の並び替えのみ処理
  if (!State.dragging || State.dragging.fromDate !== 'unplaced') return;
  e.preventDefault();
  e.stopPropagation(); // パネルコンテナへの伝播を防ぐ
  e.currentTarget.classList.add('drag-reorder');
}

function onPanelCardDragLeave(e) {
  e.currentTarget.classList.remove('drag-reorder');
}

function onPanelCardDrop(e) {
  e.currentTarget.classList.remove('drag-reorder');
  if (!State.dragging || State.dragging.fromDate !== 'unplaced') return;
  e.preventDefault();
  e.stopPropagation();

  const dragId   = State.dragging.itemId;
  const targetId = e.currentTarget.dataset.id;
  if (!dragId || !targetId || dragId === targetId) return;

  const dragIdx   = State.routines.findIndex(r => r.id === dragId);
  const targetIdx = State.routines.findIndex(r => r.id === targetId);
  if (dragIdx === -1 || targetIdx === -1) return;

  const [moved] = State.routines.splice(dragIdx, 1);
  State.routines.splice(targetIdx, 0, moved);
  State.routines.forEach((r, i) => { r.order = i; });

  State.dragging = null;
  renderAll();
  Sheets.saveAllRoutines(State.routines).catch(() => showToast('並び順の保存に失敗しました', 'error'));
}

// ============================================================
// 保存（デバウンス: 1.5秒後）
// ============================================================
const _saveTimers = {};

function scheduleSave(date) {
  if (_saveTimers[date]) clearTimeout(_saveTimers[date]);
  _saveTimers[date] = setTimeout(async () => {
    const tl = date === State.today ? State.todayTimeline : State.tomorrowTimeline;
    try {
      await Sheets.saveTimeline(date, tl);
    } catch {
      showToast('保存に失敗しました', 'error');
    }
  }, 1500);
}

// ============================================================
// スコアピッカー
// ============================================================
function openScorePicker(itemId, slot, date, anchorEl) {
  // 既存のピッカーを閉じる
  closeScorePicker();

  const tl  = date === State.today ? State.todayTimeline : State.tomorrowTimeline;
  const item = tl.find(i => i.itemId === itemId && i.timeSlot === slot);
  if (!item) return;

  const picker = document.createElement('div');
  picker.id = 'scorePicker';
  picker.className = 'score-picker';
  picker.innerHTML = `
    <div class="score-picker-label">点数を選択（0〜5点）</div>
    <div class="score-picker-btns">
      ${[0,1,2,3,4,5].map(n => `
        <button class="score-btn ${item.score === n ? 'selected' : ''}" data-score="${n}">${n}</button>
      `).join('')}
    </div>
  `;

  picker.querySelectorAll('.score-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const score = parseInt(btn.dataset.score, 10);
      item.score = score;
      renderAll();
      scheduleSave(date);
      closeScorePicker();
    });
  });

  // アンカー要素の直下に配置
  const rect = anchorEl.getBoundingClientRect();
  picker.style.position = 'fixed';
  picker.style.top  = (rect.bottom + 4) + 'px';
  picker.style.left = rect.left + 'px';
  document.body.appendChild(picker);

  // 画面外にはみ出す場合は上に出す
  const pr = picker.getBoundingClientRect();
  if (pr.bottom > window.innerHeight - 8) {
    picker.style.top = (rect.top - pr.height - 4) + 'px';
  }

  // 外クリックで閉じる
  setTimeout(() => document.addEventListener('click', closeScorePicker, { once: true }), 0);
}

function closeScorePicker() {
  const el = document.getElementById('scorePicker');
  if (el) el.remove();
}

// ============================================================
// 手動タスクモーダル
// ============================================================
function openManualTaskModal(slot, date) {
  document.getElementById('manualTaskSlot').value  = slot;
  document.getElementById('manualTaskDate').value  = date;
  document.getElementById('manualTaskTitle').value = '';
  const label = date === State.today
    ? `今日 ${formatDateJP(State.today)} ${slot}`
    : `明日 ${formatDateJP(State.tomorrow)} ${slot}`;
  document.getElementById('manualTaskSlotLabel').textContent = label;
  openModal('manualTaskModal');
  setTimeout(() => document.getElementById('manualTaskTitle').focus(), 50);
}

function addManualTask() {
  const title = document.getElementById('manualTaskTitle').value.trim();
  const slot  = document.getElementById('manualTaskSlot').value;
  const date  = document.getElementById('manualTaskDate').value;
  if (!title) { showToast('タスク名を入力してください', 'error'); return; }

  const id = 'manual_' + genId();
  const tl = date === State.today ? State.todayTimeline : State.tomorrowTimeline;
  tl.push({ itemType: 'manual', itemId: id, timeSlot: slot, title, score: null });

  closeModal('manualTaskModal');
  renderAll();
  scheduleSave(date);
}

// ============================================================
// ルーティン設定ビュー（プリセット管理込み）
// ============================================================
function renderRoutineSettings() {
  const container = document.getElementById('routineSettings');
  const routines  = State.routines.filter(r => !r.onetime);
  if (routines.length === 0) {
    container.innerHTML = '<div class="empty-state">まだルーティンがありません。上の「追加」ボタンから始めましょう！</div>';
    return;
  }

  const presets = loadPresets();
  container.innerHTML = routines.map(r => {
    const icon  = CATEGORIES.find(c => c.key === r.category)?.icon || '📌';
    const items = presets[r.id] || [];
    const tagsHtml = items.map((item, idx) => `
      <span class="preset-tag" draggable="true" data-routine-id="${r.id}" data-idx="${idx}">
        <span class="preset-tag-handle">⠿</span>
        ${item}
        <button class="preset-tag-del" data-id="${r.id}" data-idx="${idx}">✕</button>
      </span>`).join('');
    return `
      <div class="routine-setting-item ${r.active ? '' : 'inactive'}" data-id="${r.id}">
        <div class="routine-setting-header">
          <span class="routine-setting-icon">${icon}</span>
          <span class="routine-setting-name">${r.name}</span>
          <div class="routine-setting-actions">
            <label class="toggle-switch">
              <input type="checkbox" ${r.active ? 'checked' : ''} data-id="${r.id}" class="routine-toggle">
              <span class="toggle-slider"></span>
            </label>
            <button class="btn-edit"   data-id="${r.id}">編集</button>
            <button class="btn-delete" data-id="${r.id}">削除</button>
          </div>
        </div>
        <div class="preset-items">
          ${tagsHtml || '<span class="preset-empty">項目なし</span>'}
        </div>
        <div class="preset-add-row">
          <input type="text" class="form-input preset-add-input"
                 placeholder="項目を追加…" data-id="${r.id}">
          <button class="btn-secondary preset-add-btn" data-id="${r.id}">＋ 追加</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.routine-toggle').forEach(el => {
    el.addEventListener('change', () => toggleRoutineActive(el.dataset.id, el.checked));
  });
  container.querySelectorAll('.btn-edit').forEach(el => {
    el.addEventListener('click', () => openEditRoutine(el.dataset.id));
  });
  container.querySelectorAll('.btn-delete').forEach(el => {
    el.addEventListener('click', () => deleteRoutine(el.dataset.id));
  });
  container.querySelectorAll('.preset-tag-del').forEach(btn => {
    btn.addEventListener('click', () =>
      deletePresetItem(btn.dataset.id, parseInt(btn.dataset.idx, 10)));
  });
  container.querySelectorAll('.preset-add-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = container.querySelector(`.preset-add-input[data-id="${btn.dataset.id}"]`);
      if (input) addPresetItemById(btn.dataset.id, input.value.trim(), input);
    });
  });
  container.querySelectorAll('.preset-add-input').forEach(input => {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) addPresetItemById(input.dataset.id, input.value.trim(), input);
    });
  });

  // プリセットタグのドラッグ&ドロップ並び替え
  container.querySelectorAll('.preset-tag[draggable]').forEach(tag => {
    tag.addEventListener('dragstart', e => {
      e.stopPropagation();
      _presetDrag = { routineId: tag.dataset.routineId, fromIdx: parseInt(tag.dataset.idx, 10) };
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => tag.classList.add('preset-tag-dragging'), 0);
    });
    tag.addEventListener('dragend', () => {
      tag.classList.remove('preset-tag-dragging');
      _presetDrag = null;
    });
    tag.addEventListener('dragover', e => {
      if (!_presetDrag || _presetDrag.routineId !== tag.dataset.routineId) return;
      e.preventDefault();
      e.stopPropagation();
      tag.classList.add('preset-tag-over');
    });
    tag.addEventListener('dragleave', () => tag.classList.remove('preset-tag-over'));
    tag.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      tag.classList.remove('preset-tag-over');
      if (!_presetDrag) return;
      const toIdx = parseInt(tag.dataset.idx, 10);
      if (_presetDrag.fromIdx === toIdx) { _presetDrag = null; return; }
      const p = loadPresets();
      const items = p[_presetDrag.routineId];
      if (!items) { _presetDrag = null; return; }
      const [moved] = items.splice(_presetDrag.fromIdx, 1);
      items.splice(toIdx, 0, moved);
      savePresets(p);
      _presetDrag = null;
      renderRoutineSettings();
      renderRoutinesPanel();
    });
    // ✕ボタンがドラッグを誤発火させないように
    tag.querySelector('.preset-tag-del').addEventListener('mousedown', e => e.stopPropagation());
  });
}

function deletePresetItem(routineId, idx) {
  const p = loadPresets();
  if (!p[routineId]) return;
  p[routineId].splice(idx, 1);
  savePresets(p);
  renderRoutineSettings();
  renderRoutinesPanel();
}

function addPresetItemById(routineId, value, inputEl) {
  if (!value) return;
  const p = loadPresets();
  if (!p[routineId]) p[routineId] = [];
  p[routineId].push(value);
  savePresets(p);
  if (inputEl) inputEl.value = '';
  renderRoutineSettings();
  renderRoutinesPanel();
  showToast('項目を追加しました ✅');
}

async function toggleRoutineActive(routineId, active) {
  const r = State.routines.find(r => r.id === routineId);
  if (!r) return;
  r.active = active;
  renderAll();
  try { await Sheets.saveAllRoutines(State.routines); }
  catch { showToast('保存に失敗しました', 'error'); }
}

function openAddRoutine(isOnetime = false) {
  State.editRoutineId = null;
  document.getElementById('routineModalTitle').textContent = isOnetime ? '単発タスクを追加' : 'ルーティンを追加';
  document.getElementById('routineOnetimeFlag').value = isOnetime ? '1' : '0';
  document.getElementById('routineName').value     = '';
  document.getElementById('routineCategory').value = CATEGORIES[0].key;
  document.getElementById('routineCategoryGroup').style.display = isOnetime ? 'none' : '';
  openModal('routineModal');
  setTimeout(() => document.getElementById('routineName').focus(), 50);
}

function openEditRoutine(routineId) {
  const r = State.routines.find(r => r.id === routineId);
  if (!r) return;
  State.editRoutineId = routineId;
  document.getElementById('routineModalTitle').textContent = 'ルーティンを編集';
  document.getElementById('routineOnetimeFlag').value      = r.onetime ? '1' : '0';
  document.getElementById('routineName').value             = r.name;
  document.getElementById('routineCategory').value         = r.category || CATEGORIES[0].key;
  document.getElementById('routineCategoryGroup').style.display = r.onetime ? 'none' : '';
  openModal('routineModal');
  setTimeout(() => document.getElementById('routineName').focus(), 50);
}

async function saveRoutine() {
  const name      = document.getElementById('routineName').value.trim();
  const isOnetime = document.getElementById('routineOnetimeFlag').value === '1';
  const category  = isOnetime ? 'その他' : document.getElementById('routineCategory').value;
  if (!name) { showToast('名前を入力してください', 'error'); return; }

  if (State.editRoutineId) {
    const r = State.routines.find(r => r.id === State.editRoutineId);
    if (r) { r.name = name; r.category = category; }
  } else {
    State.routines.push({ id: genId(), name, category, duration: '', active: true, order: State.routines.length, onetime: isOnetime });
  }

  closeModal('routineModal');
  renderAll();
  try {
    await Sheets.saveAllRoutines(State.routines);
    showToast('保存しました ✅');
  } catch (e) {
    showToast('保存エラー: ' + e.message, 'error');
  }
}

async function deleteRoutine(routineId) {
  if (!confirm('このルーティンを削除しますか？')) return;
  State.routines = State.routines.filter(r => r.id !== routineId);
  renderAll();
  try {
    await Sheets.saveAllRoutines(State.routines);
    showToast('削除しました');
  } catch {
    showToast('削除に失敗しました', 'error');
  }
}

// ============================================================
// メモ
// ============================================================
function loadMemo() {
  const text = Store.get(CONFIG.LS.MEMO) || '';
  document.getElementById('memoTextarea').value = text;
  renderMemoDisplay(text);
}

function saveMemo() {
  const text = document.getElementById('memoTextarea').value;
  Store.set(CONFIG.LS.MEMO, text);
  renderMemoDisplay(text);
  setMemoEditMode(false);
}

function renderMemoDisplay(text) {
  const display = document.getElementById('memoDisplay');
  if (!text.trim()) {
    display.innerHTML = '<p class="memo-empty">メモはまだありません。「編集」ボタンで追加しましょう。</p>';
    return;
  }
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const linked = escaped.replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>',
  );
  display.innerHTML = linked.replace(/\n/g, '<br>');
}

function setMemoEditMode(editing) {
  document.getElementById('memoDisplay').classList.toggle('hidden', editing);
  document.getElementById('memoTextarea').classList.toggle('hidden', !editing);
  document.getElementById('btnMemoEdit').textContent = editing ? '保存' : '編集';
  if (editing) setTimeout(() => document.getElementById('memoTextarea').focus(), 50);
}

// ============================================================
// 設定モーダル
// ============================================================
function openSettings() {
  document.getElementById('settingsSheetId').value  = Store.get(CONFIG.LS.SHEET_ID)  || '';
  document.getElementById('settingsClientId').value = Store.get(CONFIG.LS.CLIENT_ID) || '';
  openModal('settingsModal');
}

function saveSettings() {
  const sheetId  = document.getElementById('settingsSheetId').value.trim();
  const clientId = document.getElementById('settingsClientId').value.trim();
  if (sheetId)  { Store.set(CONFIG.LS.SHEET_ID,  sheetId);  Sheets.init(sheetId); }
  if (clientId) { Store.set(CONFIG.LS.CLIENT_ID, clientId); Auth.init(); }
  closeModal('settingsModal');
  showToast('設定を保存しました ✅');
}

// ============================================================
// DOMContentLoaded
// ============================================================
document.addEventListener('DOMContentLoaded', () => {

  // セットアップ済みかチェック
  if (Store.get(CONFIG.LS.SETUP_DONE)) {
    waitForGoogle(() => {
      Auth.init();
      launchApp();
    });
  } else {
    initSetup();
  }

  // ナビゲーション
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => {
        v.classList.add('hidden');
        v.classList.remove('active');
      });
      el.classList.add('active');
      const view = document.getElementById(el.dataset.view + 'View');
      if (view) { view.classList.remove('hidden'); view.classList.add('active'); }
    });
  });

  // ルーティンパネルのドロップゾーン
  const panelWrap = document.getElementById('routinesPanelWrap');
  panelWrap.addEventListener('dragover',  e => { e.preventDefault(); panelWrap.classList.add('drag-over'); });
  panelWrap.addEventListener('dragleave', () => panelWrap.classList.remove('drag-over'));
  panelWrap.addEventListener('drop', onPanelDrop);

  // パネルタブ切り替え
  document.querySelectorAll('.panel-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      State.panelTab = btn.dataset.tab;
      renderRoutinesPanel();
    });
  });

  // ルーティン追加ボタン
  document.getElementById('btnAddRoutinePanel').addEventListener('click', () => openAddRoutine(false));
  document.getElementById('btnAddOnetimePanel').addEventListener('click', () => openAddRoutine(true));
  document.getElementById('btnAddRoutine').addEventListener('click', () => openAddRoutine(false));
  document.getElementById('btnCancelRoutine').addEventListener('click', () => closeModal('routineModal'));
  document.getElementById('btnSaveRoutine').addEventListener('click', saveRoutine);

  // 手動タスクモーダル
  document.getElementById('btnCancelManualTask').addEventListener('click', () => closeModal('manualTaskModal'));
  document.getElementById('btnSaveManualTask').addEventListener('click', addManualTask);
  document.getElementById('manualTaskTitle').addEventListener('keydown', e => {
    if (e.key === 'Enter') addManualTask();
  });

  // 設定
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnCancelSettings').addEventListener('click', () => closeModal('settingsModal'));
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
  document.getElementById('btnResetApp').addEventListener('click', () => {
    if (confirm('すべての設定をリセットしますか？')) { Store.clear(); location.reload(); }
  });

  // メモ
  document.getElementById('btnMemoEdit').addEventListener('click', () => {
    const isEditing = !document.getElementById('memoTextarea').classList.contains('hidden');
    if (isEditing) saveMemo();
    else setMemoEditMode(true);
  });

  // 同期
  document.getElementById('btnSync').addEventListener('click', loadAll);

  // 日付ナビゲーション（ボタン）
  document.getElementById('btnNavPrev').addEventListener('click', () => navigateDates(-1));
  document.getElementById('btnNavNext').addEventListener('click', () => navigateDates(+1));

  // 日付ナビゲーション（スワイプ）
  const swipeTarget = document.getElementById('timelineLayout');
  let swipeStartX = null;
  swipeTarget.addEventListener('touchstart', e => {
    swipeStartX = e.touches[0].clientX;
  }, { passive: true });
  swipeTarget.addEventListener('touchend', e => {
    if (swipeStartX === null) return;
    const dx = e.changedTouches[0].clientX - swipeStartX;
    swipeStartX = null;
    if (Math.abs(dx) < 50) return; // 50px未満は誤操作として無視
    navigateDates(dx < 0 ? 1 : -1); // 左スワイプ→次の日、右スワイプ→前の日
  }, { passive: true });

  // モーダルオーバーレイクリックで閉じる
  ['routineModal', 'settingsModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) closeModal(id);
    });
  });
});
