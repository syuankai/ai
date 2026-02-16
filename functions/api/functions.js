/**
 * Cloudflare Pages Functions: AI 後端控制中心
 * 處理健康檢查、環境變數監測以及 API 請求轉發
 */

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // 1. 處理 GET 請求：回傳 API 狀態 (健康檢查)
  if (request.method === "GET") {
    try {
      // 檢查環境變數是否存在
      const hasGemini = !!env.GEMINI_API_KEY;
      const hasCfAI = !!env.AI;
      const hasD1 = !!env.DB; // 假設 D1 綁定名稱為 DB

      return new Response(
        JSON.stringify({
          status: "ok",
          services: {
            gemini: hasGemini ? "ok" : "error",
            cloudflare: hasCfAI ? "ok" : "error",
            functions: "ok",
            d1: hasD1 ? "ok" : "error"
          },
          config: {
            // 只回傳是否設定，不回傳真實金鑰以策安全
            has_gemini_key: hasGemini,
            has_cf_binding: hasCfAI
          }
        }),
        {
          headers: { "Content-Type": "application/json;charset=UTF-8" },
        }
      );
    } catch (error) {
      return new Response(JSON.stringify({ status: "error", message: error.message }), { status: 500 });
    }
  }

  // 2. 處理 POST 請求：執行 AI 任務
  if (request.method === "POST") {
    try {
      const body = await request.json();
      const { model, prompt, messages } = body;

      // 判斷路由：Cloudflare Workers AI
      if (model.startsWith("@cf/")) {
        if (!env.AI) throw new Error("Cloudflare AI 綁定未設定");

        // 執行 Cloudflare Workers AI
        const aiResponse = await env.AI.run(model, {
          messages: messages || [{ role: "user", content: prompt }]
        });

        return new Response(JSON.stringify({ result: aiResponse }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      // 判斷路由：Google Gemini
      if (model.includes("gemini")) {
        if (!env.GEMINI_API_KEY) throw new Error("Gemini API Key 未在環境變數中設定");

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;
        
        const geminiRes = await fetch(geminiUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
          })
        });

        if (!geminiRes.ok) {
          const errData = await geminiRes.json();
          throw new Error(`Gemini API 錯誤: ${errData.error?.message || "未知錯誤"}`);
        }

        const geminiData = await geminiRes.json();
        const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

        return new Response(JSON.stringify({ result: { response: text } }), {
          headers: { "Content-Type": "application/json" }
        });
      }

      throw new Error("未支援的模型類型");

    } catch (error) {
      return new Response(
        JSON.stringify({ status: "error", message: error.message }), 
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // 3. 處理其他不支援的 Method
  return new Response("Method Not Allowed", { status: 405 });
}

/**
 * 輔助函式：實作簡單的 D1 儲存邏輯 (可根據需求在 POST 中調用)
 */
async function saveToD1(env, userId, role, content) {
  if (env.DB) {
    await env.DB.prepare(
      "INSERT INTO chat_history (user_id, role, content, created_at) VALUES (?, ?, ?, datetime('now'))"
    ).bind(userId, role, content).run();
  }
}
