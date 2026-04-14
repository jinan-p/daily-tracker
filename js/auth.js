// ============================================================
// auth.js — Google OAuth 2.0 (Google Identity Services)
// ============================================================

const Auth = {
  tokenClient: null,
  accessToken: null,
  _pendingToken: null,

  // ------------------------------------------------------------
  // 初期化：Google Identity Services のクライアントを作る
  // ------------------------------------------------------------
  init() {
    const clientId = Store.get(CONFIG.LS.CLIENT_ID);
    if (!clientId) return;

    // 保存済みトークンがあれば復元
    const saved = Store.get(CONFIG.LS.ACCESS_TOKEN);
    const exp   = parseInt(Store.get(CONFIG.LS.TOKEN_EXP) || '0', 10);
    if (saved && Date.now() < exp) {
      this.accessToken = saved;
    }

    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: CONFIG.SCOPES,
      callback: (response) => {
        if (response.error) {
          console.error('OAuth error:', response);
          Auth._onError(response.error);
          return;
        }
        Auth.accessToken = response.access_token;
        // 有効期限を保存（1時間）
        Store.set(CONFIG.LS.ACCESS_TOKEN, response.access_token);
        Store.set(CONFIG.LS.TOKEN_EXP, Date.now() + (response.expires_in - 60) * 1000);
        Auth._onSuccess(response);
      },
    });
  },

  // ------------------------------------------------------------
  // サインイン（ポップアップ表示）
  // ------------------------------------------------------------
  signIn(onSuccess, onError) {
    this._onSuccess = onSuccess || (() => {});
    this._onError   = onError   || (() => {});

    if (!this.tokenClient) {
      onError('Google Client ID が設定されていません');
      return;
    }

    if (this.accessToken && !this.isExpired()) {
      // すでに有効なトークンがある
      onSuccess({ access_token: this.accessToken });
      return;
    }

    this.tokenClient.requestAccessToken({ prompt: '' });
  },

  // ------------------------------------------------------------
  // トークンが期限切れかチェック
  // ------------------------------------------------------------
  isExpired() {
    const exp = parseInt(Store.get(CONFIG.LS.TOKEN_EXP) || '0', 10);
    return Date.now() >= exp;
  },

  // ------------------------------------------------------------
  // アクセストークンを取得（期限切れなら再認証、並列呼び出し対応）
  // ------------------------------------------------------------
  getToken() {
    if (this.accessToken && !this.isExpired()) {
      return Promise.resolve(this.accessToken);
    }
    // 既に取得中なら同じPromiseを返す（並列リクエストの競合を防ぐ）
    if (!this._pendingToken) {
      this._pendingToken = new Promise((resolve, reject) => {
        this.signIn(
          (res) => { this._pendingToken = null; resolve(res.access_token); },
          (err) => { this._pendingToken = null; reject(err); },
        );
      });
    }
    return this._pendingToken;
  },

  // ------------------------------------------------------------
  // サインアウト
  // ------------------------------------------------------------
  signOut() {
    if (this.accessToken) {
      google.accounts.oauth2.revoke(this.accessToken);
    }
    this.accessToken = null;
    Store.del(CONFIG.LS.ACCESS_TOKEN);
    Store.del(CONFIG.LS.TOKEN_EXP);
  },

  // プレースホルダー（init後に上書きされる）
  _onSuccess: () => {},
  _onError:   () => {},
};
