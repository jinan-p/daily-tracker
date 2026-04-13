// ============================================================
// config.js — アプリの定数・設定
// ============================================================

const CONFIG = {
  // Claude API
  CLAUDE_MODEL: 'claude-haiku-4-5-20251001',
  CLAUDE_API_URL: 'https://api.anthropic.com/v1/messages',

  // Google API スコープ
  SCOPES: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/calendar.readonly',
    'email',
    'profile',
  ].join(' '),

  // Google API エンドポイント
  SHEETS_BASE: 'https://sheets.googleapis.com/v4/spreadsheets',
  CALENDAR_BASE: 'https://www.googleapis.com/calendar/v3',

  // スプレッドシートのシート名
  SHEET: {
    ROUTINES: 'Routines',
    DAILY_LOG: 'DailyLog',
    MANUAL_TASKS: 'ManualTasks',
    SELF_EVAL: 'SelfEval',
  },

  // localStorage キー（APIキーは絶対にGitHubにpushしない）
  LS: {
    CLIENT_ID:    'dt_google_client_id',
    SHEET_ID:     'dt_sheet_id',
    CLAUDE_KEY:   'dt_claude_api_key',
    ACCESS_TOKEN: 'dt_access_token',
    TOKEN_EXP:    'dt_token_exp',
    USER_NAME:    'dt_user_name',
    USER_EMAIL:   'dt_user_email',
    SETUP_DONE:   'dt_setup_done',
  },
};

// ============================================================
// ローカルストレージ ヘルパー
// ============================================================
const Store = {
  get(key)        { return localStorage.getItem(key); },
  set(key, value) { localStorage.setItem(key, value); },
  del(key)        { localStorage.removeItem(key); },
  clear()         {
    Object.values(CONFIG.LS).forEach(k => localStorage.removeItem(k));
  },
};
