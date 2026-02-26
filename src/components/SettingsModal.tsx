import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon, EyeIcon, EyeOffIcon, CheckIcon } from './Icons';

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

  // LLM 配置
  const [llmConfig, setLlmConfig] = useState<LLMConfig>({
    provider: 'deepseek', apiKey: '', apiUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat', maxTokens: 8000, temperature: 0.7,
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [llmTestStatus, setLlmTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [llmTestMsg, setLlmTestMsg] = useState('');
  const [llmSaving, setLlmSaving] = useState(false);

  useEffect(() => { setLocalSessionId(sessionId); }, [sessionId]);

  // 加载 LLM 配置
  const loadLLMConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/llm-config');
      if (res.ok) {
        const data = await res.json();
        setLlmConfig(prev => ({ ...prev, ...data, apiKey: data.apiKey === '***' ? prev.apiKey : (data.apiKey || '') }));
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

  const inputClass = 'w-full bg-[#161824] border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-purple-500 transition-colors';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1c1f2e] border border-gray-800 rounded-3xl p-6 max-w-lg w-full mx-4 shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg text-gray-200 font-medium">{t('settings.title')}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-800 transition-colors">
            <CloseIcon className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-1 mb-4 bg-[#161824] rounded-xl p-1">
          <button onClick={() => setTab('general')}
            className={`flex-1 py-2 rounded-lg text-sm transition-all ${tab === 'general' ? 'bg-purple-600/20 text-purple-400' : 'text-gray-400 hover:text-gray-200'}`}>
            {t('settings.tabGeneral')}
          </button>
          <button onClick={() => setTab('llm')}
            className={`flex-1 py-2 rounded-lg text-sm transition-all ${tab === 'llm' ? 'bg-purple-600/20 text-purple-400' : 'text-gray-400 hover:text-gray-200'}`}>
            {t('settings.tabLLM')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {/* General Tab */}
          {tab === 'general' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">{t('settings.sessionId')}</label>
                <div className="relative">
                  <input type={showSessionId ? 'text' : 'password'} value={localSessionId}
                    onChange={(e) => setLocalSessionId(e.target.value)}
                    placeholder={t('settings.sessionIdPlaceholder')} className={`${inputClass} pr-10`} />
                  <button onClick={() => setShowSessionId(!showSessionId)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-300">
                    {showSessionId ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1">{t('settings.sessionIdHint')}</p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1.5">{t('drama.maxConcurrentChars')}</label>
                <input type="number" value={maxConcurrentChars}
                  onChange={(e) => setMaxConcurrentChars(Math.max(1, Math.min(5, Number(e.target.value))))}
                  min={1} max={5} className={inputClass} />
                <p className="text-xs text-gray-500 mt-1">{t('drama.maxConcurrentCharsHint')}</p>
              </div>
            </div>
          )}

          {/* LLM Tab */}
          {tab === 'llm' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">{t('settings.llmHint')}</p>

              {/* Provider */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('settings.llmProvider')}</label>
                <select value={llmConfig.provider} onChange={(e) => handleProviderChange(e.target.value)} className={inputClass}>
                  {LLM_PROVIDERS.map(p => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {/* API Key */}
              {llmConfig.provider !== 'ollama' && (
                <div>
                  <label className="block text-xs text-gray-400 mb-1">API Key</label>
                  <div className="relative">
                    <input type={showApiKey ? 'text' : 'password'} value={llmConfig.apiKey}
                      onChange={(e) => setLlmConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                      placeholder="sk-..." className={`${inputClass} pr-10`} />
                    <button onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-gray-300">
                      {showApiKey ? <EyeOffIcon className="w-4 h-4" /> : <EyeIcon className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}

              {/* API URL */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">API URL</label>
                <input type="text" value={llmConfig.apiUrl}
                  onChange={(e) => setLlmConfig(prev => ({ ...prev, apiUrl: e.target.value }))}
                  placeholder="https://api.example.com" className={inputClass} />
              </div>

              {/* Model */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">{t('settings.llmModel')}</label>
                <input type="text" value={llmConfig.model}
                  onChange={(e) => setLlmConfig(prev => ({ ...prev, model: e.target.value }))}
                  placeholder="model-name" className={inputClass} />
              </div>

              {/* Advanced: maxTokens + temperature */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('settings.llmMaxTokens')}</label>
                  <input type="number" value={llmConfig.maxTokens}
                    onChange={(e) => setLlmConfig(prev => ({ ...prev, maxTokens: Number(e.target.value) }))}
                    min={1000} max={128000} className={inputClass} />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">{t('settings.llmTemperature')}</label>
                  <input type="number" value={llmConfig.temperature} step={0.1}
                    onChange={(e) => setLlmConfig(prev => ({ ...prev, temperature: Number(e.target.value) }))}
                    min={0} max={2} className={inputClass} />
                </div>
              </div>

              {/* 测试状态 */}
              {llmTestStatus !== 'idle' && (
                <div className={`px-3 py-2 rounded-lg text-xs ${
                  llmTestStatus === 'testing' ? 'bg-blue-900/30 text-blue-400' :
                  llmTestStatus === 'success' ? 'bg-green-900/30 text-green-400' :
                  'bg-red-900/30 text-red-400'
                }`}>
                  {llmTestStatus === 'testing' && <span className="animate-pulse">{t('settings.llmTesting')}</span>}
                  {llmTestStatus !== 'testing' && (
                    <span className="flex items-center gap-1">
                      {llmTestStatus === 'success' && <CheckIcon className="w-3 h-3" />}
                      {llmTestMsg}
                    </span>
                  )}
                </div>
              )}

              {/* 保存 + 测试按钮 */}
              <div className="flex gap-2">
                <button onClick={handleSaveLLM} disabled={llmSaving}
                  className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-bold transition-all">
                  {llmSaving ? t('common.loading') : t('settings.llmSave')}
                </button>
                <button onClick={handleTestLLM} disabled={llmTestStatus === 'testing'}
                  className="px-4 py-2.5 rounded-xl bg-[#161824] border border-gray-700 text-gray-300 text-sm hover:bg-[#1c2030] transition-colors">
                  {t('settings.llmTest')}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮（General tab） */}
        {tab === 'general' && (
          <div className="flex gap-3 mt-6">
            <button onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-xl bg-[#161824] border border-gray-700 text-gray-300 text-sm hover:bg-[#1c2030] transition-colors">
              {t('common.cancel')}
            </button>
            <button onClick={handleSave}
              className="flex-1 px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-bold transition-all shadow-lg shadow-purple-900/20">
              {t('common.save')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
