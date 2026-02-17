/**
 * Cloudflare Pages Functions - 智能供應商辨識網關
 */

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    
    // 從 Header 取得統一密鑰
    const rawKey = request.headers.get("x-custom-api-key");
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "aGET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-custom-api-key",
        "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // 智能辨識供應商函數
    const identifyProvider = (key) => {
        if (!key) return null;
        if (key.startsWith('AIza')) return 'Google';
        if (key.startsWith('sk-ant-')) return 'Anthropic'; // 預留
        if (key.startsWith('sk-')) {
            // 簡單判斷：sk- 可能是 OpenAI 或 DeepSeek，這裡我們先嘗試 OpenAI 格式
            return 'OpenAI'; 
        }
        return null;
    };

    try {
        const provider = identifyProvider(rawKey);

        // --- 獲取模型清單 ---
        if (path === '/api/models') {
            let models = [
                { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 (系統)', provider: 'Cloudflare' }
            ];

            const effectiveKey = rawKey || env.gemini_api;
            const effectiveProvider = rawKey ? provider : 'Google';

            if (effectiveProvider === 'Google' && effectiveKey) {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${effectiveKey}`);
                const data = await res.json();
                if (data.models) {
                    models.push(...data.models.filter(m => m.supportedGenerationMethods.includes('generateContent'))
                        .map(m => ({ id: m.name.split('/').pop(), name: `${m.displayName} ${rawKey ? '(自定義)' : ''}`, provider: 'Google' })));
                }
            } else if (effectiveProvider === 'OpenAI') {
                // 如果是 sk-，同時嘗試獲取 OpenAI 相容格式的模型清單
                const res = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${rawKey}` }});
                const data = await res.json();
                if (data.data) {
                    models.push(...data.data.map(m => ({ id: m.id, name: `${m.id} (自定義)`, provider: 'OpenAI' })));
                }
            }

            return new Response(JSON.stringify({ models, identifiedProvider: provider }), { headers: corsHeaders });
        }

        // --- 聊天轉發 ---
        if (path === '/api/chat') {
            const body = await request.json();
            const { model, messages, provider: reqProvider } = body;
            const lastMsg = messages[messages.length - 1].content;
            
            const effectiveKey = rawKey || env.gemini_api;
            const targetProvider = rawKey ? provider : reqProvider;

            if (targetProvider === 'Google') {
                const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveKey}`, {
                    method: 'POST',
                    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: lastMsg }] }] })
                });
                const data = await gRes.json();
                if (data.error) throw new Error(data.error.message);
                return new Response(JSON.stringify({ content: data.candidates[0].content.parts[0].text }), { headers: corsHeaders });
            } 
            
            if (targetProvider === 'OpenAI') {
                // 同時相容 DeepSeek 節點 (如果使用者輸入的是 DeepSeek Key)
                const baseUrl = rawKey.includes('sk-') && !model.includes('gpt') ? 'https://api.deepseek.com' : 'https://api.openai.com/v1';
                const oRes = await fetch(`${baseUrl}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${rawKey}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model, messages: [{ role: 'user', content: lastMsg }] })
                });
                const data = await oRes.json();
                return new Response(JSON.stringify({ content: data.choices[0].message.content }), { headers: corsHeaders });
            }

            // Fallback Cloudflare
            const cfRes = await env.AI.run(model, { messages: [{ role: 'user', content: lastMsg }] });
            return new Response(JSON.stringify({ content: cfRes.response }), { headers: corsHeaders });
        }
    } catch (e) {
        return new Response(JSON.stringify({ error: "請使用合法的 API Key 或 AI 暫時不再支援的模型: " + e.message }), { status: 500, headers: corsHeaders });
    }
}
