// Cloudflare Pages Functions (/api/chat.js, /api/models.js etc.)
// 此範例將所有邏輯整合，實際開發應拆分為對應路徑

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // 1. 獲取模型列表 (GET /api/models)
  if (path === '/api/models') {
    const models = [
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', provider: 'Google', supportsImage: true },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', provider: 'Google', supportsImage: true },
      { id: '@cf/meta/llama-3-8b-instruct', name: 'Llama 3 8B', provider: 'Cloudflare', supportsImage: false },
      { id: '@cf/mistral/mistral-7b-instruct-v0.1', name: 'Mistral 7B', provider: 'Cloudflare', supportsImage: false }
    ];
    return Response.json({ models });
  }

  // 2. 系統狀態監控 (GET /api/stats)
  if (path === '/api/stats') {
    const today = new Date().toISOString().split('T')[0];
    const limit = parseInt(env.time_rest || '20');
    
    // 從 D1 查詢今日次數
    let count = 0;
    try {
      const result = await env.DB.prepare(
        "SELECT count FROM usage WHERE date = ? LIMIT 1"
      ).bind(today).first();
      count = result ? result.count : 0;
    } catch (e) {
      console.error('D1 query error', e);
    }

    return Response.json({
      functions: 'online',
      gemini: env.gemini_api ? 'online' : 'offline',
      d1: env.DB ? 'online' : 'offline',
      cf_ai: env.AI ? 'online' : 'offline',
      remaining_limit: Math.max(0, limit - count)
    });
  }

  // 3. 對話核心 (POST /api/chat)
  if (path === '/api/chat' && request.method === 'POST') {
    const payload = await request.json();
    const { model, messages, image, type } = payload;
    const today = new Date().toISOString().split('T')[0];

    // 權限與次數檢查
    const limit = parseInt(env.time_rest || '20');
    let usage = await env.DB.prepare("SELECT count FROM usage WHERE date = ?").bind(today).first();
    if (usage && usage.count >= limit) {
      return Response.json({ error: 'Daily limit reached' }, { status: 429 });
    }

    let aiResponse = "";

    try {
      if (type === 'Google') {
        // Gemini API 呼叫 (不透過前端，保護 Key)
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.gemini_api}`;
        
        const contents = messages.map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }]
        }));

        if (image) {
          const [mime, base64] = image.split(',');
          contents[contents.length - 1].parts.push({
            inline_data: {
              mime_type: mime.match(/:(.*?);/)[1],
              data: base64
            }
          });
        }

        const res = await fetch(geminiUrl, {
          method: 'POST',
          body: JSON.stringify({ contents })
        });
        const data = await res.json();
        aiResponse = data.candidates[0].content.parts[0].text;

      } else {
        // Cloudflare AI 呼叫
        const lastMsg = messages[messages.length - 1].content;
        const response = await env.AI.run(model, {
          messages: [{ role: 'user', content: lastMsg }]
        });
        aiResponse = response.response;
      }

      // 更新 D1 紀錄
      if (usage) {
        await env.DB.prepare("UPDATE usage SET count = count + 1 WHERE date = ?").bind(today).run();
      } else {
        await env.DB.prepare("INSERT INTO usage (date, count) VALUES (?, 1)").bind(today).run();
      }

      return Response.json({ content: aiResponse });

    } catch (err) {
      return Response.json({ error: err.message }, { status: 500 });
    }
  }

  return new Response("Not Found", { status: 404 });
}
