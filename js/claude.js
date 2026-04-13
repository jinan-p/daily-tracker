// ============================================================
// claude.js — Claude API (チャット & ルーティン自動解析)
// ============================================================

const Claude = {

  // ------------------------------------------------------------
  // チャットメッセージを送信し、ルーティン達成状況を解析
  // ------------------------------------------------------------
  async chat(userMessage, routines) {
    const apiKey = Store.get(CONFIG.LS.CLAUDE_KEY);
    if (!apiKey) throw new Error('Claude API キーが設定されていません');

    const routineNames = routines
      .filter(r => r.active)
      .map(r => `- ${r.name}（カテゴリ: ${r.category}）`)
      .join('\n');

    const systemPrompt = `あなたは日本語で話す日課管理アシスタントです。
ユーザーが今日やったことを自然な文章で教えてくれます。
以下のルーティンリストと照合して、達成されたものを特定してください。

【本日のルーティン一覧】
${routineNames || '（ルーティンなし）'}

必ず以下のJSON形式のみで返答してください（他のテキストは一切含めない）:
{
  "completed": ["達成したルーティン名1", "達成したルーティン名2"],
  "message": "ユーザーへの返信メッセージ（日本語・励ましを含む・2〜3文）"
}

ルールを必ず守ってください:
- completedには、ルーティン一覧の名前と完全一致するものだけを入れる
- 曖昧な場合は含めない
- messageは親しみやすく、ポジティブなトーンで`;

    const res = await fetch(CONFIG.CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'anthropic-dangerous-direct-browser-calls': 'true',
      },
      body: JSON.stringify({
        model: CONFIG.CLAUDE_MODEL,
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Claude APIエラー: ${res.status}`);
    }

    const data = await res.json();
    const raw  = data.content[0]?.text || '{}';

    // JSONを安全にパース
    try {
      const json = JSON.parse(raw);
      return {
        completed: Array.isArray(json.completed) ? json.completed : [],
        message:   json.message || 'ありがとうございます！記録しました。',
      };
    } catch {
      return {
        completed: [],
        message:   raw, // JSONでなければそのまま表示
      };
    }
  },
};
