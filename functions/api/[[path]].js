/**
 * Cloudflare Pages Functions - 穩定版 API 網關
 */

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    
    const rawKey = request.headers.get("x-custom-api-key");
    const corsHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-custom-api-key",
        "Content-Type": "application/json",
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

    // 智能辨識供應商
    const identifyProvider = (key) => {
        if (!key) return null;
        if (key.startsWith('AIza')) return 'Google';
        if (key.startsWith('sk-')) return 'OpenAI'; 
        return null;
    };

    const provider = identifyProvider(rawKey);
    const effectiveKey = rawKey || env.gemini_api;
    const effectiveProvider = rawKey ? provider : 'Google';

    try {
        // --- 獲取模型清單 (嚴格過濾) ---
        if (path === '/api/models') {
            let finalModels = [];

            // 1. 系統預設模型 (Qwen)
            finalModels.push({ id: '@cf/qwen/qwen1.5-7b-chat-awq', name: 'Qwen 1.5 (系統)', provider: 'Cloudflare' });

            // 2. 外部 API 模型
            if (effectiveProvider === 'Google' && effectiveKey) {
                const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${effectiveKey}`);
                const data = await res.json();
                
                if (data.models) {
                    const filtered = data.models
                        .filter(m => {
                            const id = m.name.toLowerCase();
                            // 嚴格過濾邏輯
                            const isFlash = id.includes('flash') && !id.includes('lite');
                            const isNanoBanana = id.includes('gemini-2.5-flash-image-preview'); // nano-banana
                            const isForbidden = id.includes('pro') || id.includes('research') || id.includes('vision') || id.includes('lite');
                            
                            return (isFlash || isNanoBanana) && !isForbidden;
                        })
                        .map(m => ({
                            id: m.name.split('/').pop(),
                            name: m.name.includes('2.5-flash-image') ? 'Nano Banana ⚠️' : m.displayName.replace('Gemini ', 'Flash '),
                            provider: 'Google'
                        }));
                    finalModels.push(...filtered);
                }
            }

            return new Response(JSON.stringify({ models: finalModels }), { headers: corsHeaders });
        }

        // --- 聊天轉發 ---
        if (path === '/api/chat') {
            const body = await request.json();
            const { model, messages, provider: reqProvider } = body;
            const lastMessage = messages[messages.length - 1].content;

            // Google Gemini 請求格式
            if (reqProvider === 'Google' || (effectiveProvider === 'Google' && !reqProvider)) {
                const gRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveKey}`, {
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

            // Cloudflare AI (Qwen) 請求格式
            if (reqProvider === 'Cloudflare') {
                const cfRes = await env.AI.run(model, {
                    messages: messages.map(m => ({ role: m.role, content: m.content }))
                });
                return new Response(JSON.stringify({ content: cfRes.response }), { headers: corsHeaders });
            }
        }
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
            }
