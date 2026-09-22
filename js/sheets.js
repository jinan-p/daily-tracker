// ============================================================
// sheets.js — Google Sheets API (REST)
// ============================================================

const Sheets = {
  sheetId: null,

  // 保存は読み込み・控え・上書き・余剰行消去までを順番に実行する。
  // 途中の失敗は呼び出し元へ返すが、後続の保存は止めない。
  _saveQueue: Promise.resolve(),
  _enqueueSave(task) {
    const sheetId = this.sheetId;
    const pending = this._saveQueue.then(() => {
      if (this.sheetId !== sheetId) throw new Error('保存先が変更されました。もう一度同期してください。');
      return task();
    });
    this._saveQueue = pending.catch(() => {});
    return pending;
  },

  init(sheetId) {
    this.sheetId = sheetId;
  },

  // ------------------------------------------------------------
  // 内部: fetch ラッパー
  // ------------------------------------------------------------
  async _req(url, options = {}) {
    const buildHeaders = (token) => ({
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    });

    // トークン期限切れを即座に検知（Safariでの15秒サイレント失敗を回避）
    if (Auth.isExpired()) {
      const e = new Error('AUTH_REQUIRED');
      e.isAuthError = true;
      throw e;
    }

    // keepalive はページ終了後もリクエストを続けさせるフラグ（options経由で渡す）
    const { keepalive = false, ...fetchOptions } = options;

    let token = await Auth.getToken();
    let res = await fetch(url, { ...fetchOptions, headers: buildHeaders(token), keepalive });

    // 401（トークン失効）→ クリアして1回だけ再取得してリトライ
    if (res.status === 401) {
      Auth.clearToken();
      try {
        token = await Auth.getToken();
        res = await fetch(url, { ...fetchOptions, headers: buildHeaders(token), keepalive });
      } catch (_) {
        const e = new Error('AUTH_REQUIRED');
        e.isAuthError = true;
        throw e;
      }
      // リトライ後も401なら再認証バナーを促す
      if (res.status === 401) {
        Auth.clearToken();
        const e = new Error('AUTH_REQUIRED');
        e.isAuthError = true;
        throw e;
      }
    }

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
      [CONFIG.SHEET.ROUTINES]: [['id', 'name', 'category', 'duration', 'active', 'order', 'onetime', 'presets']],
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

      // 必要なシートと、その1行目の見出し
      const needed = [
        [CONFIG.SHEET.TIMELINE,        ['date', 'itemType', 'itemId', 'timeSlot', 'title', 'score']],
        [CONFIG.SHEET.TIMELINE_BACKUP, ['控えた日時', '日付', '種類', 'itemId', '時間', '内容', '点数']],
        [CONFIG.SHEET.ROUTINES_BACKUP, ['控えた日時', 'id', '名前', '並び順', 'presets', 'noteMode']],
      ];
      const missing = needed.filter(([title]) => !existing.includes(title));
      if (missing.length === 0) return;

      await this._req(`${CONFIG.SHEETS_BASE}/${this.sheetId}:batchUpdate`, {
        method: 'POST',
        body: JSON.stringify({
          requests: missing.map(([title]) => ({ addSheet: { properties: { title } } })),
        }),
      });
      for (const [title, header] of missing) {
        await this._write(`${title}!A1`, [header]);
      }
    } catch (e) {
      console.warn('シートの用意でエラー:', e);
    }
  },

  // ------------------------------------------------------------
  // 控え（バックアップ）シートへの追記
  // ------------------------------------------------------------
  // 【設計の要】控えシートには _append しか使わない。
  // _write（上書き）も :clear（消去）も絶対に呼ばない。
  // そのため本体のシートで何が起きても、控えが巻き添えで消えることはない。
  // 失敗しても本体の保存は止めない（控えは「あれば助かる」もの）。
  async _appendBackup(sheetName, rows) {
    if (!rows || rows.length === 0) return;
    try {
      await this._append(`${sheetName}!A1`, rows);
    } catch (e) {
      console.warn('控えの追記に失敗（本体の保存は続行）:', e);
    }
  },

  // 控えに残す日時（ブラウザのローカル時刻 = 日本時間）
  _stamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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
  // keepalive: ページが閉じられても送信を完了させる（バックグラウンド移行時に使用）
  // ------------------------------------------------------------
  async _write(range, values, { keepalive = false } = {}) {
    const url = `${CONFIG.SHEETS_BASE}/${this.sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    return this._req(url, {
      method: 'PUT',
      body: JSON.stringify({ range, values }),
      keepalive,
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
    const rows = await this._read(`${CONFIG.SHEET.ROUTINES}!A2:I1000`);
    return rows.map(r => ({
      id:       r[0] || '',
      name:     r[1] || '',
      category: r[2] || 'その他',
      duration: r[3] || '',
      active:   r[4] !== 'FALSE',
      order:    parseInt(r[5] || '0', 10),
      onetime:  r[6] === 'TRUE',
      presets:  (() => { try { return JSON.parse(r[7] || '[]'); } catch { return []; } })(),
      noteMode: r[8] === 'TRUE',
    })).sort((a, b) => a.order - b.order);
  },

  async saveAllRoutines(routines) {
    if (!Array.isArray(routines) || routines.length === 0) return;
    const snapshot = routines.map(r => ({
      ...r, presets: Array.isArray(r.presets) ? [...r.presets] : [],
    }));
    return this._enqueueSave(() => this._saveAllRoutines(snapshot));
  },

  async _saveAllRoutines(routines) {
    // 【安全弁】空のルーティンでシートを消さない。
    // ローカルが壊れて空になった状態で保存が走ると、下の「余剰行クリア」が
    // シート上のルーティンを全削除してしまうため、ここで必ず止める。
    if (!Array.isArray(routines) || routines.length === 0) {
      console.warn('saveAllRoutines: 空のため保存をスキップしました（シートを保護）');
      return;
    }
    // 全行を上書き（順序保証）
    const values = routines.map((r, i) => [
      r.id, r.name, r.category, r.duration, r.active ? 'TRUE' : 'FALSE', i, r.onetime ? 'TRUE' : 'FALSE',
      JSON.stringify(Array.isArray(r.presets) ? r.presets : []),
      r.noteMode ? 'TRUE' : 'FALSE',
    ]);
    // 現在の中身を把握（余剰行クリア用 ＋ 控え用）
    const current = await this._read(`${CONFIG.SHEET.ROUTINES}!A2:I1000`);
    const oldCount = current.length;

    // 【控え】ルーティンが減るときだけ、消えようとしている行を控えシートへ退避する
    if (oldCount > values.length) {
      const keepIds = new Set(routines.map(r => r.id));
      const stamp   = this._stamp();
      const backup  = current
        .filter(r => r[0] && !keepIds.has(r[0]))
        .map(r => [stamp, r[0] || '', r[1] || '', r[5] || '', r[7] || '', r[8] || '']);
      await this._appendBackup(CONFIG.SHEET.ROUTINES_BACKUP, backup);
    }
    // ① 先に書き込む（消去前に書くことで電源断によるデータ消失を防ぐ）
    if (values.length > 0) {
      await this._write(`${CONFIG.SHEET.ROUTINES}!A2`, values);
    }
    // ② 行数が減った場合のみ余剰行を後からクリア
    if (oldCount > values.length) {
      const startRow = values.length + 2;
      const clearUrl = `${CONFIG.SHEETS_BASE}/${this.sheetId}/values/${encodeURIComponent(`${CONFIG.SHEET.ROUTINES}!A${startRow}:I${oldCount + 1}`)}:clear`;
      await this._req(clearUrl, { method: 'POST', body: '{}' }).catch(() => {});
    }
  },

  // ============================================================
  // タイムライン
  // ============================================================

  async getTimeline(date) {
    const revision = this._timelineRevision;
    const rows = await this._read(`${CONFIG.SHEET.TIMELINE}!A2:F10000`);
    if (revision === this._timelineRevision) this._timelineCache = rows; // keepalive 保存用キャッシュを更新
    return rows
      .filter(r => r[0] === date)
      .map(r => ({
        date:     r[0] || '',
        itemType: r[1] || 'routine',
        itemId:   r[2] || '',
        timeSlot: r[3] || 'unplaced',
        title:    r[4] || '',
        score:    r[5] !== undefined && r[5] !== '' ? parseInt(r[5], 10) : null,
      }));
  },

  // タイムライン1行は必ず6列（A:F）。末尾の空セルを補って書き込まないと、
  // Google Sheets は省略した列を上書きせず、前の行に残っていた点数が
  // 別タスクに紛れ込む（＝勝手に点数が入る）バグの原因になる。
  _padTimelineRow(r) {
    const row = r.slice(0, 6);
    while (row.length < 6) row.push('');
    return row;
  },

  // 1日分の保存は複数日保存の特例として扱う（競合しない単一の読み書きに統一）
  async saveTimeline(date, items) {
    return this.saveTimelines({ [date]: items });
  },

  // タイムラインシートの最終読み込みキャッシュ（keepalive保存でネットワーク読み取りを省略するため）
  _timelineCache: null,
  _timelineRevision: 0,

  // ------------------------------------------------------------
  // 複数日をまとめて1回で保存（読み→書きを1回にして競合を防ぐ）
  // saveTimeline を日付ごとに並列で呼ぶと、各呼び出しがシート全体を
  // 読み直して書き戻すため、後勝ちで他日付の更新（点数など）が
  // 巻き戻ってしまう。日付はまとめ、さらに保存キューで呼び出し同士の重なりも防ぐ。
  // keepalive:true のときはキャッシュを使い READ を省略（ページ終了時用）。
  // ------------------------------------------------------------
  async saveTimelines(map, { keepalive = false } = {}) {
    // 待ち時間中に画面側の配列が変わっても、この保存の内容と日付は変えない。
    const snapshot = {};
    for (const [date, items] of Object.entries(map)) {
      if (Array.isArray(items) && items.length > 0) snapshot[date] = items.map(item => ({ ...item }));
    }
    if (Object.keys(snapshot).length === 0) return;
    return this._enqueueSave(() => this._saveTimelines(snapshot, { keepalive }));
  },

  async _saveTimelines(map, { keepalive = false } = {}) {
    // 【安全弁】空の日はシートに送らない（＝その日の行を消さない）。
    // 呼び出し側それぞれの判断に頼らず、ここで一括して防ぐ。
    // ※項目の削除は、その日に1件でも残っていれば通常どおり同期される。
    const dates = Object.keys(map).filter(d => Array.isArray(map[d]) && map[d].length > 0);
    if (dates.length === 0) return;

    let all;
    if (keepalive && this._timelineCache) {
      all = this._timelineCache;
    } else {
      all = await this._read(`${CONFIG.SHEET.TIMELINE}!A2:F10000`);
    }
    const oldCount = all.length;

    const dateSet = new Set(dates);
    const others  = all.filter(r => !dateSet.has(r[0])).map(r => this._padTimelineRow(r));

    const newRows = [];
    for (const date of dates) {
      for (const item of (map[date] || [])) {
        newRows.push([
          date, item.itemType, item.itemId, item.timeSlot, item.title,
          item.score !== null && item.score !== undefined ? item.score : '',
        ]);
      }
    }
    // 【控え】その日の行数が減るときだけ、消えようとしている行を控えシートへ退避する。
    // 追加や点数の変更では何も控えない（控えが無駄に膨らまないように）。
    // keepalive（ページを閉じる直前）はキャッシュ頼りなので控えは取らない。
    if (!keepalive) {
      const backup = [];
      const stamp  = this._stamp();
      for (const date of dates) {
        const before = all.filter(r => r[0] === date);
        const after  = map[date];
        if (before.length <= after.length) continue; // 減っていないなら何もしない
        const afterKeys = new Set(after.map(i => `${i.itemType}|${i.itemId}|${i.timeSlot}|${i.title}`));
        for (const r of before) {
          const key = `${r[1] || ''}|${r[2] || ''}|${r[3] || ''}|${r[4] || ''}`;
          if (afterKeys.has(key)) continue; // 残る行は控えなくてよい
          backup.push([stamp, r[0] || '', r[1] || '', r[2] || '', r[3] || '', r[4] || '', r[5] ?? '']);
        }
      }
      await this._appendBackup(CONFIG.SHEET.TIMELINE_BACKUP, backup);
    }

    const newAll = [...others, ...newRows];

    // 【安全弁】書き込み結果が0行になる場合は中止（シート全体の消失を防ぐ）
    if (newAll.length === 0) {
      if (oldCount > 0) console.warn('saveTimelines: 全行が空になるため保存を中止しました（シートを保護）');
      return;
    }

    await this._write(`${CONFIG.SHEET.TIMELINE}!A2`, newAll, { keepalive });
    ++this._timelineRevision;
    this._timelineCache = newAll;
    // 行数が減った場合のみ余剰行をクリア（keepalive 時はスキップ）
    if (!keepalive && oldCount > newAll.length) {
      const startRow = newAll.length + 2;
      const clearUrl = `${CONFIG.SHEETS_BASE}/${this.sheetId}/values/${encodeURIComponent(`${CONFIG.SHEET.TIMELINE}!A${startRow}:F${oldCount + 1}`)}:clear`;
      await this._req(clearUrl, { method: 'POST', body: '{}' }).catch(() => {});
    }
  },

  // ============================================================
  // 採点履歴（Timelineシートからスコアを集計）
  // ============================================================

  async getScoreHistory(days = 30) {
    const rows = await this._read(`${CONFIG.SHEET.TIMELINE}!A2:F10000`);

    // 日付ごとにスコアを合計
    const byDate = {};
    for (const row of rows) {
      const date = row[0];
      const score = row[5] !== undefined && row[5] !== '' ? parseInt(row[5], 10) : null;
      if (!date) continue;
      if (!byDate[date]) byDate[date] = 0;
      if (score !== null && !isNaN(score)) byDate[date] += score;
    }

    // 直近N日を新しい順で返す（データがある日のみ）
    const result = [];
    const today = new Date();
    const pad = n => String(n).padStart(2, '0');
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
      if (byDate[dateStr] !== undefined) {
        result.push({ date: dateStr, score: byDate[dateStr] });
      }
    }
    return result;
  },
};
