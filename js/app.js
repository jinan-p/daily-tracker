// ============================================================
// app.js — メインアプリロジック
// ============================================================

// ============================================================
// アプリの状態（State）
// ============================================================
const State = {
  routines:     [],   // ルーティンマスタ
  dailyLog:     [],   // 今日のチェック状態
  manualTasks:  [],   // 今日の手動タスク
  calEvents:    [],   // Googleカレンダーイベント
  selfScore:    0,
  comment:      '',
  editRoutineId: null,  // 編集中のルーティンID
  today:        '',
  chatCollapsed: false,
};

// ============================================================
// ユーティリティ
// ============================================================

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

function formatDateJP(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['日','月','火','水','木','金','土'];
  return `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日（${days[d.getDay()]}）`;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function showToast(msg, type = 'success') {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.className   = `toast ${type}`;
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

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6)  return 'おはようございます（早起き偉い！）';
  if (h < 12) return 'おはようございます！今日も頑張りましょう☀️';
  if (h < 18) return 'こんにちは！今日の調子はいかがですか？';
  return 'お疲れ様です！今日を振り返りましょう🌙';
}

// ============================================================
// セットアップ画面
// ============================================================

function initSetup() {
  // ヘルプリンク
  document.getElementById('showClientIdHelp').addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('clientIdHelp').classList.toggle('hidden');
  });

  // Step 1 → Step 2
  document.getElementById('btnStep1Next').addEventListener('click', () => {
    const clientId = document.getElementById('inputClientId').value.trim();
    if (!clientId) { showToast('Client IDを入力してください', 'error'); return; }
    Store.set(CONFIG.LS.CLIENT_ID, clientId);
    Auth.init();
    showStep('step2');
  });

  // Step 2: Googleサインイン
  document.getElementById('btnGoogleSignIn').addEventListener('click', () => {
    Auth.signIn(
      async (res) => {
        // ユーザー情報取得
        try {
          const info = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': `Bearer ${res.access_token}` },
          }).then(r => r.json());
          Store.set(CONFIG.LS.USER_NAME,  info.name  || '');
          Store.set(CONFIG.LS.USER_EMAIL, info.email || '');
        } catch {}
        document.getElementById('authStatus').classList.remove('hidden');
        document.getElementById('btnStep2Next').classList.remove('hidden');
      },
      (err) => showToast(`認証エラー: ${err}`, 'error'),
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
      status.textContent = `✅ 作成完了！ID: ${sheetId}`;
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
    showStep('step4');
  });

  // Step 4: Claude APIキー
  document.getElementById('btnFinishSetup').addEventListener('click', () => {
    const key = document.getElementById('inputClaudeKey').value.trim();
    if (!key) { showToast('Claude APIキーを入力してください', 'error'); return; }
    Store.set(CONFIG.LS.CLAUDE_KEY, key);
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
  document.getElementById('setupModal').classList.remove('active');
  document.getElementById('setupModal').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('app').classList.add('active');

  // ユーザー表示
  const name = Store.get(CONFIG.LS.USER_NAME) || 'ユーザー';
  document.getElementById('userName').textContent   = name;
  document.getElementById('userAvatar').textContent = name[0] || 'U';

  // 今日の日付
  State.today = todayStr();
  document.getElementById('todayHeading').textContent = formatDateJP(State.today);
  document.getElementById('todayGreeting').textContent = getGreeting();

  // Sheetsを初期化
  Sheets.init(Store.get(CONFIG.LS.SHEET_ID));

  // 今日のデータを読み込む
  await loadTodayData();
}

// ============================================================
// 今日のデータを読み込む
// ============================================================

async function loadTodayData() {
  try {
    const [routines, log, tasks, evalData] = await Promise.all([
      Sheets.getRoutines(),
      Sheets.getDailyLog(State.today),
      Sheets.getManualTasks(State.today),
      Sheets.getSelfEval(State.today),
    ]);

    State.routines    = routines;
    State.dailyLog    = log;
    State.manualTasks = tasks;

    if (evalData) {
      State.selfScore = evalData.selfScore;
      State.comment   = evalData.comment;
    }

    renderRoutines();
    renderManualTasks();
    renderEval();
    updateScore();
    renderRoutineSettings();
  } catch (e) {
    showToast(`データ読み込みエラー: ${e.message}`, 'error');
  }
}

// ============================================================
// 今日ビュー: ルーティン
// ============================================================

function renderRoutines() {
  const list = document.getElementById('routineList');
  const active = State.routines.filter(r => r.active);

  if (active.length === 0) {
    list.innerHTML = '<li class="empty-state">ルーティンを設定してください</li>';
    return;
  }

  list.innerHTML = active.map(r => {
    const logEntry = State.dailyLog.find(l => l.routineId === r.id);
    const done     = logEntry?.completed || false;
    return `
      <li class="routine-item ${done ? 'done' : ''}" data-id="${r.id}">
        <div class="routine-checkbox">${done ? '✓' : ''}</div>
        <div class="routine-info">
          <div class="routine-name">${r.name}</div>
          ${r.duration ? `<div class="routine-meta">⏱ ${r.duration}</div>` : ''}
        </div>
        <span class="routine-category-tag">${r.category}</span>
      </li>`;
  }).join('');

  // チェックのクリックイベント
  list.querySelectorAll('.routine-item').forEach(el => {
    el.addEventListener('click', () => toggleRoutine(el.dataset.id));
  });

  updateScore();
}

async function toggleRoutine(routineId) {
  const existing = State.dailyLog.find(l => l.routineId === routineId);
  if (existing) {
    existing.completed = !existing.completed;
  } else {
    State.dailyLog.push({ date: State.today, routineId, completed: true });
  }
  renderRoutines();
  updateScore();

  try {
    await Sheets.saveDailyLog(State.today, State.dailyLog);
  } catch (e) {
    showToast('保存に失敗しました', 'error');
  }
}

// ============================================================
// 今日ビュー: カレンダーイベント
// ============================================================

async function loadCalendarEvents() {
  const btn = document.getElementById('btnSyncCalendar');
  btn.textContent = '取得中...';
  btn.disabled = true;
  try {
    State.calEvents = await Calendar.getEvents(State.today);
    renderCalendarEvents();
    showToast('カレンダーを取得しました');
  } catch (e) {
    showToast(`カレンダーエラー: ${e.message}`, 'error');
  } finally {
    btn.textContent = 'カレンダー取得';
    btn.disabled = false;
  }
}

function renderCalendarEvents() {
  const container = document.getElementById('calendarEvents');
  if (State.calEvents.length === 0) {
    container.innerHTML = '<div style="font-size:12px;color:var(--text-light);padding:4px 0">Googleカレンダーの予定はありません</div>';
    return;
  }
  container.innerHTML = State.calEvents.map(e => `
    <div class="event-item">
      <span class="event-time">${e.time}</span>
      <span class="event-title">${e.title}</span>
    </div>`).join('');
}

// ============================================================
// 今日ビュー: 手動タスク
// ============================================================

function renderManualTasks() {
  const container = document.getElementById('manualTasks');
  if (State.manualTasks.length === 0) {
    container.innerHTML = '';
    return;
  }
  container.innerHTML = State.manualTasks.map(t => `
    <div class="task-item ${t.completed ? 'done' : ''}" data-id="${t.id}">
      <div class="task-check" data-id="${t.id}">${t.completed ? '✓' : ''}</div>
      <span class="task-time">${t.time || ''}</span>
      <span class="task-name">${t.name}</span>
      <button class="task-delete" data-id="${t.id}">✕</button>
    </div>`).join('');

  container.querySelectorAll('.task-check').forEach(el => {
    el.addEventListener('click', () => toggleManualTask(el.dataset.id));
  });
  container.querySelectorAll('.task-delete').forEach(el => {
    el.addEventListener('click', () => deleteManualTask(el.dataset.id));
  });
}

async function toggleManualTask(taskId) {
  const task = State.manualTasks.find(t => t.id === taskId);
  if (!task) return;
  task.completed = !task.completed;
  renderManualTasks();
  try {
    await Sheets.updateManualTask(taskId, task.completed);
  } catch (e) {
    showToast('保存に失敗しました', 'error');
  }
}

async function deleteManualTask(taskId) {
  State.manualTasks = State.manualTasks.filter(t => t.id !== taskId);
  renderManualTasks();
  try {
    await Sheets.deleteManualTask(taskId);
  } catch (e) {
    showToast('削除に失敗しました', 'error');
  }
}

// ============================================================
// 今日ビュー: スコア更新
// ============================================================

function updateScore() {
  const active = State.routines.filter(r => r.active);
  const done   = active.filter(r => State.dailyLog.find(l => l.routineId === r.id && l.completed));
  const total  = active.length;
  const pct    = total > 0 ? Math.round((done.length / total) * 100) : 0;

  document.getElementById('autoScoreVal').textContent  = `${pct}%`;
  document.getElementById('progressFill').style.width  = `${pct}%`;
  document.getElementById('routineProgress').textContent = `${done.length} / ${total}`;

  // 星ミニ表示
  const stars = State.selfScore;
  document.getElementById('starMini').textContent = '★'.repeat(stars) + '☆'.repeat(5 - stars);
}

// ============================================================
// 今日ビュー: 振り返り（自己評価）
// ============================================================

function renderEval() {
  // 星の表示
  document.querySelectorAll('.star').forEach(el => {
    const val = parseInt(el.dataset.value, 10);
    el.classList.toggle('active', val <= State.selfScore);
  });
  document.getElementById('commentInput').value = State.comment;
}

async function saveEval() {
  const active = State.routines.filter(r => r.active);
  const done   = active.filter(r => State.dailyLog.find(l => l.routineId === r.id && l.completed));
  const autoScore = active.length > 0 ? Math.round((done.length / active.length) * 100) : 0;

  try {
    await Sheets.saveSelfEval(State.today, State.selfScore, State.comment, autoScore);
    showToast('振り返りを保存しました✅');
    updateScore();
  } catch (e) {
    showToast(`保存エラー: ${e.message}`, 'error');
  }
}

// ============================================================
// チャット
// ============================================================

function addChatMessage(role, text) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="msg-bubble">${text.replace(/\n/g, '<br>')}</div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function showTyping() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.id = 'typingIndicator';
  div.innerHTML = `<div class="msg-bubble"><div class="typing-indicator"><span></span><span></span><span></span></div></div>`;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function hideTyping() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text  = input.value.trim();
  if (!text) return;

  input.value = '';
  document.getElementById('btnSend').disabled = true;
  addChatMessage('user', text);
  showTyping();

  try {
    const result = await Claude.chat(text, State.routines);
    hideTyping();
    addChatMessage('assistant', result.message);

    // 達成ルーティンを自動チェック
    if (result.completed.length > 0) {
      for (const name of result.completed) {
        const routine = State.routines.find(r => r.name === name && r.active);
        if (!routine) continue;
        const existing = State.dailyLog.find(l => l.routineId === routine.id);
        if (existing) {
          existing.completed = true;
        } else {
          State.dailyLog.push({ date: State.today, routineId: routine.id, completed: true });
        }
      }
      renderRoutines();
      updateScore();
      await Sheets.saveDailyLog(State.today, State.dailyLog);
      showToast(`${result.completed.length}件のルーティンを記録しました✅`);
    }
  } catch (e) {
    hideTyping();
    addChatMessage('assistant', `エラーが発生しました: ${e.message}`);
  } finally {
    document.getElementById('btnSend').disabled = false;
  }
}

