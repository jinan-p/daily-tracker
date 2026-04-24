// ============================================================
// config.js — アプリの定数・設定
// ============================================================

const CONFIG = {
  // Google API スコープ
  SCOPES: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/calendar.readonly',
    'email',
    'profile',
  ].join(' '),

  // Google API エンドポイント
  SHEETS_BASE:   'https://sheets.googleapis.com/v4/spreadsheets',
  CALENDAR_BASE: 'https://www.googleapis.com/calendar/v3',

  // スプレッドシートのシート名
  SHEET: {
    ROUTINES: 'Routines',
    TIMELINE: 'Timeline',
  },

  // localStorage キー
  LS: {
    CLIENT_ID:    'dt_google_client_id',
    SHEET_ID:     'dt_sheet_id',
    ACCESS_TOKEN: 'dt_access_token',
    TOKEN_EXP:    'dt_token_exp',
    USER_NAME:    'dt_user_name',
    USER_EMAIL:   'dt_user_email',
    SETUP_DONE:   'dt_setup_done',
    MEMO:         'dt_memo',
    PRESETS:      'dt_presets',
    MIGRATED_V2:  'dt_migrated_v2',
    MIGRATED_V4:  'dt_migrated_v4',
    MIGRATED_V5:  'dt_migrated_v5',
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
