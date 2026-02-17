/**
 * Cloudflare Pages Functions: V4 安全路由
 * 功能：
 * 1. GET: 自動根據環境變數產生可用模型列表。
 * 2. POST: 處理對應模型的請求轉發。
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 處理跨域與預檢 (如需要)
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // --- GET: 模型探測 ---
  if (request.method === "GET") {
    const availableModels = [];
    const caps = {
      hasGemini: !!env.GEMINI_API_KEY,
      hasCloudflare: !!env.AI,
      hasD1: !!env.DB
    };

    // 如果有 Cloudflare AI 權限，列出 CF 模型
    if (caps.hasCloudflare) {
      availableModels.push(
        { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', provider: 'cloudflare' },
        { id: '@cf/mistral/mistral-7b-instruct-v0.1', name: 'Mistral 7B', provider: 'cloudflare' },
        { id: '@cf/google/gemma-7b-it', name: 'Gemma 7B', provider: 'cloudflare' }
      );
    }

    // 如果有 Gemini Key，列出 Gemini
    if (caps.hasGemini) {
      availableModels.push({
        id: 'gemini-2.5-flash-preview-09-2025',
        name: 'Gemini 2.5 Flash',
        provider: 'google'
      });
    }

    return new Response(JSON.stringify({
      status: "ok",
      models: availableModels,
      capabilities: caps
    }), { headers: { "Content-Type": "application/json;charset=UTF-8" } });
  }

  // --- POST: 請求處理 ---
  if (request.method === "POST") {
    try {
      const { model, prompt, messages } = await request.json();

      if (model.startsWith("@cf/")) {
        const result = await env.AI.run(model, {
          messages: messages || [{ role: "user", content: prompt }]
        });
        return new Response(JSON.stringify({ result }));
      }

      if (model.includes("gemini")) {
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
        const res = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        return new Response(JSON.stringify({ 
          result: { response: data.candidates?.[0]?.content?.parts?.[0]?.text } 
        }));
      }

      return new Response("未支援的模型", { status: 400 });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 500 });
    }
  }

  return new Response("Method Not Allowed", { status: 405 });
}
