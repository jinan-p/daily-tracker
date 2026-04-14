// ============================================================
// sheets.js — Google Sheets API (REST)
// ============================================================

const Sheets = {
  sheetId: null,

  init(sheetId) {
    this.sheetId = sheetId;
  },

  // ------------------------------------------------------------
  // 内部: fetch ラッパー
  // ------------------------------------------------------------
  async _req(url, options = {}) {
    const token = await Auth.getToken();
    const res = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Sheets API error: ${res.status}`);
    }
    return res.json();
  },

  // ------------------------------------------------------------
  // シートの存在確認＆初期化（初回のみ）
  // ------------------------------------------------------------
  async setupSheets() {
    const meta = await this._req(`${CONFIG.SHEETS_BASE}/${this.sheetId}?fields=sheets.properties.title`);
    const existing = meta.sheets.map(s => s.properties.title);

    const headers = {
      [CONFIG.SHEET.ROUTINES]: [['id', 'name', 'category', 'duration', 'active', 'order']],
      [CONFIG.SHEET.TIMELINE]: [['date', 'itemType', 'itemId', 'timeSlot', 'title']],
    };

    const toAdd = Object.keys(headers).filter(name => !existing.includes(name));
    if (toAdd.length === 0) return;

    const addRequests = toAdd.map(title => ({
      addSheet: { properties: { title } },
    }));
    await this._req(`${CONFIG.SHEETS_BASE}/${this.sheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: addRequests }),
    });

    for (const name of toAdd) {
      await this._write(`${name}!A1`, headers[name]);
    }
  },

  // ------------------------------------------------------------
  // Timeline シートが存在しない場合は作成（既存ユーザー向け）
  // ------------------------------------------------------------
  async ensureTimelineSheet() {
    try {
      const meta = await this._req(`${CONFIG.SHEETS_BASE}/${this.sheetId}?fields=sheets.properties.title`);
      const existing = meta.sheets.map(s => s.properties.title);
      if (!existing.includes(CONFIG.SHEET.TIMELINE)) {
        await this._req(`${CONFIG.SHEETS_BASE}/${this.sheetId}:batchUpdate`, {
          method: 'POST',
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: CONFIG.SHEET.TIMELINE } } }] }),
        });
        await this._write(`${CONFIG.SHEET.TIMELINE}!A1`, [['date', 'itemType', 'itemId', 'timeSlot', 'title']]);
      }
    } catch (e) {
      console.warn('Timeline sheet ensure error:', e);
    }
  },

  // ------------------------------------------------------------
  // 新しいスプレッドシートを作成
  // ------------------------------------------------------------
  async createNewSheet(title = 'Daily Tracker データ') {
    const token = await Auth.getToken();
    const res = await fetch(CONFIG.SHEETS_BASE, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title },
        sheets: [
          { properties: { title: CONFIG.SHEET.ROUTINES } },
          { properties: { title: CONFIG.SHEET.TIMELINE } },
        ],
      }),
    });
    if (!res.ok) throw new Error('スプレッドシートの作成に失敗しました');
    const data = await res.json();

    this.sheetId = data.spreadsheetId;
    await this._write(`${CONFIG.SHEET.ROUTINES}!A1`, [['id', 'name', 'category', 'duration', 'active', 'order']]);
    await this._write(`${CONFIG.SHEET.TIMELINE}!A1`, [['date', 'itemType', 'itemId', 'timeSlot', 'title']]);

    return data.spreadsheetId;
  },

  // ------------------------------------------------------------
  // 内部: 範囲を読み込む
  // ------------------------------------------------------------
  async _read(range) {
    const url = `${CONFIG.SHEETS_BASE}/${this.sheetId}/values/${encodeURIComponent(range)}`;
    const data = await this._req(url);
    return data.values || [];
  },

  // ------------------------------------------------------------
  // 内部: 範囲を上書き書き込み
  // ------------------------------------------------------------
  async _write(range, values) {
    const url = `${CONFIG.SHEETS_BASE}/${this.sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    return this._req(url, {
      method: 'PUT',
      body: JSON.stringify({ range, values }),
    });
  },

  // ------------------------------------------------------------
  // 内部: 末尾に追記
  // ------------------------------------------------------------
  async _append(range, values) {
    const url = `${CONFIG.SHEETS_BASE}/${this.sheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    return this._req(url, {
      method: 'POST',
      body: JSON.stringify({ values }),
    });
  },

  // ============================================================
  // ルーティン CRUD
  // ============================================================

  async getRoutines() {
    const rows = await this._read(`${CONFIG.SHEET.ROUTINES}!A2:F1000`);
    return rows.map(r => ({
      id:       r[0] || '',
      name:     r[1] || '',
      category: r[2] || 'その他',
      duration: r[3] || '',
      active:   r[4] !== 'FALSE',
      order:    parseInt(r[5] || '0', 10),
    })).sort((a, b) => a.order - b.order);
  },

  async saveAllRoutines(routines) {
    // 全行を上書き（順序保証）
    const values = routines.map((r, i) => [
      r.id, r.name, r.category, r.duration, r.active ? 'TRUE' : 'FALSE', i,
    ]);
    // まず既存をクリア（ヘッダー行除く）
    const clearUrl = `${CONFIG.SHEETS_BASE}/${this.sheetId}/values/${encodeURIComponent(CONFIG.SHEET.ROUTINES + '!A2:F1000')}:clear`;
    await this._req(clearUrl, { method: 'POST', body: '{}' });
    if (values.length > 0) {
      await this._write(`${CONFIG.SHEET.ROUTINES}!A2`, values);
    }
  },

  // ============================================================
  // 日次ログ
  // ============================================================

  async getDailyLog(date) {
    const rows = await this._read(`${CONFIG.SHEET.DAILY_LOG}!A2:C10000`);
    return rows
      .filter(r => r[0] === date)
      .map(r => ({ date: r[0], routineId: r[1], completed: r[2] === 'TRUE' }));
  },

  // その日のログを全上書き（チェック状態変更時）
  async saveDailyLog(date, logs) {
    // 他の日のデータを保持しつつ、今日分だけ更新
    const all = await this._read(`${CONFIG.SHEET.DAILY_LOG}!A2:C10000`);
    const others = all.filter(r => r[0] !== date);
    const todayRows = logs.map(l => [date, l.routineId, l.completed ? 'TRUE' : 'FALSE']);
    const newAll = [...others, ...todayRows];

    const clearUrl = `${CONFIG.SHEETS_BASE}/${this.sheetId}/values/${encodeURIComponent(CONFIG.SHEET.DAILY_LOG + '!A2:C10000')}:clear`;
    await this._req(clearUrl, { method: 'POST', body: '{}' });
    if (newAll.length > 0) {
      await this._write(`${CONFIG.SHEET.DAILY_LOG}!A2`, newAll);
    }
  },

  // ============================================================
  // 手動タスク
  // ============================================================

  async getManualTasks(date) {
    const rows = await this._read(`${CONFIG.SHEET.MANUAL_TASKS}!A2:F10000`);
    return rows
      .filter(r => r[1] === date)
      .map(r => ({
        id:        r[0] || '',
        date:      r[1] || '',
        name:      r[2] || '',
        time:      r[3] || '',
        completed: r[4] === 'TRUE',
        source:    r[5] || 'manual',
      }));
  },

  async addManualTask(task) {
    await this._append(`${CONFIG.SHEET.MANUAL_TASKS}!A:F`, [[
      task.id, task.date, task.name, task.time || '', 'FALSE', task.source || 'manual',
    ]]);
  },

  async updateManualTask(taskId, completed) {
    const rows = await this._read(`${CONFIG.SHEET.MANUAL_TASKS}!A2:F10000`);
    const idx  = rows.findIndex(r => r[0] === taskId);
    if (idx === -1) return;
    const rowNum = idx + 2; // ヘッダー1行分オフセット
    await this._write(`${CONFIG.SHEET.MANUAL_TASKS}!E${rowNum}`, [[completed ? 'TRUE' : 'FALSE']]);
  },

  async deleteManualTask(taskId) {
    const all = await this._read(`${CONFIG.SHEET.MANUAL_TASKS}!A2:F10000`);
    const newAll = all.filter(r => r[0] !== taskId);
    const clearUrl = `${CONFIG.SHEETS_BASE}/${this.sheetId}/values/${encodeURIComponent(CONFIG.SHEET.MANUAL_TASKS + '!A2:F10000')}:clear`;
    await this._req(clearUrl, { method: 'POST', body: '{}' });
    if (newAll.length > 0) {
      await this._write(`${CONFIG.SHEET.MANUAL_TASKS}!A2`, newAll);
    }
  },

  // ============================================================
  // 自己評価
  // ============================================================

  async getSelfEval(date) {
    const rows = await this._read(`${CONFIG.SHEET.SELF_EVAL}!A2:D10000`);
    const row  = rows.find(r => r[0] === date);
    if (!row) return null;
    return {
      date:      row[0],
      selfScore: parseInt(row[1] || '0', 10),
      comment:   row[2] || '',
      autoScore: parseInt(row[3] || '0', 10),
    };
  },

  async saveSelfEval(date, selfScore, comment, autoScore) {
    const all = await this._read(`${CONFIG.SHEET.SELF_EVAL}!A2:D10000`);
    const idx  = all.findIndex(r => r[0] === date);

    if (idx === -1) {
      await this._append(`${CONFIG.SHEET.SELF_EVAL}!A:D`, [[date, selfScore, comment, autoScore]]);
    } else {
      const rowNum = idx + 2;
      await this._write(`${CONFIG.SHEET.SELF_EVAL}!A${rowNum}:D${rowNum}`, [[date, selfScore, comment, autoScore]]);
    }
  },

  // ============================================================
  // タイムライン
  // ============================================================

  async getTimeline(date) {
    const rows = await this._read(`${CONFIG.SHEET.TIMELINE}!A2:E10000`);
    return rows
      .filter(r => r[0] === date)
      .map(r => ({
        date:     r[0] || '',
        itemType: r[1] || 'routine',
        itemId:   r[2] || '',
        timeSlot: r[3] || 'unplaced',
        title:    r[4] || '',
      }));
  },

  async saveTimeline(date, items) {
    const all = await this._read(`${CONFIG.SHEET.TIMELINE}!A2:E10000`);
    const others = all.filter(r => r[0] !== date);
    const dateRows = items.map(item => [date, item.itemType, item.itemId, item.timeSlot, item.title]);
    const newAll = [...others, ...dateRows];

    const clearUrl = `${CONFIG.SHEETS_BASE}/${this.sheetId}/values/${encodeURIComponent(CONFIG.SHEET.TIMELINE + '!A2:E10000')}:clear`;
    await this._req(clearUrl, { method: 'POST', body: '{}' });
    if (newAll.length > 0) {
      await this._write(`${CONFIG.SHEET.TIMELINE}!A2`, newAll);
    }
  },

  // ============================================================
  // 履歴（直近N日）
  // ============================================================

  async getHistory(days = 30) {
    const [logRows, evalRows] = await Promise.all([
      this._read(`${CONFIG.SHEET.DAILY_LOG}!A2:C10000`),
      this._read(`${CONFIG.SHEET.SELF_EVAL}!A2:D10000`),
    ]);

    // 直近N日の日付リストを生成
    const dates = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }

    return dates.map(date => {
      const dayLogs  = logRows.filter(r => r[0] === date);
      const total    = dayLogs.length;
      const done     = dayLogs.filter(r => r[2] === 'TRUE').length;
      const autoScore = total > 0 ? Math.round((done / total) * 100) : null;

      const evalRow = evalRows.find(r => r[0] === date);
      return {
        date,
        autoScore,
        selfScore: evalRow ? parseInt(evalRow[1] || '0', 10) : 0,
        comment:   evalRow ? (evalRow[2] || '') : '',
        hasData:   total > 0 || !!evalRow,
      };
    });
  },
};
