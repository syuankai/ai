/**
 * Cloudflare Pages Functions - 穩定模型白名單版
 * 只保留使用者測試通過的系列：Gemini Flash, Qwen, Llama 3.1
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
        // --- 路由 1: 獲取模型列表 (嚴格過濾版) ---
        if (path === '/api/models') {
            let allModels = [];

            // A. 動態獲取並過濾 Gemini 模型 (僅保留 Flash 系列)
            if (env.gemini_api) {
                try {
                    const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${env.gemini_api}`);
                    const gData = await gRes.json();
                    if (gData.models) {
                        const geminiModels = gData.models
                            .filter(m => 
                                m.supportedGenerationMethods.includes('generateContent') && 
                                m.name.toLowerCase().includes('flash') && // 只保留 Flash
                                !m.name.toLowerCase().includes('lite') && // 移除 Lite
                                !m.name.toLowerCase().includes('pro')     // 移除 Pro
                            )
                            .map(m => ({
                                id: m.name.split('/').pop(),
                                name: m.displayName,
                                provider: 'Google',
                                supportsImage: true
                            }));
                        allModels = [...allModels, ...geminiModels];
                    }
                } catch (e) { console.error("Gemini List Error"); }
            }

            // B. Cloudflare AI 穩定模型 (Llama 3.1 與 Qwen 系列)
            const cfStableList = [
                // Qwen 系列 (使用者確認 ✅)
                { id: '@cf/qwen/qwen1.5-7b-chat-ivq', name: 'Qwen 1.5 7B (穩定)', provider: 'Cloudflare', supportsImage: false },
                { id: '@cf/qwen/qwen1.5-1.8b-chat', name: 'Qwen 1.5 1.8B (極速)', provider: 'Cloudflare', supportsImage: false },
                { id: '@cf/qwen/qwen1.5-0.5b-chat', name: 'Qwen 1.5 0.5B (輕量)', provider: 'Cloudflare', supportsImage: false },
                
                // Llama 3.1 系列 (基於先前的成功測試)
                { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B (推薦)', provider: 'Cloudflare', supportsImage: false },
                { id: '@cf/meta/llama-3.2-3b-instruct', name: 'Llama 3.2 3B (最新)', provider: 'Cloudflare', supportsImage: false },
                { id: '@cf/meta/llama-3.2-11b-vision-instruct', name: 'Llama 3.2 11B Vision', provider: 'Cloudflare', supportsImage: true }
            ];
            allModels = [...allModels, ...cfStableList];

            return new Response(JSON.stringify({ models: allModels }), { headers: corsHeaders });
        }

        // --- 路由 2: 系統狀態 ---
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
                return new Response(JSON.stringify({ error: "已達今日系統額度上限" }), { status: 429, headers: corsHeaders });
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
                if (gRes.status === 429) throw new Error("API 請求過於頻繁 (Quota Exceeded)");
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
