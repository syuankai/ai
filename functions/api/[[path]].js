/**
 * Cloudflare Pages Functions - 旗艦版 API 網關
 */

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 優先權：Header 自定義 Key > 環境變數 Key
    const customKey = request.headers.get("x-custom-api-key");
    const effectiveKey = customKey || env.gemini_api_key;
    const aiProxy = env.ai_proxy || ""; 

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-custom-api-key",
        "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // 處理代理邏輯
    const wrapUrl = (targetUrl) => {
        if (!aiProxy) return targetUrl;
        const target = new URL(targetUrl);
        // 如果 aiProxy 結尾有 / 則去掉，並拼接目標路徑與參數
        return `${aiProxy.replace(/\/$/, '')}${target.pathname}${target.search}`;
    };

    try {
        // --- 模型清單路由 ---
        if (path === '/api/models') {
            let modelList = [
                // 系統推薦模型 (Cloudflare Workers AI 託管)
                { id: '@cf/meta/llama-3.3-70b-instruct', name: 'Llama 3.3 (70B)', tag: '推薦 ✅', provider: 'Cloudflare' },
                { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 (Qwen)', tag: '推薦 ✅', provider: 'Cloudflare' },
                { id: '@cf/qwen/qwen2.5-7b-instruct', name: 'Qwen 2.5 (7B)', tag: '輕量 🍃', provider: 'Cloudflare' },
                { id: '@cf/google/gemma-2-9b-it', name: 'Gemma 2 (9B)', tag: '快速 ⚡', provider: 'Cloudflare' },
                { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 (8B)', tag: '輕量 🍃', provider: 'Cloudflare' }
            ];

            // 只有在環境變數或使用者提供 Key 的情況下才加載 Gemini
            if (effectiveKey) {
                const gUrl = wrapUrl(`https://generativelanguage.googleapis.com/v1beta/models?key=${effectiveKey}`);
                const gRes = await fetch(gUrl);
                const gData = await gRes.json();
                
                if (gData.models) {
                    const geminiModels = gData.models
                        .filter(m => {
                            const name = m.name.toLowerCase();
                            // 嚴格篩選：必須含 flash，排除 pro, lite, research, vision
                            const isFlash = name.includes('flash');
                            const isForbidden = name.includes('pro') || name.includes('lite') || name.includes('research') || name.includes('vision');
                            return isFlash && !isForbidden;
                        })
                        .map(m => {
                            const shortId = m.name.split('/').pop();
                            let tag = '推薦 ✅';
                            if (shortId.includes('2.0')) tag = '快速 ⚡';
                            if (shortId.includes('experimental')) tag = '不建議 ⚠️';
                            
                            return {
                                id: shortId,
                                name: m.displayName.replace('Gemini ', 'Flash '),
                                tag: tag,
                                provider: 'Google'
                            };
                        });
                    modelList.push(...geminiModels);
                }
            }
            return new Response(JSON.stringify({ models: modelList }), { headers: corsHeaders });
        }

        // --- 對話轉發路由 ---
        if (path === '/api/chat') {
            const body = await request.json();
            const { model, messages, provider: reqProvider } = body;

            if (reqProvider === 'Google') {
                const gChatUrl = wrapUrl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveKey}`);
                const gRes = await fetch(gChatUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: messages.map(m => ({
                            role: m.role === 'assistant' ? 'model' : 'user',
                            parts: [{ text: m.content }]
                        }))
                    })
                });
                const data = await gRes.json();
                if (data.error) throw new Error(data.error.message);
                return new Response(JSON.stringify({ content: data.candidates[0].content.parts[0].text }), { headers: corsHeaders });
            }

            if (reqProvider === 'Cloudflare') {
                const cfRes = await env.AI.run(model, {
                    messages: messages.map(m => ({ role: m.role, content: m.content }))
                });
                return new Response(JSON.stringify({ content: cfRes.response }), { headers: corsHeaders });
            }
        }
    } catch (e) {
        return new Response(JSON.stringify({ error: "代理連線或模型調用異常: " + e.message }), { status: 500, headers: corsHeaders });
    }
}
