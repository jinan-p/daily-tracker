// ============================================================
// calendar.js — Google Calendar API (読み取り専用)
// ============================================================

const Calendar = {

  // ------------------------------------------------------------
  // 指定日のイベントを取得
  // ------------------------------------------------------------
  async getEvents(dateStr) {
    // 既存のトークンのみ使用（ここで再認証ポップアップは出さない）
    if (!Auth.accessToken || Auth.isExpired()) {
      throw new Error('トークンが期限切れです。🔄ボタンで再認証してください');
    }
    const token = Auth.accessToken;

    // 日本時間 00:00〜23:59 を UTC に変換
    const timeMin = `${dateStr}T00:00:00+09:00`;
    const timeMax = `${dateStr}T23:59:59+09:00`;

    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });

    const res = await fetch(
      `${CONFIG.CALENDAR_BASE}/calendars/primary/events?${params}`,
      { headers: { 'Authorization': `Bearer ${token}` } },
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || 'カレンダーの取得に失敗しました');
    }

    const data = await res.json();
    return (data.items || []).map(item => ({
      id:       item.id,
      title:    item.summary || '（タイトルなし）',
      time:     this._formatTime(item.start),
      allDay:   !item.start.dateTime,
      location: item.location || '',
    }));
  },

  // ------------------------------------------------------------
  // 時刻フォーマット（"09:30" 形式）
  // ------------------------------------------------------------
  _formatTime(start) {
    if (!start.dateTime) return '終日';
    const d = new Date(start.dateTime);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  },
};
