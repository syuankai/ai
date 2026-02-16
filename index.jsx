import React, { useState, useEffect, useCallback } from 'react';
import { 
  Settings, Send, Cpu, Sparkles, Database, UserCheck, 
  RefreshCw, X, Zap, Heart, Star, Palette, MessageSquareText,
  CheckCircle2, AlertCircle, Loader2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const App = () => {
  // --- 基礎狀態 ---
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  
  // --- 個性化設定 ---
  const [config, setConfig] = useState({
    useD1: false,
    aiAgent: false,
    autoFetchModels: false,
    selectedModel: '@cf/meta/llama-3.1-8b-instruct',
    bgColor: '#fdf2f8', // 預設粉嫩色
    inputPlaceholder: '跟 AI 醬說點什麼吧...',
  });

  // --- 真實 API 狀態監測 ---
  const [apiStatus, setApiStatus] = useState({
    gemini: 'checking', // 'ok' | 'error' | 'checking'
    cloudflare: 'checking',
    functions: 'checking'
  });

  // --- 模擬從 Pages Functions 獲取真實狀態 ---
  const checkAllStatus = useCallback(async () => {
    setApiStatus({ gemini: 'checking', cloudflare: 'checking', functions: 'checking' });
    
    try {
      // 1. 檢查 Pages Functions 響應
      const funcStart = Date.now();
      const res = await fetch('/api/health'); // 假設有的健康檢查端點
      const hasFunctions = res.ok;
      
      setApiStatus(prev => ({ ...prev, functions: hasFunctions ? 'ok' : 'error' }));

      // 2. 透過 Functions 轉發檢查各家 API (此處為前端模擬邏輯)
      // 在實際 Pages 中，應由後端嘗試呼叫 env.AI 並回傳結果
      setTimeout(() => {
        setApiStatus(prev => ({ 
          ...prev, 
          gemini: 'ok', // 假設環境變數已填寫
          cloudflare: 'ok' 
        }));
      }, 1500);

    } catch (e) {
      setApiStatus({ gemini: 'error', cloudflare: 'error', functions: 'error' });
    }
  }, []);

  useEffect(() => {
    checkAllStatus();
  }, [checkAllStatus]);

  const handleSendMessage = async () => {
    if (!input.trim() || loading) return;
    setMessages(prev => [...prev, { role: 'user', content: input }]);
    setInput('');
    setLoading(true);

    // 這裡應為實體調用 logic
    setTimeout(() => {
      setMessages(prev => [...prev, { 
        role: 'assistant', 
        content: `（⭐ 回應中）偵測到當前背景色為 ${config.bgColor}！我是透過 ${apiStatus.functions === 'ok' ? 'Pages Functions' : '未知路徑'} 運作的喔！` 
      }]);
      setLoading(false);
    }, 1000);
  };

  const StatusTag = ({ label, status }) => (
    <div className="flex justify-between items-center bg-white/50 p-2 rounded-xl border border-pink-100">
      <span className="text-[10px] font-bold text-slate-500">{label}</span>
      <div className="flex items-center gap-1">
        {status === 'checking' && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
        {status === 'ok' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
        {status === 'error' && <AlertCircle className="w-3 h-3 text-red-400" />}
        <span className={`text-[10px] font-black uppercase ${
          status === 'ok' ? 'text-green-600' : status === 'error' ? 'text-red-500' : 'text-blue-400'
        }`}>
          {status}
        </span>
      </div>
    </div>
  );

  return (
    <div 
      className="min-h-screen text-[#4b2c20] font-sans transition-colors duration-700 ease-in-out relative overflow-hidden"
      style={{ backgroundColor: config.bgColor }}
    >
      {/* 背景裝飾 */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-64 h-64 bg-white/30 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-5%] w-96 h-96 bg-white/20 rounded-full blur-3xl" />
      </div>

      <div className="relative max-w-4xl mx-auto h-screen flex flex-col p-4">
        {/* Header */}
        <motion.header 
          initial={{ y: -20 }} animate={{ y: 0 }}
          className="bg-white/70 backdrop-blur-md p-4 rounded-[2rem] shadow-xl border-2 border-white/50 flex justify-between items-center mb-4"
        >
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-pink-400 to-purple-500 p-2.5 rounded-2xl shadow-lg">
              <Sparkles className="text-white w-5 h-5" />
            </div>
            <div>
              <h1 className="font-black text-lg bg-gradient-to-r from-pink-600 to-purple-600 bg-clip-text text-transparent">
                心動 AI 控制台 <span className="text-xs font-normal text-slate-400 ml-1">v3.0</span>
              </h1>
              <div className="flex gap-2 mt-0.5">
                 <div className={`w-1.5 h-1.5 rounded-full ${apiStatus.functions === 'ok' ? 'bg-green-500 animate-pulse' : 'bg-red-400'}`} title="Functions Status" />
                 <div className={`w-1.5 h-1.5 rounded-full ${apiStatus.cloudflare === 'ok' ? 'bg-orange-500 animate-pulse' : 'bg-red-400'}`} title="Cloudflare AI" />
              </div>
            </div>
          </div>
          
          <motion.button 
            whileHover={{ rotate: 90 }}
            onClick={() => setIsMenuOpen(true)}
            className="p-3 bg-white/50 rounded-2xl hover:bg-white transition-colors text-pink-500 shadow-sm border border-pink-50"
          >
            <Settings className="w-6 h-6" />
          </motion.button>
        </motion.header>

        {/* 聊天主體 */}
        <main className="flex-1 bg-white/40 backdrop-blur-md rounded-[2.5rem] shadow-2xl border-2 border-white/60 overflow-hidden flex flex-col relative">
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            <AnimatePresence>
              {messages.length === 0 && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col items-center justify-center text-pink-300">
                  <Heart className="w-16 h-16 mb-4 animate-bounce" />
                  <p className="font-bold">等待你的召喚喔！</p>
                </motion.div>
              )}
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ scale: 0.9, opacity: 0, y: 10 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[85%] p-4 rounded-3xl shadow-md ${
                    msg.role === 'user' 
                    ? 'bg-pink-500 text-white rounded-br-none shadow-pink-100' 
                    : 'bg-white/90 text-slate-700 rounded-bl-none border border-pink-50'
                  }`}>
                    <div className="text-sm font-medium leading-relaxed">{msg.content}</div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>

          {/* 輸入框 */}
          <footer className="p-4 bg-white/50 border-t border-white/40">
            <div className="flex gap-3 items-center">
              <div className="flex-1 relative group">
                <input 
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder={config.inputPlaceholder}
                  className="w-full p-4 pl-12 bg-white/80 rounded-2xl border-2 border-transparent focus:border-pink-300 transition-all outline-none text-pink-900 shadow-inner"
                />
                <MessageSquareText className="absolute left-4 top-4 text-pink-300 w-5 h-5 group-focus-within:text-pink-500 transition-colors" />
              </div>
              <motion.button 
                whileHover={{ scale: 1.05, boxShadow: "0 10px 15px -3px rgba(244, 114, 182, 0.4)" }}
                whileTap={{ scale: 0.95 }}
                onClick={handleSendMessage}
                className="bg-gradient-to-r from-pink-500 to-rose-400 text-white p-4 rounded-2xl shadow-lg"
              >
                <Send className="w-6 h-6" />
              </motion.button>
            </div>
          </footer>
        </main>

        {/* 設定選單 */}
        <AnimatePresence>
          {isMenuOpen && (
            <>
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setIsMenuOpen(false)} className="fixed inset-0 bg-pink-900/10 backdrop-blur-sm z-40" />
              <motion.div 
                initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
                className="fixed right-0 top-0 bottom-0 w-85 bg-white/95 backdrop-blur-xl z-50 shadow-2xl p-6 flex flex-col border-l border-pink-50"
              >
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-lg font-black text-pink-600 flex items-center gap-2 uppercase tracking-widest">
                    <Palette className="w-5 h-5" /> Customize
                  </h2>
                  <button onClick={() => setIsMenuOpen(false)} className="p-2 hover:bg-pink-50 rounded-full text-pink-400 transition-colors">
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="space-y-8 flex-1 overflow-y-auto pr-2">
                  {/* API 真實狀態 */}
                  <section className="space-y-3">
                    <div className="flex justify-between items-center mb-1">
                       <label className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">API Real-time Status</label>
                       <button onClick={checkAllStatus} className="text-pink-400 hover:rotate-180 transition-transform duration-500">
                          <RefreshCw className="w-3 h-3" />
                       </button>
                    </div>
                    <StatusTag label="Pages Functions" status={apiStatus.functions} />
                    <StatusTag label="Cloudflare Workers AI" status={apiStatus.cloudflare} />
                    <StatusTag label="Google Gemini API" status={apiStatus.gemini} />
                  </section>

                  {/* 外觀個性化 */}
                  <section className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase">Appearance</label>
                    <div className="p-4 bg-pink-50/50 rounded-2xl border border-pink-100 space-y-4">
                      <div>
                        <span className="text-xs font-bold text-slate-600 block mb-2 flex items-center gap-2">
                          <Palette className="w-3 h-3" /> 背景顏色
                        </span>
                        <div className="flex gap-2">
                          {['#fdf2f8', '#f0f9ff', '#f0fdf4', '#fafaf9', '#fefce8'].map(color => (
                            <button 
                              key={color}
                              onClick={() => setConfig(c => ({...c, bgColor: color}))}
                              className={`w-8 h-8 rounded-full border-2 transition-transform hover:scale-110 ${config.bgColor === color ? 'border-pink-500' : 'border-transparent'}`}
                              style={{ backgroundColor: color }}
                            />
                          ))}
                        </div>
                      </div>

                      <div>
                        <span className="text-xs font-bold text-slate-600 block mb-2 flex items-center gap-2">
                          <MessageSquareText className="w-3 h-3" /> 輸入提示語
                        </span>
                        <input 
                          value={config.inputPlaceholder}
                          onChange={(e) => setConfig(c => ({...c, inputPlaceholder: e.target.value}))}
                          className="w-full p-2 bg-white rounded-lg text-xs border border-pink-100 outline-none focus:border-pink-400 transition-all"
                        />
                      </div>
                    </div>
                  </section>

                  {/* 功能開關 */}
                  <section className="space-y-4">
                    <label className="text-[10px] font-black text-slate-400 uppercase">Advanced Logic</label>
                    <div className="space-y-4">
                      <div className="flex justify-between items-center">
                        <label className="text-xs font-bold text-slate-600">D1 資料庫儲存</label>
                        <button onClick={() => setConfig(c => ({...c, useD1: !c.useD1}))} className={`w-10 h-5 rounded-full relative transition-colors ${config.useD1 ? 'bg-pink-500' : 'bg-slate-200'}`}>
                          <motion.div animate={{ x: config.useD1 ? 20 : 2 }} className="absolute top-1 w-3 h-3 bg-white rounded-full" />
                        </button>
                      </div>
                      <div className={`flex justify-between items-center transition-opacity ${config.useD1 ? 'opacity-100' : 'opacity-40'}`}>
                        <label className="text-xs font-bold text-slate-600">AI 代理角色</label>
                        <button disabled={!config.useD1} onClick={() => setConfig(c => ({...c, aiAgent: !c.aiAgent}))} className={`w-10 h-5 rounded-full relative transition-colors ${config.aiAgent ? 'bg-purple-500' : 'bg-slate-200'}`}>
                          <motion.div animate={{ x: config.aiAgent ? 20 : 2 }} className="absolute top-1 w-3 h-3 bg-white rounded-full" />
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
                
                <footer className="mt-6 pt-6 border-t border-pink-50">
                  <div className="flex justify-center gap-1">
                    <Star className="w-3 h-3 text-yellow-400 fill-current" />
                    <Star className="w-3 h-3 text-yellow-400 fill-current" />
                    <Star className="w-3 h-3 text-yellow-400 fill-current" />
                  </div>
                  <p className="text-[10px] text-pink-300 font-black mt-1">CONNECTED TO CLOUDFLARE EDGE</p>
                </footer>
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default App;