// ============================================================
// ルーティン設定ビュー
// ============================================================

function renderRoutineSettings() {
  const container = document.getElementById('routineSettings');
  if (State.routines.length === 0) {
    container.innerHTML = '<div class="empty-state">まだルーティンがありません。上の「追加」ボタンから始めましょう！</div>';
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
        <button class="btn-edit" data-id="${r.id}">編集</button>
        <button class="btn-delete" data-id="${r.id}">削除</button>
      </div>
    </div>`).join('');

  // トグルスイッチ
  container.querySelectorAll('.routine-toggle').forEach(el => {
    el.addEventListener('change', () => toggleRoutineActive(el.dataset.id, el.checked));
  });

  // 編集ボタン
  container.querySelectorAll('.btn-edit').forEach(el => {
    el.addEventListener('click', () => openEditRoutine(el.dataset.id));
  });

  // 削除ボタン
  container.querySelectorAll('.btn-delete').forEach(el => {
    el.addEventListener('click', () => deleteRoutine(el.dataset.id));
  });
}

async function toggleRoutineActive(routineId, active) {
  const r = State.routines.find(r => r.id === routineId);
  if (!r) return;
  r.active = active;
  renderRoutineSettings();
  renderRoutines();
  try {
    await Sheets.saveAllRoutines(State.routines);
  } catch (e) {
    showToast('保存に失敗しました', 'error');
  }
}

function openAddRoutine() {
  State.editRoutineId = null;
  document.getElementById('routineModalTitle').textContent = 'ルーティンを追加';
  document.getElementById('routineName').value    = '';
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
    // 編集
    const r = State.routines.find(r => r.id === State.editRoutineId);
    if (r) { r.name = name; r.category = category; r.duration = duration; }
  } else {
    // 追加
    State.routines.push({
      id: genId(), name, category, duration,
      active: true, order: State.routines.length,
    });
  }

  closeModal('routineModal');
  renderRoutineSettings();
  renderRoutines();
  try {
    await Sheets.saveAllRoutines(State.routines);
    showToast('ルーティンを保存しました✅');
  } catch (e) {
    showToast(`保存エラー: ${e.message}`, 'error');
  }
}

async function deleteRoutine(routineId) {
  if (!confirm('このルーティンを削除しますか？')) return;
  State.routines = State.routines.filter(r => r.id !== routineId);
  renderRoutineSettings();
  renderRoutines();
  try {
    await Sheets.saveAllRoutines(State.routines);
    showToast('削除しました');
  } catch (e) {
    showToast('削除に失敗しました', 'error');
  }
}

// ============================================================
// 履歴ビュー
// ============================================================

async function loadHistory() {
  try {
    const history = await Sheets.getHistory(30);
    renderHistoryList(history);
    renderScoreChart(history);
    renderStreak(history);
  } catch (e) {
    showToast(`履歴の取得に失敗: ${e.message}`, 'error');
  }
}

function renderHistoryList(history) {
  const container = document.getElementById('historyList');
  const withData  = history.filter(h => h.hasData).reverse();
  if (withData.length === 0) {
    container.innerHTML = '<div class="empty-state">まだ記録がありません</div>';
    return;
  }

  container.innerHTML = withData.map(h => {
    const pct   = h.autoScore ?? 0;
    const stars = '★'.repeat(h.selfScore) + '☆'.repeat(5 - h.selfScore);
    const d     = new Date(h.date + 'T00:00:00');
    const label = `${d.getMonth()+1}/${d.getDate()}`;
    return `
      <div class="history-item">
        <span class="history-date">${label}</span>
        <div class="history-score-bar">
          <div class="history-score-fill" style="width:${pct}%"></div>
        </div>
        <span class="history-pct">${h.autoScore !== null ? pct + '%' : '--'}</span>
        <span class="history-stars" style="color:var(--warning)">${h.selfScore > 0 ? stars : '－'}</span>
        <span class="history-comment">${h.comment || ''}</span>
      </div>`;
  }).join('');
}

function renderScoreChart(history) {
  const canvas  = document.getElementById('scoreChart');
  const ctx     = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  const data = history.filter(h => h.autoScore !== null);
  if (data.length < 2) {
    ctx.fillStyle = '#A0A0C0';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('データが不足しています（2日以上記録するとグラフが表示されます）', W/2, H/2);
    return;
  }

  const pad = { top: 20, right: 20, bottom: 30, left: 36 };
  const gW  = W - pad.left - pad.right;
  const gH  = H - pad.top  - pad.bottom;

  // グリッド線
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 1;
  [0, 25, 50, 75, 100].forEach(v => {
    const y = pad.top + gH - (v / 100) * gH;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(W - pad.right, y);
    ctx.stroke();
    ctx.fillStyle = '#A0A0C0';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(v + '%', pad.left - 4, y + 3);
  });

  // 折れ線
  ctx.strokeStyle = '#6C63FF';
  ctx.lineWidth   = 2.5;
  ctx.lineJoin    = 'round';
  ctx.beginPath();

  data.forEach((d, i) => {
    const x = pad.left + (i / (data.length - 1)) * gW;
    const y = pad.top  + gH - (d.autoScore / 100) * gH;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.stroke();

  // 塗り
  ctx.lineTo(pad.left + gW, pad.top + gH);
  ctx.lineTo(pad.left, pad.top + gH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + gH);
  grad.addColorStop(0, 'rgba(108,99,255,0.2)');
  grad.addColorStop(1, 'rgba(108,99,255,0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // 点
  data.forEach((d, i) => {
    const x = pad.left + (i / (data.length - 1)) * gW;
    const y = pad.top  + gH - (d.autoScore / 100) * gH;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#6C63FF';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function renderStreak(history) {
  let streak = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].autoScore !== null && history[i].autoScore >= 50) {
      streak++;
    } else if (history[i].hasData) {
      break;
    } else {
      // データなしはスキップ
      if (i === history.length - 1) continue;
      break;
    }
  }
  document.getElementById('streakNum').textContent = streak;
}

// ============================================================
// 設定モーダル
// ============================================================

function openSettings() {
  document.getElementById('settingsClaudeKey').value = Store.get(CONFIG.LS.CLAUDE_KEY) || '';
  document.getElementById('settingsSheetId').value   = Store.get(CONFIG.LS.SHEET_ID)   || '';
  document.getElementById('settingsClientId').value  = Store.get(CONFIG.LS.CLIENT_ID)  || '';
  openModal('settingsModal');
}

function saveSettings() {
  const key      = document.getElementById('settingsClaudeKey').value.trim();
  const sheetId  = document.getElementById('settingsSheetId').value.trim();
  const clientId = document.getElementById('settingsClientId').value.trim();
  if (key)      Store.set(CONFIG.LS.CLAUDE_KEY,  key);
  if (sheetId)  { Store.set(CONFIG.LS.SHEET_ID, sheetId);  Sheets.init(sheetId); }
  if (clientId) { Store.set(CONFIG.LS.CLIENT_ID, clientId); Auth.init(); }
  closeModal('settingsModal');
  showToast('設定を保存しました✅');
}

// ============================================================
// イベントリスナーの登録
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // セットアップ済みかチェック
  if (Store.get(CONFIG.LS.SETUP_DONE)) {
    Auth.init();
    launchApp();
  } else {
    initSetup();
  }

  // ナビゲーション
  document.querySelectorAll('.nav-item').forEach(el => {
    el.addEventListener('click', async () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => {
        v.classList.add('hidden');
        v.classList.remove('active');
      });
      el.classList.add('active');
      const viewId = el.dataset.view + 'View';
      const view   = document.getElementById(viewId);
      if (view) {
        view.classList.remove('hidden');
        view.classList.add('active');
      }
      if (el.dataset.view === 'history') {
        await loadHistory();
      }
    });
  });

  // カレンダー取得
  document.getElementById('btnSyncCalendar').addEventListener('click', loadCalendarEvents);

  // タスク追加
  document.getElementById('btnAddTask').addEventListener('click', () => openModal('taskModal'));
  document.getElementById('btnCancelTask').addEventListener('click', () => closeModal('taskModal'));
  document.getElementById('btnSaveTask').addEventListener('click', async () => {
    const name = document.getElementById('taskName').value.trim();
    const time = document.getElementById('taskTime').value;
    if (!name) { showToast('内容を入力してください', 'error'); return; }
    const task = { id: genId(), date: State.today, name, time, completed: false, source: 'manual' };
    State.manualTasks.push(task);
    renderManualTasks();
    closeModal('taskModal');
    document.getElementById('taskName').value = '';
    document.getElementById('taskTime').value = '';
    try {
      await Sheets.addManualTask(task);
      showToast('予定を追加しました');
    } catch (e) {
      showToast('保存に失敗しました', 'error');
    }
  });

  // 振り返り: 星評価
  document.querySelectorAll('.star').forEach(el => {
    el.addEventListener('click', () => {
      const val = parseInt(el.dataset.value, 10);
      State.selfScore = State.selfScore === val ? 0 : val;
      renderEval();
      updateScore();
    });
    el.addEventListener('mouseover', () => {
      const val = parseInt(el.dataset.value, 10);
      document.querySelectorAll('.star').forEach(s => {
        s.classList.toggle('active', parseInt(s.dataset.value, 10) <= val);
      });
    });
    el.addEventListener('mouseleave', () => renderEval());
  });

  document.getElementById('commentInput').addEventListener('input', e => {
    State.comment = e.target.value;
  });

  document.getElementById('btnSaveEval').addEventListener('click', saveEval);

  // チャット
  document.getElementById('chatToggle').addEventListener('click', () => {
    const body = document.getElementById('chatBody');
    const icon = document.getElementById('chatToggleIcon');
    State.chatCollapsed = !State.chatCollapsed;
    body.style.display  = State.chatCollapsed ? 'none' : '';
    icon.classList.toggle('collapsed', State.chatCollapsed);
  });

  document.getElementById('btnSend').addEventListener('click', sendChatMessage);
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });

  // ルーティン設定
  document.getElementById('btnAddRoutine').addEventListener('click', openAddRoutine);
  document.getElementById('btnCancelRoutine').addEventListener('click', () => closeModal('routineModal'));
  document.getElementById('btnSaveRoutine').addEventListener('click', saveRoutine);

  // 設定モーダル
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnCancelSettings').addEventListener('click', () => closeModal('settingsModal'));
  document.getElementById('btnSaveSettings').addEventListener('click', saveSettings);
  document.getElementById('btnResetApp').addEventListener('click', () => {
    if (confirm('すべての設定をリセットして初期状態に戻しますか？\n（Googleスプレッドシートのデータは残ります）')) {
      Store.clear();
      location.reload();
    }
  });

  // 同期ボタン
  document.getElementById('btnSync').addEventListener('click', async () => {
    showToast('データを同期中...');
    await loadTodayData();
    showToast('同期完了✅');
  });

  // オーバーレイクリックでモーダルを閉じる
  ['routineModal', 'taskModal', 'settingsModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target.id === id) closeModal(id);
    });
  });
});
