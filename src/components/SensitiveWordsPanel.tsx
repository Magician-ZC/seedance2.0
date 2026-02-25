import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon, PlusIcon, CheckIcon, ShieldIcon } from './Icons';

interface WordsDetail {
  manual: string[];
  learned: string[];
  total: number;
  updatedAt: number;
}

interface SensitiveWordsPanelProps {
  onClose: () => void;
}

export default function SensitiveWordsPanel({ onClose }: SensitiveWordsPanelProps) {
  const { t } = useTranslation();
  const [words, setWords] = useState<WordsDetail | null>(null);
  const [newWord, setNewWord] = useState('');
  const [checkText, setCheckText] = useState('');
  const [checkResult, setCheckResult] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchWords = useCallback(async () => {
    try {
      const res = await fetch('/api/sensitive-words');
      const data = await res.json();
      setWords(data);
    } catch (err) {
      console.error('获取敏感词失败:', err);
    }
  }, []);

  useEffect(() => { fetchWords(); }, [fetchWords]);

  const handleAdd = async () => {
    const trimmed = newWord.trim();
    if (!trimmed) return;
    setLoading(true);
    try {
      await fetch('/api/sensitive-words/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ words: trimmed.split(/[,，\s]+/).filter(Boolean) }),
      });
      setNewWord('');
      await fetchWords();
    } finally { setLoading(false); }
  };

  const handleRemove = async (word: string) => {
    await fetch(`/api/sensitive-words/${encodeURIComponent(word)}`, { method: 'DELETE' });
    await fetchWords();
  };

  const handleConfirm = async (word: string) => {
    await fetch('/api/sensitive-words/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ word }),
    });
    await fetchWords();
  };

  const handleCheck = async () => {
    if (!checkText.trim()) return;
    const res = await fetch('/api/sensitive-words/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: checkText }),
    });
    const data = await res.json();
    setCheckResult(data.hits);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1c1f2e] border border-gray-800 rounded-3xl p-6 max-w-2xl w-full mx-4 shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ShieldIcon className="w-5 h-5 text-purple-400" />
            <h2 className="text-lg text-gray-200 font-medium">{t('sensitiveWords.title')}</h2>
            {words && <span className="text-xs text-gray-500">({words.total} {t('sensitiveWords.wordsCount')})</span>}
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-800">
            <CloseIcon className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar">
          {/* 添加敏感词 */}
          <div className="bg-[#161824] rounded-xl p-3 border border-gray-800">
            <label className="text-xs text-gray-400 block mb-2">{t('sensitiveWords.addLabel')}</label>
            <div className="flex gap-2">
              <input
                value={newWord} onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder={t('sensitiveWords.addPlaceholder')}
                className="flex-1 bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-purple-500"
              />
              <button onClick={handleAdd} disabled={loading || !newWord.trim()}
                className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm transition-colors">
                <PlusIcon className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 检测文本 */}
          <div className="bg-[#161824] rounded-xl p-3 border border-gray-800">
            <label className="text-xs text-gray-400 block mb-2">{t('sensitiveWords.checkLabel')}</label>
            <div className="flex gap-2">
              <input
                value={checkText} onChange={(e) => { setCheckText(e.target.value); setCheckResult(null); }}
                onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
                placeholder={t('sensitiveWords.checkPlaceholder')}
                className="flex-1 bg-[#0f111a] border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 outline-none focus:border-purple-500"
              />
              <button onClick={handleCheck} disabled={!checkText.trim()}
                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-sm transition-colors">
                {t('sensitiveWords.checkBtn')}
              </button>
            </div>
            {checkResult !== null && (
              <div className={`mt-2 text-xs ${checkResult.length > 0 ? 'text-red-400' : 'text-green-400'}`}>
                {checkResult.length > 0
                  ? `${t('sensitiveWords.found')}: ${checkResult.join(', ')}`
                  : t('sensitiveWords.clean')}
              </div>
            )}
          </div>

          {/* 候选词（自动学习） */}
          {words && words.learned.length > 0 && (
            <div>
              <h3 className="text-sm text-yellow-400 mb-2">{t('sensitiveWords.learnedTitle')} ({words.learned.length})</h3>
              <div className="flex flex-wrap gap-2">
                {words.learned.map((w) => (
                  <span key={w} className="inline-flex items-center gap-1 px-2.5 py-1 bg-yellow-900/30 border border-yellow-700/50 rounded-lg text-xs text-yellow-300">
                    {w}
                    <button onClick={() => handleConfirm(w)} title={t('common.confirm')} className="hover:text-green-400 transition-colors">
                      <CheckIcon className="w-3 h-3" />
                    </button>
                    <button onClick={() => handleRemove(w)} title={t('common.delete')} className="hover:text-red-400 transition-colors">
                      <CloseIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* 已确认词库 */}
          {words && words.manual.length > 0 && (
            <div>
              <h3 className="text-sm text-gray-300 mb-2">{t('sensitiveWords.manualTitle')} ({words.manual.length})</h3>
              <div className="flex flex-wrap gap-2">
                {words.manual.map((w) => (
                  <span key={w} className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-800 border border-gray-700 rounded-lg text-xs text-gray-300">
                    {w}
                    <button onClick={() => handleRemove(w)} className="hover:text-red-400 transition-colors">
                      <CloseIcon className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
