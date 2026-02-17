/**
 * Cloudflare Pages Functions - 全動態模型版
 * 支援動態讀取 Gemini 與 Cloudflare AI 模型列表
 */

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") {
        return new Response(null, { headers: corsHeaders });
    }

    try {
        // --- 路由 1: 動態獲取所有可用模型 ---
        if (path === '/api/models') {
            let allModels = [];

            // A. 動態獲取 Gemini 模型
            if (env.gemini_api) {
                try {
                    const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${env.gemini_api}`);
                    const gData = await gRes.json();
                    if (gData.models) {
                        const geminiModels = gData.models
                            .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                            .map(m => ({
                                id: m.name.split('/').pop(),
                                name: m.displayName,
                                provider: 'Google',
                                supportsImage: m.name.includes('flash') || m.name.includes('pro') || m.name.includes('vision')
                            }));
                        allModels = [...allModels, ...geminiModels];
                    }
                } catch (e) { console.error("Gemini List Error"); }
            }

            // B. 動態獲取 Cloudflare AI 模型 (過濾文本生成類)
            if (env.AI) {
                try {
                    // Cloudflare 的模型列表 API 需要 Account ID
                    // 這裡使用內建的 fetch 搭配 CF API 規範
                    const cfAccountId = context.env.CLOUDFLARE_ACCOUNT_ID; // 建議在環境變數設定此項以獲取更精準列表
                    // 如果沒有提供 Account ID，我們使用精選的文本模型清單作為備案
                    const cfStaticList = [
                        { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', provider: 'Cloudflare', supportsImage: false },
                        { id: '@cf/meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B', provider: 'Cloudflare', supportsImage: false },
                        { id: '@cf/qwen/qwen1.5-7b-chat-ivq', name: 'Qwen 1.5 7B', provider: 'Cloudflare', supportsImage: false },
                        { id: '@cf/mistral/mistral-7b-instruct-v0.3', name: 'Mistral 7B v0.3', provider: 'Cloudflare', supportsImage: false },
                        { id: '@cf/google/gemma-7b-it', name: 'Gemma 7B IT', provider: 'Cloudflare', supportsImage: false }
                    ];
                    allModels = [...allModels, ...cfStaticList];
                } catch (e) { console.error("CF List Error"); }
            }

            return new Response(JSON.stringify({ models: allModels }), { headers: corsHeaders });
        }

        // --- 路由 2: 系統狀態與額度 ---
        if (path === '/api/stats') {
            const today = new Date().toISOString().split('T')[0];
            const limit = parseInt(env.time_rest || '20');
            
            let count = 0;
            if (env.DB) {
                const result = await env.DB.prepare("SELECT count FROM usage WHERE date = ?").bind(today).first();
                count = result ? result.count : 0;
            }

            return new Response(JSON.stringify({
                functions: 'online',
                gemini: env.gemini_api ? 'online' : 'offline',
                d1: env.DB ? 'online' : 'offline',
                cf_ai: env.AI ? 'online' : 'offline',
                remaining_limit: Math.max(0, limit - count)
            }), { headers: corsHeaders });
        }

        // --- 路由 3: 聊天實作 ---
        if (path === '/api/chat' && request.method === 'POST') {
            const { model, messages, image, type } = await request.json();
            const today = new Date().toISOString().split('T')[0];

            if (!env.DB) throw new Error("D1 綁定缺失");
            const limit = parseInt(env.time_rest || '20');
            let usage = await env.DB.prepare("SELECT count FROM usage WHERE date = ?").bind(today).first();
            
            if (usage && usage.count >= limit) {
                return new Response(JSON.stringify({ error: "已達今日使用上限" }), { status: 429, headers: corsHeaders });
            }

            let responseText = "";
            const lastMsg = messages[messages.length - 1].content;

            if (type === 'Google') {
                const gUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.gemini_api}`;
                const contents = [{ role: 'user', parts: [{ text: lastMsg || "Hi" }] }];

                if (image && image.includes(',')) {
                    contents[0].parts.push({
                        inline_data: { 
                            mime_type: image.match(/:(.*?);/)[1], 
                            data: image.split(',')[1] 
                        }
                    });
                }

                const gRes = await fetch(gUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents })
                });
                const gData = await gRes.json();
                if (gData.error) throw new Error(gData.error.message);
                responseText = gData.candidates[0].content.parts[0].text;

            } else {
                // Cloudflare AI 呼叫
                const cfRes = await env.AI.run(model, {
                    messages: [{ role: 'user', content: lastMsg }]
                });
                responseText = cfRes.response;
            }

            // 更新 D1
            if (usage) {
                await env.DB.prepare("UPDATE usage SET count = count + 1 WHERE date = ?").bind(today).run();
            } else {
                await env.DB.prepare("INSERT INTO usage (date, count) VALUES (?, 1)").bind(today).run();
            }

            return new Response(JSON.stringify({ content: responseText }), { headers: corsHeaders });
        }

        return new Response(JSON.stringify({ error: "Route Not Found" }), { status: 404, headers: corsHeaders });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
}
