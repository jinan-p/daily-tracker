# Daily Tracker — セットアップガイド

初回起動時にアプリが手順を案内しますが、事前に以下の準備が必要です。

---

## 必要なもの（すべて無料または低コスト）

| 項目 | 費用 | 用途 |
|------|------|------|
| Googleアカウント | 無料 | カレンダー・スプレッドシート |
| Google Cloud プロジェクト | 無料 | OAuth認証 |
| Claude APIキー | 月数十円〜 | チャット自動解析 |
| GitHub アカウント | 無料 | アプリのホスティング |

---

## 手順 1: Google Cloud の設定（約20分）

1. https://console.cloud.google.com/ を開く
2. 画面上部「プロジェクトを選択」→「新しいプロジェクト」を作成
3. 左メニュー「APIとサービス」→「ライブラリ」
   - 「Google Sheets API」を検索 → 有効にする
   - 「Google Calendar API」を検索 → 有効にする
4. 「APIとサービス」→「OAuth同意画面」
   - ユーザーの種類：「外部」→ 作成
   - アプリ名・サポートメール入力 → 保存して次へ（スコープはスキップ）
   - テストユーザーに自分のGmailを追加
5. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuthクライアントID」
   - アプリの種類：「ウェブアプリケーション」
   - 承認済みのJavaScriptオリジン：
     - `http://localhost:8080`（ローカル確認用）
     - `https://あなたのユーザー名.github.io`（公開後に追加）
   - 作成 → **クライアントID** をコピーして保存

---

## 手順 2: Claude APIキーの取得（約5分）

1. https://console.anthropic.com/ を開く
2. アカウント作成（または既存でログイン）
3. 「API Keys」→「Create Key」
4. **APIキー**をコピーして安全な場所に保存
   - 例：メモ帳、パスワードマネージャー

> 💡 使用モデルは `claude-haiku`（最安モデル）なので、1日10回程度のチャットで月数十円程度です。

---

## 手順 3: GitHub Pages に公開（約10分）

1. https://github.com/ でアカウント作成（または既存でログイン）
2. 「New repository」→ リポジトリ名を入力（例：`daily-tracker`）→ Public → 作成
3. このフォルダ内のファイルをすべてアップロード
   - GitHubのリポジトリページ →「Add file」→「Upload files」
   - `index.html`, `css/`, `js/` フォルダをドラッグ＆ドロップ
4. 「Settings」→「Pages」→ Source: `main branch` → 保存
5. 数分後に `https://あなたのユーザー名.github.io/daily-tracker/` でアクセス可能

> 🔒 `.gitignore` に記載の通り、APIキーはコードに含まれないため、GitHubにアップロードしても安全です。

---

## 手順 4: 新しいPCへの移行

1. 同じGitHub PagesのURLをブラウザで開く
2. 保存しておいたAPIキー類を入力するだけ！（所要時間：約2分）

---

## ローカルで確認する場合

ファイルをダブルクリックして開くと一部の機能が動作しない場合があります。
以下のコマンドで簡易サーバーを起動してください（Pythonが必要）：

```bash
cd routine-app
python3 -m http.server 8080
```

ブラウザで `http://localhost:8080` を開く。

---

## データについて

- すべての記録は **あなた自身のGoogleスプレッドシート** に保存されます
- APIキーはあなたのブラウザにのみ保存されます
- このアプリはどこのサーバーにもあなたのデータを送信しません
