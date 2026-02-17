import React, { useState, useEffect, useRef } from 'react';
import { 
  Send, 
  Settings, 
  Image as ImageIcon, 
  RefreshCw, 
  Cpu, 
  Database, 
  Activity,
  User,
  Bot,
  Trash2,
  AlertCircle
} from 'lucide-react';

const App = () => {
  // 狀態管理
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState(null);
  const [placeholder, setPlaceholder] = useState('和 AI 說點什麼...');
  const [systemStats, setSystemStats] = useState({
    functions: 'unknown',
    gemini: 'unknown',
    d1: 'unknown',
    cf_ai: 'unknown',
    remaining_limit: 0
  });
  const [showSettings, setShowSettings] = useState(false);
  
  const scrollRef = useRef(null);

  // 初始化：讀取模型與系統狀態
  useEffect(() => {
    fetchModels();
    checkStats();
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      setModels(data.models || []);
      if (data.models?.length > 0) setSelectedModel(data.models[0]);
    } catch (err) {
      console.error('無法獲取模型列表', err);
    }
  };

  const checkStats = async () => {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      setSystemStats(data);
    } catch (err) {
      console.error('統計數據獲取失敗', err);
    }
  };

  const handleImageChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImage(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() && !image) return;
    if (systemStats.remaining_limit <= 0) {
      alert('今日使用額度已達上限');
      return;
    }

    const userMsg = { role: 'user', content: input, image: image };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setImage(null);
    setLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: selectedModel.id,
          messages: [...messages, userMsg],
          image: image,
          type: selectedModel.provider
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setMessages(prev => [...prev, { role: 'assistant', content: data.content }]);
      checkStats(); // 更新剩餘次數
    } catch (err) {
      setMessages(prev => [...prev, { role: 'error', content: `錯誤: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 text-gray-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-2">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Cpu className="text-white w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">
            CloudAI Hub
          </h1>
        </div>
        
        <div className="flex items-center gap-4">
          <select 
            className="bg-gray-100 border-none rounded-full px-4 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
            value={selectedModel?.id || ''}
            onChange={(e) => setSelectedModel(models.find(m => m.id === e.target.value))}
          >
            {models.map(m => (
              <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
            ))}
          </select>
          
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <Settings className="w-5 h-5 text-gray-600" />
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex flex-col relative">
        {/* Settings Overlay */}
        {showSettings && (
          <div className="absolute top-0 right-0 w-80 bg-white shadow-xl border-l z-20 h-full p-6 animate-in slide-in-from-right">
            <div className="flex justify-between items-center mb-6">
              <h2 className="font-bold text-lg">系統狀態</h2>
              <button onClick={() => setShowSettings(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            
            <div className="space-y-4">
              <StatusItem icon={<Activity />} label="Pages Functions" status={systemStats.functions} />
              <StatusItem icon={<Bot />} label="Gemini API" status={systemStats.gemini} />
              <StatusItem icon={<Database />} label="D1 Database" status={systemStats.d1} />
              <StatusItem icon={<Cpu />} label="Cloudflare AI" status={systemStats.cf_ai} />
              
              <div className="mt-8 p-4 bg-blue-50 rounded-xl">
                <p className="text-sm text-blue-600 font-medium mb-1">今日剩餘額度</p>
                <p className="text-2xl font-bold text-blue-800">{systemStats.remaining_limit}</p>
              </div>

              <div className="mt-4">
                <label className="text-sm font-medium text-gray-700">自定義提示詞</label>
                <input 
                  type="text" 
                  className="w-full mt-1 px-3 py-2 border rounded-lg text-sm"
                  placeholder="輸入預設提示..."
                  value={placeholder}
                  onChange={(e) => setPlaceholder(e.target.value)}
                />
              </div>
              
              <button 
                onClick={clearChat}
                className="w-full mt-6 flex items-center justify-center gap-2 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-100"
              >
                <Trash2 className="w-4 h-4" /> 清除對話
              </button>
            </div>
          </div>
        )}

        {/* Chat Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
              <div className="bg-gray-100 p-6 rounded-full">
                <Bot className="w-12 h-12" />
              </div>
              <p className="text-lg">開始與探索 AI 的無限可能</p>
            </div>
          )}
          
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] rounded-2xl p-4 shadow-sm ${
                msg.role === 'user' 
                  ? 'bg-blue-600 text-white rounded-tr-none' 
                  : msg.role === 'error'
                  ? 'bg-red-50 text-red-700 border border-red-100'
                  : 'bg-white text-gray-800 border rounded-tl-none'
              }`}>
                {msg.image && (
                  <img src={msg.image} alt="User upload" className="max-w-xs rounded-lg mb-2 border border-blue-400" />
                )}
                <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-white border rounded-2xl p-4 shadow-sm rounded-tl-none flex items-center gap-2">
                <div className="flex space-x-1">
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 md:p-6 bg-white border-t">
          <div className="max-w-4xl mx-auto relative">
            {image && (
              <div className="absolute bottom-full mb-4 left-0 p-2 bg-white border rounded-xl shadow-lg flex items-center gap-2">
                <img src={image} className="w-20 h-20 object-cover rounded" alt="Preview" />
                <button onClick={() => setImage(null)} className="p-1 bg-red-500 text-white rounded-full">✕</button>
              </div>
            )}
            
            <div className="flex items-end gap-2 bg-gray-100 rounded-2xl p-2 focus-within:ring-2 focus-within:ring-blue-500 transition-all">
              {selectedModel?.supportsImage && (
                <label className="p-3 cursor-pointer hover:bg-gray-200 rounded-xl transition-colors text-gray-500">
                  <ImageIcon className="w-6 h-6" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageChange} />
                </label>
              )}
              
              <textarea
                className="flex-1 bg-transparent border-none focus:ring-0 resize-none py-3 px-2 max-h-40 min-h-[50px]"
                rows="1"
                placeholder={placeholder}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
              />
              
              <button 
                onClick={sendMessage}
                disabled={loading || (!input.trim() && !image)}
                className={`p-3 rounded-xl transition-all ${
                  loading || (!input.trim() && !image) 
                  ? 'text-gray-400' 
                  : 'bg-blue-600 text-white shadow-md hover:bg-blue-700 active:scale-95'
                }`}
              >
                {loading ? <RefreshCw className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

const StatusItem = ({ icon, label, status }) => {
  const getStatusColor = (s) => {
    if (s === 'online') return 'bg-green-500';
    if (s === 'offline') return 'bg-red-500';
    return 'bg-gray-300';
  };

  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-xl border border-gray-100">
      <div className="flex items-center gap-3 text-gray-600">
        {React.cloneElement(icon, { size: 18 })}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 capitalize">{status}</span>
        <div className={`w-2.5 h-2.5 rounded-full ${getStatusColor(status)} shadow-sm`}></div>
      </div>
    </div>
  );
};

export default App;
