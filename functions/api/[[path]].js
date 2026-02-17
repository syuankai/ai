/**
 * Cloudflare Pages Functions
 * 處理 /api/models, /api/stats, /api/chat
 */

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS Headers
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        // 1. 模型列表介面
        if (path === '/api/models') {
            const models = [
                { id: 'gemini-1.5-flash-latest', name: 'Gemini 1.5 Flash', provider: 'Google', supportsImage: true },
                { id: 'gemini-1.5-pro-latest', name: 'Gemini 1.5 Pro', provider: 'Google', supportsImage: true },
                { id: '@cf/meta/llama-3-8b-instruct', name: 'Llama 3 8B (CF)', provider: 'Cloudflare', supportsImage: false },
                { id: '@cf/qwen/qwen1.5-14b-chat', name: 'Qwen 14B (CF)', provider: 'Cloudflare', supportsImage: false }
            ];
            return Response.json({ models }, { headers: corsHeaders });
        }

        // 2. 真實狀態顯示 (D1 / API / AI)
        if (path === '/api/stats') {
            const today = new Date().toISOString().split('T')[0];
            const limit = parseInt(env.time_rest || '20');
            
            let count = 0;
            if (env.DB) {
                const result = await env.DB.prepare("SELECT count FROM usage WHERE date = ?").bind(today).first();
                count = result ? result.count : 0;
            }

            return Response.json({
                functions: 'online',
                gemini: env.gemini_api ? 'online' : 'offline',
                d1: env.DB ? 'online' : 'offline',
                cf_ai: env.AI ? 'online' : 'offline',
                remaining_limit: Math.max(0, limit - count)
            }, { headers: corsHeaders });
        }

        // 3. 核心聊天與 D1 紀錄
        if (path === '/api/chat' && request.method === 'POST') {
            const { model, messages, image, type } = await request.json();
            const today = new Date().toISOString().split('T')[0];

            // 檢查次數
            const limit = parseInt(env.time_rest || '20');
            let usage = await env.DB.prepare("SELECT count FROM usage WHERE date = ?").bind(today).first();
            if (usage && usage.count >= limit) {
                return Response.json({ error: "已達今日使用上限" }, { status: 429, headers: corsHeaders });
            }

            let responseText = "";

            if (type === 'Google') {
                if (!env.gemini_api) throw new Error("Gemini API Key 未設定");
                
                const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.gemini_api}`;
                const contents = [{
                    role: 'user',
                    parts: [{ text: messages[messages.length - 1].content }]
                }];

                if (image) {
                    const mime = image.match(/:(.*?);/)[1];
                    const base64Data = image.split(',')[1];
                    contents[0].parts.push({
                        inline_data: { mime_type: mime, data: base64Data }
                    });
                }

                const gRes = await fetch(googleUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents })
                });
                
                const gData = await gRes.json();
                if (gData.error) throw new Error(gData.error.message);
                responseText = gData.candidates[0].content.parts[0].text;

            } else {
                // Cloudflare AI
                const cfRes = await env.AI.run(model, {
                    messages: [{ role: 'user', content: messages[messages.length - 1].content }]
                });
                responseText = cfRes.response;
            }

            // 更新 D1
            if (usage) {
                await env.DB.prepare("UPDATE usage SET count = count + 1 WHERE date = ?").bind(today).run();
            } else {
                await env.DB.prepare("INSERT INTO usage (date, count) VALUES (?, 1)").bind(today).run();
            }

            return Response.json({ content: responseText }, { headers: corsHeaders });
        }

        return new Response("Not Found", { status: 404, headers: corsHeaders });

    } catch (err) {
        return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
    }
}
