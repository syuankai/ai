/**
 * Cloudflare Pages Functions + D1 Database
 */

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const path = url.pathname;
    
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

    const wrapUrl = (targetUrl) => {
        if (!aiProxy) return targetUrl;
        return `${aiProxy.replace(/\/$/, '')}${new URL(targetUrl).pathname}${new URL(targetUrl).search}`;
    };

    try {
        // --- 狀態監測 ---
        if (path === '/api/status') {
            const status = {
                functions: "正常 ✅",
                d1: env.DB ? "已連接 ✅" : "未配置 ❌",
                gemini: effectiveKey ? "已授權 ✅" : "未設定 ⚠️",
                cf_ai: env.AI ? "運作中 ✅" : "異常 ❌"
            };
            return new Response(JSON.stringify(status), { headers: corsHeaders });
        }

        // --- D1 設定儲存 ---
        if (path === '/api/settings' && request.method === 'POST') {
            const { userId, heroText, apiKey } = await request.json();
            if (env.DB) {
                await env.DB.prepare("INSERT OR REPLACE INTO settings (id, heroText, apiKey) VALUES (?, ?, ?)")
                    .bind(userId || 'default', heroText, apiKey).run();
            }
            return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
        }

        if (path === '/api/settings' && request.method === 'GET') {
            let data = { heroText: "再次啟動高效模式！", apiKey: "" };
            if (env.DB) {
                const row = await env.DB.prepare("SELECT * FROM settings WHERE id = ?").bind('default').first();
                if (row) data = row;
            }
            return new Response(JSON.stringify(data), { headers: corsHeaders });
        }

        // --- 模型清單 (常駐 Gemini Flash + 20+ CF 模型) ---
        if (path === '/api/models') {
            const showMore = url.searchParams.get('more') === 'true';
            let modelList = [];

            // 1. 常駐 Gemini Flash (只要有 Key)
            if (effectiveKey) {
                const gRes = await fetch(wrapUrl(`https://generativelanguage.googleapis.com/v1beta/models?key=${effectiveKey}`));
                const gData = await gRes.json();
                if (gData.models) {
                    modelList.push(...gData.models
                        .filter(m => m.name.toLowerCase().includes('flash') && !m.name.toLowerCase().match(/pro|lite|vision/))
                        .map(m => ({ id: m.name.split('/').pop(), name: m.displayName.replace('Gemini ', 'Flash '), tag: '推薦 ✅', provider: 'Google' }))
                    );
                }
            }

            // 2. Cloudflare 免費模型庫
            const cfModels = [
                { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B', tag: '快速 ⚡', provider: 'Cloudflare' },
                { id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1', tag: '推薦 ✅', provider: 'Cloudflare' },
                { id: '@cf/qwen/qwen2.5-7b-instruct', name: 'Qwen 2.5 7B', tag: '輕量 🍃', provider: 'Cloudflare' },
                { id: '@cf/google/gemma-2-9b-it', name: 'Gemma 2 9B', tag: '快速 ⚡', provider: 'Cloudflare' },
                { id: '@cf/microsoft/phi-2', name: 'Phi-2', tag: '輕量 🍃', provider: 'Cloudflare' }
            ];

            if (showMore) {
                cfModels.push(
                    { id: '@cf/meta/llama-2-7b-chat-fp16', name: 'Llama 2 7B', tag: '經典 ⚠️', provider: 'Cloudflare' },
                    { id: '@cf/mistralai/mistral-7b-instruct-v0.1', name: 'Mistral 7B', tag: '穩定 🍃', provider: 'Cloudflare' },
                    { id: '@cf/tiiuae/falcon-7b-instruct', name: 'Falcon 7B', tag: '經典 ⚠️', provider: 'Cloudflare' },
                    { id: '@cf/tinyllama/tinyllama-1.1b-chat-v1.0', name: 'TinyLlama', tag: '極速 ⚡', provider: 'Cloudflare' },
                    { id: '@cf/qwen/qwen1.5-0.5b-chat', name: 'Qwen 0.5B', tag: '微型 🍃', provider: 'Cloudflare' },
                    { id: '@cf/baichuan-inc/baichuan-7b-chat', name: 'Baichuan 7B', tag: '穩定 🍃', provider: 'Cloudflare' },
                    { id: '@cf/defog/sql-coder-7b-v2', name: 'SQL Coder', tag: '工具 🛠️', provider: 'Cloudflare' },
                    { id: '@cf/openchat/openchat-3.5-0106', name: 'OpenChat 3.5', tag: '穩定 🍃', provider: 'Cloudflare' }
                    // ... 此處可擴展至 20+
                );
            }
            modelList.push(...cfModels);
            return new Response(JSON.stringify({ models: modelList }), { headers: corsHeaders });
        }

        // --- 聊天邏輯 ---
        if (path === '/api/chat') {
            const { model, messages, provider } = await request.json();
            if (provider === 'Google') {
                const gRes = await fetch(wrapUrl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${effectiveKey}`), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) })
                });
                const data = await gRes.json();
                return new Response(JSON.stringify({ content: data.candidates[0].content.parts[0].text }), { headers: corsHeaders });
            }
            const cfRes = await env.AI.run(model, { messages });
            return new Response(JSON.stringify({ content: cfRes.response }), { headers: corsHeaders });
        }
    } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: corsHeaders });
    }
                    }
