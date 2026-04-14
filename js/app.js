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

const CATEGORY_ICONS = {
  '健康': '🏃', '学習': '📚', 'メンタル': '🧘',
  '生活': '🏠', '仕事': '💼', 'その他': '✨',
};

// ============================================================
// 状態
// ============================================================
const State = {
  routines:          [],
  today:             '',
  tomorrow:          '',
  todayTimeline:     [],  // [{itemType, itemId, timeSlot, title}]
  tomorrowTimeline:  [],
  todayCalEvents:    [],
  tomorrowCalEvents: [],
  dragging:          null,
  editRoutineId:     null,
};

// ============================================================
// ユーティリティ
// ============================================================
function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function tomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
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
  showToast._timer = setTimeout(() => toast.classList.add('hidden'), 3000);
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

function getRoutineIcon(routineId) {
  const r = State.routines.find(r => r.id === routineId);
  return r ? (CATEGORY_ICONS[r.category] || '📌') : '📌';
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

  State.today    = todayStr();
  State.tomorrow = tomorrowStr();

  document.getElementById('todayLabel').textContent    = '今日 ' + formatDateJP(State.today);
  document.getElementById('tomorrowLabel').textContent = '明日 ' + formatDateJP(State.tomorrow);

  // データ読み込み前に空グリッドを先に表示する
  renderAll();

  Sheets.init(Store.get(CONFIG.LS.SHEET_ID));
  try {
    await Sheets.ensureTimelineSheet();
    await loadAll();
  } catch (e) {
    showToast('セッション期限切れ。右下の同期ボタン🔄を押してください', 'error');
  }
}

// ============================================================
// データ読み込み
// ============================================================
async function loadAll() {
  try {
    const [routines, todayTl, tomorrowTl] = await Promise.all([
      Sheets.getRoutines(),
      Sheets.getTimeline(State.today),
      Sheets.getTimeline(State.tomorrow),
    ]);

    State.routines        = routines;
    State.todayTimeline   = todayTl;
    State.tomorrowTimeline = tomorrowTl;

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
    } catch {}

    renderAll();
    showToast('読み込み完了 ✅');
  } catch (e) {
    renderAll();
    showToast('読み込みエラー: ' + e.message + ' — 同期ボタン🔄で再試行', 'error');
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

function renderRoutinesPanel() {
  const container = document.getElementById('routinesPanel');
  const active = State.routines.filter(r => r.active);

  if (active.length === 0) {
    container.innerHTML = '<div class="empty-state">ルーティンを追加してください</div>';
    return;
  }

  container.innerHTML = active.map(r => {
    const safeTitle = r.name.replace(/"/g, '&quot;');
    return `
      <div class="routine-card" draggable="true"
           data-type="routine" data-id="${r.id}"
           data-slot="unplaced" data-date="unplaced"
           data-title="${safeTitle}">
        <span class="routine-card-icon">${CATEGORY_ICONS[r.category] || '📌'}</span>
        <span class="routine-card-name">${r.name}</span>
        ${r.duration ? `<span class="routine-card-meta">${r.duration}</span>` : ''}
      </div>`;
  }).join('');

  container.querySelectorAll('.routine-card').forEach(el => {
    el.addEventListener('dragstart', onItemDragStart);
    el.addEventListener('dragend',   onItemDragEnd);
  });
}

function renderTimeline(containerId, timeline, date) {
  const container = document.getElementById(containerId);

  container.innerHTML = TIME_SLOTS.map(slot => {
    const isHour = slot.endsWith(':00');
    const items  = timeline.filter(item => item.timeSlot === slot);
    const itemsHtml = items.map(item => renderTlItem(item, date)).join('');

    return `
      <div class="tl-slot ${isHour ? 'tl-hour' : ''}">
        <div class="tl-time">${slot}</div>
        <div class="tl-zone" data-time="${slot}" data-date="${date}">${itemsHtml}</div>
      </div>`;
  }).join('');

  container.querySelectorAll('.tl-zone').forEach(zone => {
    zone.addEventListener('dragover',  onSlotDragOver);
    zone.addEventListener('dragleave', onSlotDragLeave);
    zone.addEventListener('drop',      onSlotDrop);
  });

  container.querySelectorAll('.tl-item').forEach(el => {
    el.addEventListener('dragstart', onItemDragStart);
    el.addEventListener('dragend',   onItemDragEnd);
  });

  container.querySelectorAll('.tl-item-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeTimelineItem(btn.dataset.id, btn.dataset.slot, btn.dataset.date);
    });
  });
}

