import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon, EyeIcon, EyeOffIcon, CheckIcon, GearIcon, SparkleIcon } from './Icons';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
  onSessionIdChange: (id: string) => void;
}

type Tab = 'general' | 'llm';

interface LLMConfig {
  provider: string;
  apiKey: string;
  apiUrl: string;
  model: string;
  maxTokens: number;
  temperature: number;
}

const LLM_PROVIDERS = [
  { value: 'deepseek', label: 'DeepSeek', defaultUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  { value: 'openai', label: 'OpenAI', defaultUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
  { value: 'anthropic', label: 'Anthropic', defaultUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-20250514' },
  { value: 'gemini', label: 'Google Gemini', defaultUrl: 'https://generativelanguage.googleapis.com/v1beta', defaultModel: 'gemini-2.0-flash' },
  { value: 'ollama', label: 'Ollama (本地)', defaultUrl: 'http://localhost:11434/v1', defaultModel: 'llama3' },
  { value: 'custom', label: '自定义 (OpenAI 兼容)', defaultUrl: '', defaultModel: '' },
];

const LS_SESSION_KEY = 'seedance_session_id';
const LS_MAX_CONCURRENT_CHARS_KEY = 'seedance_max_concurrent_chars';

export function loadSettings() {
  return {
    sessionId: localStorage.getItem(LS_SESSION_KEY) || '',
    maxConcurrentChars: parseInt(localStorage.getItem(LS_MAX_CONCURRENT_CHARS_KEY) || '3') || 3,
  };
}

export default function SettingsModal({ isOpen, onClose, sessionId, onSessionIdChange }: SettingsModalProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('general');
  const [localSessionId, setLocalSessionId] = useState(sessionId);
  const [showSessionId, setShowSessionId] = useState(false);
  const [maxConcurrentChars, setMaxConcurrentChars] = useState(() => loadSettings().maxConcurrentChars);

  // 主 LLM 配置（解析小说 + 改造剧本）
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: 'deepseek', apiKey: '', apiUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat', maxTokens: 8000, temperature: 0.7,
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [llmTestStatus, setLlmTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [llmTestMsg, setLlmTestMsg] = useState('');
  const [llmSaving, setLlmSaving] = useState(false);

  // Vision LLM 配置（AI 图片审查）
  const [visionConfig, setVisionConfig] = useState<LLMConfig>({
    provider: 'gemini', apiKey: '', apiUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.0-flash', maxTokens: 2000, temperature: 0.3,
  });
  const [showVisionApiKey, setShowVisionApiKey] = useState(false);
  const [visionConfigured, setVisionConfigured] = useState(false);
  const [visionSaving, setVisionSaving] = useState(false);
  const [visionSaveMsg, setVisionSaveMsg] = useState('');

  useEffect(() => { setLocalSessionId(sessionId); }, [sessionId]);

  // 加载 LLM 配置
  const loadLLMConfig = useCallback(async () => {
    try {
      const [res, vRes] = await Promise.all([
        fetch('/api/llm-config'),
        fetch('/api/llm-config/vision'),
      ]);
      if (res.ok) {
        const data = await res.json();
        setLlmConfig(prev => ({ ...prev, ...data, apiKey: data.apiKey === '***' ? prev.apiKey : (data.apiKey || '') }));
      }
      if (vRes.ok) {
        const vData = await vRes.json();
        setVisionConfigured(vData.configured || false);
        if (vData.configured) {
          setVisionConfig(prev => ({ ...prev, ...vData, apiKey: vData.apiKey === '***' ? prev.apiKey : (vData.apiKey || '') }));
        }
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { if (isOpen) loadLLMConfig(); }, [isOpen, loadLLMConfig]);

  if (!isOpen) return null;

  const handleSave = () => {
    onSessionIdChange(localSessionId);
    localStorage.setItem(LS_SESSION_KEY, localSessionId);
    localStorage.setItem(LS_MAX_CONCURRENT_CHARS_KEY, String(maxConcurrentChars));
    onClose();
  };

  // 切换 LLM 厂商时自动填充默认值
  const handleProviderChange = (provider: string) => {
    const p = LLM_PROVIDERS.find(x => x.value === provider);
    setLlmConfig(prev => ({
      ...prev, provider,
      apiUrl: p?.defaultUrl || prev.apiUrl,
      model: p?.defaultModel || prev.model,
    }));
  };

  const handleVisionProviderChange = (provider: string) => {
    const p = LLM_PROVIDERS.find(x => x.value === provider);
    setVisionConfig(prev => ({
      ...prev, provider,
      apiUrl: p?.defaultUrl || prev.apiUrl,
      model: p?.defaultModel || prev.model,
    }));
  };

  // 保存 LLM 配置
  const handleSaveLLM = async () => {
    setLlmSaving(true);
    try {
      const res = await fetch('/api/llm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(llmConfig),
      });
      if (!res.ok) throw new Error('保存失败');
      setLlmTestMsg(t('settings.llmSaved'));
      setLlmTestStatus('success');
      setTimeout(() => setLlmTestStatus('idle'), 2000);
    } catch (err) {
      setLlmTestMsg((err as Error).message);
      setLlmTestStatus('error');
    } finally {
      setLlmSaving(false);
    }
  };

  // 保存 Vision LLM 配置
  const handleSaveVision = async () => {
    setVisionSaving(true);
    try {
      const res = await fetch('/api/llm-config/vision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(visionConfig),
      });
      if (!res.ok) throw new Error('保存失败');
      setVisionConfigured(true);
      setVisionSaveMsg(t('settings.llmSaved'));
      setTimeout(() => setVisionSaveMsg(''), 2000);
    } catch (err) {
      setVisionSaveMsg((err as Error).message);
    } finally {
      setVisionSaving(false);
    }
  };

  // 测试 LLM 连接
  const handleTestLLM = async () => {
    setLlmTestStatus('testing');
    setLlmTestMsg('');
    // 先保存再测试
    try {
      await fetch('/api/llm-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(llmConfig),
      });
    } catch { /* ignore */ }

    try {
      const res = await fetch('/api/llm-test', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setLlmTestStatus('success');
        setLlmTestMsg(`${t('settings.llmTestOk')} (${data.duration}s)`);
      } else {
        setLlmTestStatus('error');
        setLlmTestMsg(data.error || t('settings.llmTestFail'));
      }
    } catch (err) {
      setLlmTestStatus('error');
      setLlmTestMsg((err as Error).message);
    }
  };

  const inputClass = 'w-full bg-[#111] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 transition-all';
  const labelClass = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="relative bg-[#0a0a0a] border border-white/10 rounded-3xl w-full max-w-2xl mx-4 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden animate-fade-in">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 bg-[#0a0a0a]/95 backdrop-blur z-10">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <GearIcon className="w-5 h-5 text-gray-400" />
            {t('settings.title')}
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors text-gray-400 hover:text-white">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-6 pb-2">
          <div className="flex bg-[#111] rounded-xl p-1 border border-white/5">
            <button onClick={() => setTab('general')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === 'general' ? 'bg-[#222] text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}>
              {t('settings.tabGeneral')}
            </button>
            <button onClick={() => setTab('llm')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${tab === 'llm' ? 'bg-[#222] text-purple-400 shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}>
              {t('settings.tabLLM')}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
          {/* General Tab */}
          {tab === 'general' && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-[#111]/50 rounded-2xl p-5 border border-white/5 space-y-4">
                <div>
                  <label className={labelClass}>{t('settings.sessionId')}</label>
                  <div className="relative group">
                    <input type={showSessionId ? 'text' : 'password'} value={localSessionId}
                      onChange={(e) => setLocalSessionId(e.target.value)}
                      placeholder={t('settings.sessionIdPlaceholder')} className={`${inputClass} pr-12 font-mono`} />
                    <button onClick={() => setShowSessionId(!showSessionId)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-white transition-colors rounded-lg hover:bg-white/5">
                      {showSessionId ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-2 leading-relaxed">{t('settings.sessionIdHint')}</p>
                </div>
              </div>

              <div className="bg-[#111]/50 rounded-2xl p-5 border border-white/5 space-y-4">
                <div>
                  <label className={labelClass}>{t('drama.maxConcurrentChars')}</label>
                  <input type="number" value={maxConcurrentChars}
                    onChange={(e) => setMaxConcurrentChars(Math.max(1, Math.min(5, Number(e.target.value))))}
                    min={1} max={5} className={inputClass} />
                  <p className="text-xs text-gray-500 mt-2">{t('drama.maxConcurrentCharsHint')}</p>
                </div>
              </div>
            </div>
          )}

          {/* LLM Tab */}
          {tab === 'llm' && (
            <div className="space-y-8 animate-fade-in">
              {/* Text Model Section */}
              <section className="bg-[#111]/30 rounded-2xl border border-white/5 overflow-hidden">
                <div className="px-5 py-4 border-b border-white/5 bg-[#111]/50 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center">
                    <SparkleIcon className="w-4 h-4 text-purple-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">{t('settings.llmTextTitle')}</h3>
                    <p className="text-xs text-gray-500">{t('settings.llmTextHint')}</p>
                  </div>
                </div>
                
                <div className="p-5 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="col-span-1 md:col-span-2">
                      <label className={labelClass}>{t('settings.llmProvider')}</label>
                      <select value={llmConfig.provider} onChange={(e) => handleProviderChange(e.target.value)} className={inputClass}>
                        {LLM_PROVIDERS.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>

                    {llmConfig.provider !== 'ollama' && (
                      <div className="col-span-1 md:col-span-2">
                        <label className={labelClass}>API Key</label>
                        <div className="relative">
                          <input type={showApiKey ? 'text' : 'password'} value={llmConfig.apiKey}
                            onChange={(e) => setLlmConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                            placeholder="sk-..." className={`${inputClass} pr-12 font-mono`} />
                          <button onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-white transition-colors rounded-lg hover:bg-white/5">
                            {showApiKey ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className={labelClass}>API URL</label>
                      <input type="text" value={llmConfig.apiUrl}
                        onChange={(e) => setLlmConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                        placeholder="https://api.example.com" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>{t('settings.llmModel')}</label>
                      <input type="text" value={llmConfig.model}
                        onChange={(e) => setLlmConfig(prev => ({ ...prev, model: e.target.value }))}
                        placeholder="model-name" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>{t('settings.llmMaxTokens')}</label>
                      <input type="number" value={llmConfig.maxTokens}
                        onChange={(e) => setLlmConfig(prev => ({ ...prev, maxTokens: Number(e.target.value) }))}
                        min={1000} max={128000} className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>{t('settings.llmTemperature')}</label>
                      <input type="number" value={llmConfig.temperature} step={0.1}
                        onChange={(e) => setLlmConfig(prev => ({ ...prev, temperature: Number(e.target.value) }))}
                        min={0} max={2} className={inputClass} />
                    </div>
                  </div>

                  {/* Test Status */}
                  {llmTestStatus !== 'idle' && (
                    <div className={`px-4 py-3 rounded-xl text-xs font-medium flex items-center gap-2 ${
                      llmTestStatus === 'testing' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
                      llmTestStatus === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' :
                      'bg-red-500/10 text-red-400 border border-red-500/20'
                    }`}>
                      {llmTestStatus === 'testing' && <span className="animate-spin h-3 w-3 border-2 border-current border-t-transparent rounded-full" />}
                      {llmTestStatus === 'success' && <CheckIcon className="w-4 h-4" />}
                      <span>{llmTestStatus === 'testing' ? t('settings.llmTesting') : llmTestMsg}</span>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button onClick={handleSaveLLM} disabled={llmSaving}
                      className="flex-1 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-sm font-bold transition-all shadow-lg shadow-purple-900/20 disabled:opacity-50 disabled:shadow-none">
                      {llmSaving ? t('common.loading') : t('settings.llmSave')}
                    </button>
                    <button onClick={handleTestLLM} disabled={llmTestStatus === 'testing'}
                      className="px-6 py-3 rounded-xl bg-[#222] border border-white/10 text-gray-300 text-sm font-medium hover:bg-[#333] hover:text-white transition-all">
                      {t('settings.llmTest')}
                    </button>
                  </div>
                </div>
              </section>

              {/* Vision Model Section */}
              <section className="bg-[#111]/30 rounded-2xl border border-white/5 overflow-hidden">
                <div className="px-5 py-4 border-b border-white/5 bg-[#111]/50 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                    <EyeIcon className="w-4 h-4 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      {t('settings.llmVisionTitle')}
                      {!visionConfigured && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/20 font-normal">{t('settings.llmVisionFallback')}</span>
                      )}
                    </h3>
                    <p className="text-xs text-gray-500">{t('settings.llmVisionHint')}</p>
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="col-span-1 md:col-span-2">
                      <label className={labelClass}>{t('settings.llmProvider')}</label>
                      <select value={visionConfig.provider} onChange={(e) => handleVisionProviderChange(e.target.value)} className={inputClass}>
                        {LLM_PROVIDERS.map(p => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>

                    {visionConfig.provider !== 'ollama' && (
                      <div className="col-span-1 md:col-span-2">
                        <label className={labelClass}>API Key</label>
                        <div className="relative">
                          <input type={showVisionApiKey ? 'text' : 'password'} value={visionConfig.apiKey}
                            onChange={(e) => setVisionConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                            placeholder="sk-..." className={`${inputClass} pr-12 font-mono`} />
                          <button onClick={() => setShowVisionApiKey(!showVisionApiKey)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-white transition-colors rounded-lg hover:bg-white/5">
                            {showVisionApiKey ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    )}

                    <div>
                      <label className={labelClass}>API URL</label>
                      <input type="text" value={visionConfig.apiUrl}
                        onChange={(e) => setVisionConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                        placeholder="https://api.example.com" className={inputClass} />
                    </div>
                    <div>
                      <label className={labelClass}>{t('settings.llmModel')}</label>
                      <input type="text" value={visionConfig.model}
                        onChange={(e) => setVisionConfig(prev => ({ ...prev, model: e.target.value }))}
                        placeholder="gemini-2.0-flash" className={inputClass} />
                    </div>
                  </div>

                  {visionSaveMsg && (
                    <div className="px-4 py-3 rounded-xl text-xs bg-green-500/10 text-green-400 border border-green-500/20 flex items-center gap-2">
                      <CheckIcon className="w-4 h-4" />{visionSaveMsg}
                    </div>
                  )}

                  <button onClick={handleSaveVision} disabled={visionSaving}
                    className="w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold transition-all shadow-lg shadow-cyan-900/20 disabled:opacity-50 disabled:shadow-none">
                    {visionSaving ? t('common.loading') : t('settings.llmSave')}
                  </button>
                </div>
              </section>
            </div>
          )}
        </div>

        {/* Footer Actions (General Tab Only) */}
        {tab === 'general' && (
          <div className="p-6 border-t border-white/5 bg-[#0a0a0a]/95 backdrop-blur flex gap-4 sticky bottom-0 z-20">
            <button onClick={onClose}
              className="flex-1 px-6 py-3.5 rounded-xl bg-[#222] border border-white/5 text-gray-300 text-sm font-medium hover:bg-[#333] hover:text-white transition-all">
              {t('common.cancel')}
            </button>
            <button onClick={handleSave}
              className="flex-1 px-6 py-3.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-bold transition-all shadow-lg shadow-green-900/20 hover:shadow-green-900/40 hover:scale-[1.02] active:scale-[0.98]">
              {t('common.save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
