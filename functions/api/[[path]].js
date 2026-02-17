/**
 * Cloudflare Pages Functions - 通用 AI 網關
 */

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    // 從 Header 讀取自定義金鑰
    const userKeys = {
        gemini: request.headers.get("x-key-gemini"),
        openai: request.headers.get("x-key-openai"),
        deepseek: request.headers.get("x-key-deepseek"),
        qwen: request.headers.get("x-key-qwen")
    };

    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-key-gemini, x-key-openai, x-key-deepseek, x-key-qwen",
        "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    try {
        // --- 路由 1: 獲取模型列表 (包含各供應商) ---
        if (path === '/api/models') {
            let allModels = [];

            // 1. Gemini
            const geminiKey = userKeys.gemini || env.gemini_api;
            if (geminiKey) {
                try {
                    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
                    const data = await res.json();
                    if (data.models) {
                        allModels.push(...data.models
                            .filter(m => m.supportedGenerationMethods.includes('generateContent'))
                            .map(m => ({ id: m.name.split('/').pop(), name: m.displayName, provider: 'Google', isCustom: !!userKeys.gemini })));
                    }
                } catch (e) {}
            }

            // 2. OpenAI / DeepSeek (基於 OpenAI 格式)
            const providers = [
                { name: 'OpenAI', key: userKeys.openai, url: 'https://api.openai.com/v1/models' },
                { name: 'DeepSeek', key: userKeys.deepseek, url: 'https://api.deepseek.com/models' }
            ];

            for (const p of providers) {
                if (p.key) {
                    try {
                        const res = await fetch(p.url, { headers: { 'Authorization': `Bearer ${p.key}` } });
                        const data = await res.json();
                        if (data.data) {
                            allModels.push(...data.data.map(m => ({ id: m.id, name: `${p.name} ${m.id}`, provider: p.name, isCustom: true })));
                        }
                    } catch (e) {}
                }
            }

            // 3. 預設 Cloudflare 模型
            allModels.push(
                { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', provider: 'Cloudflare', isCustom: false },
                { id: '@cf/qwen/qwen1.5-7b-chat-ivq', name: 'Qwen 1.5 7B', provider: 'Cloudflare', isCustom: false }
            );

            return new Response(JSON.stringify({ models: allModels }), { headers: corsHeaders });
        }

        // --- 路由 2: 聊天請求 ---
        if (path === '/api/chat' && request.method === 'POST') {
            const { model, messages, provider, image } = await request.json();
            const lastMsg = messages[messages.length - 1].content;

            // 如果使用系統預設且有 D1，執行次數限制
            const isUsingCustom = !!userKeys[provider?.toLowerCase()];
            if (!isUsingCustom && env.DB && provider === 'Google') {
                const today = new Date().toISOString().split('T')[0];
                let usage = await env.DB.prepare("SELECT count FROM usage WHERE date = ?").bind(today).first();
                if (usage && usage.count >= parseInt(env.time_rest || '20')) {
                    return new Response(JSON.stringify({ error: "系統額度耗盡，請填寫您的 API Key" }), { status: 429, headers: corsHeaders });
                }
                if (usage) await env.DB.prepare("UPDATE usage SET count = count + 1 WHERE date = ?").bind(today).run();
                else await env.DB.prepare("INSERT INTO usage (date, count) VALUES (?, 1)").bind(today).run();
            }

            let resultText = "";

            try {
                if (provider === 'Google') {
                    const key = userKeys.gemini || env.gemini_api;
                    const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
                        method: 'POST',
                        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: lastMsg }] }] })
                    });
                    const gData = await gRes.json();
                    resultText = gData.candidates[0].content.parts[0].text;
                } 
                else if (provider === 'OpenAI' || provider === 'DeepSeek') {
                    const config = {
                        OpenAI: { key: userKeys.openai, url: 'https://api.openai.com/v1/chat/completions' },
                        DeepSeek: { key: userKeys.deepseek, url: 'https://api.deepseek.com/chat/completions' }
                    }[provider];
                    
                    const res = await fetch(config.url, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${config.key}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model, messages: [{ role: 'user', content: lastMsg }] })
                    });
                    const data = await res.json();
                    resultText = data.choices[0].message.content;
                }
                else {
                    // Cloudflare
                    const cfRes = await env.AI.run(model, { messages: [{ role: 'user', content: lastMsg }] });
                    resultText = cfRes.response;
                }
            } catch (e) {
                throw new Error("請使用合法的 API Key 或 AI 暫時不再支援的模型");
            }

            return new Response(JSON.stringify({ content: resultText, modelUsed: model }), { headers: corsHeaders });
        }

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
}