function renderTlItem(item, date) {
  const icon = item.itemType === 'calendar' ? '📅' : getRoutineIcon(item.itemId);
  const cls  = item.itemType === 'calendar' ? 'tl-calendar' : 'tl-routine';
  const safe = item.title.replace(/"/g, '&quot;');

  return `
    <div class="tl-item ${cls}" draggable="true"
         data-type="${item.itemType}" data-id="${item.itemId}"
         data-slot="${item.timeSlot}" data-date="${date}"
         data-title="${safe}">
      <span class="tl-item-icon">${icon}</span>
      <span class="tl-item-name">${item.title}</span>
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
  targetTl.push({ itemType, itemId, timeSlot: toSlot, title });

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
// ルーティン設定ビュー
// ============================================================
function renderRoutineSettings() {
  const container = document.getElementById('routineSettings');
  if (State.routines.length === 0) {
    container.innerHTML = '<div class="empty-state">まだルーティンがありません</div>';
    return;
  }

  container.innerHTML = State.routines.map(r => `
    <div class="routine-setting-item ${r.active ? '' : 'inactive'}" data-id="${r.id}">
      <span class="drag-handle">⠿</span>
      <div class="routine-setting-info">
        <div class="routine-setting-name">${r.name}</div>
        <div class="routine-setting-meta">${r.category}${r.duration ? ' · ' + r.duration : ''}</div>
      </div>
      <div class="routine-setting-actions">
        <label class="toggle-switch">
          <input type="checkbox" ${r.active ? 'checked' : ''} data-id="${r.id}" class="routine-toggle">
          <span class="toggle-slider"></span>
        </label>
        <button class="btn-edit"   data-id="${r.id}">編集</button>
        <button class="btn-delete" data-id="${r.id}">削除</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.routine-toggle').forEach(el => {
    el.addEventListener('change', () => toggleRoutineActive(el.dataset.id, el.checked));
  });
  container.querySelectorAll('.btn-edit').forEach(el => {
    el.addEventListener('click', () => openEditRoutine(el.dataset.id));
  });
  container.querySelectorAll('.btn-delete').forEach(el => {
    el.addEventListener('click', () => deleteRoutine(el.dataset.id));
  });
}

async function toggleRoutineActive(routineId, active) {
  const r = State.routines.find(r => r.id === routineId);
  if (!r) return;
  r.active = active;
  renderAll();
  try { await Sheets.saveAllRoutines(State.routines); }
  catch { showToast('保存に失敗しました', 'error'); }
}

function openAddRoutine() {
  State.editRoutineId = null;
  document.getElementById('routineModalTitle').textContent = 'ルーティンを追加';
  document.getElementById('routineName').value     = '';
  document.getElementById('routineCategory').value = '健康';
  document.getElementById('routineDuration').value = '';
  openModal('routineModal');
}

function openEditRoutine(routineId) {
  const r = State.routines.find(r => r.id === routineId);
  if (!r) return;
  State.editRoutineId = routineId;
  document.getElementById('routineModalTitle').textContent = 'ルーティンを編集';
  document.getElementById('routineName').value     = r.name;
  document.getElementById('routineCategory').value = r.category;
  document.getElementById('routineDuration').value = r.duration;
  openModal('routineModal');
}

async function saveRoutine() {
  const name     = document.getElementById('routineName').value.trim();
  const category = document.getElementById('routineCategory').value;
  const duration = document.getElementById('routineDuration').value.trim();
  if (!name) { showToast('名前を入力してください', 'error'); return; }

  if (State.editRoutineId) {
    const r = State.routines.find(r => r.id === State.editRoutineId);
    if (r) { r.name = name; r.category = category; r.duration = duration; }
  } else {
    State.routines.push({ id: genId(), name, category, duration, active: true, order: State.routines.length });
  }

  closeModal('routineModal');
  renderAll();
  try {
    await Sheets.saveAllRoutines(State.routines);
    showToast('ルーティンを保存しました ✅');
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

  // ルーティン追加ボタン
  document.getElementById('btnAddRoutinePanel').addEventListener('click', openAddRoutine);
  document.getElementById('btnAddRoutine').addEventListener('click', openAddRoutine);
  document.getElementById('btnCancelRoutine').addEventListener('click', () => closeModal('routineModal'));
  document.getElementById('btnSaveRoutine').addEventListener('click', saveRoutine);

  // 設定
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnCancelSettings').addEventListener('click', () => closeModal('settingsModal'));
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
  document.getElementById('btnResetApp').addEventListener('click', () => {
    if (confirm('すべての設定をリセットしますか？')) { Store.clear(); location.reload(); }
  });

  // 同期
  document.getElementById('btnSync').addEventListener('click', loadAll);

  // モーダルオーバーレイクリックで閉じる
  ['routineModal', 'settingsModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) closeModal(id);
    });
  });
});
