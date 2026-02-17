/**
 * Cloudflare Pages Functions - 旗艦動態版
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
        // --- 路由 1: 動態獲取模型列表 ---
        if (path === '/api/models') {
            let allModels = [];

            // A. 獲取 Gemini 模型 (動態)
            if (env.gemini_api) {
                try {
                    const gListUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${env.gemini_api}`;
                    const gRes = await fetch(gListUrl);
                    const gData = await gRes.json();
                    
                    if (gData.models) {
                        const geminiModels = gData.models
                            .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                            .map(m => ({
                                id: m.name.split('/').pop(),
                                name: m.displayName,
                                provider: 'Google',
                                // 自動判斷是否支援圖片
                                supportsImage: m.displayName.toLowerCase().includes('vision') || 
                                               m.name.toLowerCase().includes('flash') || 
                                               m.name.toLowerCase().includes('pro')
                            }));
                        allModels = [...allModels, ...geminiModels];
                    }
                } catch (e) {
                    console.error("Gemini list error", e);
                }
            }

            // B. 獲取 Cloudflare 模型 (精選列表)
            const cfModels = [
                { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', provider: 'Cloudflare', supportsImage: false },
                { id: '@cf/meta/llama-3.1-70b-instruct', name: 'Llama 3.1 70B (High Perf)', provider: 'Cloudflare', supportsImage: false },
                { id: '@cf/qwen/qwen1.5-14b-chat-cpq', name: 'Qwen 1.5 14B', provider: 'Cloudflare', supportsImage: false },
                { id: '@cf/mistral/mistral-7b-instruct-v0.3', name: 'Mistral 7B v0.3', provider: 'Cloudflare', supportsImage: false },
                { id: '@cf/google/gemma-7b-it', name: 'Gemma 7B IT', provider: 'Cloudflare', supportsImage: false },
                { id: '@cf/microsoft/phi-2', name: 'Microsoft Phi-2', provider: 'Cloudflare', supportsImage: false }
            ];
            
            allModels = [...allModels, ...cfModels];

            return new Response(JSON.stringify({ models: allModels }), { headers: corsHeaders });
        }

        // --- 路由 2: 查詢系統狀態 ---
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

        // --- 路由 3: 處理聊天請求 ---
        if (path === '/api/chat' && request.method === 'POST') {
            const { model, messages, image, type } = await request.json();
            const today = new Date().toISOString().split('T')[0];

            if (!env.DB) throw new Error("D1 綁定未設定");
            const limit = parseInt(env.time_rest || '20');
            let usage = await env.DB.prepare("SELECT count FROM usage WHERE date = ?").bind(today).first();
            
            if (usage && usage.count >= limit) {
                return new Response(JSON.stringify({ error: "已達今日使用上限" }), { status: 429, headers: corsHeaders });
            }

            let responseText = "";
            const lastUserMessage = messages[messages.length - 1].content;

            if (type === 'Google') {
                const googleUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.gemini_api}`;
                
                const contents = [{
                    role: 'user',
                    parts: [{ text: lastUserMessage || "Hello" }]
                }];

                if (image && image.includes(',')) {
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
                if (!env.AI) throw new Error("Workers AI 綁定未設定");
                const cfRes = await env.AI.run(model, {
                    messages: [{ role: 'user', content: lastUserMessage }]
                });
                responseText = cfRes.response;
            }

            // 更新使用次數
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
