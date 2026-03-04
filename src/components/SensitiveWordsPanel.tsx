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
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="relative bg-[#0a0a0a] border border-white/10 rounded-3xl w-full max-w-2xl mx-4 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-fade-in">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 bg-[#0a0a0a]/95 backdrop-blur z-10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
              <ShieldIcon className="w-4 h-4 text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{t('sensitiveWords.title')}</h2>
              {words && <p className="text-xs text-gray-500">{words.total} {t('sensitiveWords.wordsCount')}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors text-gray-400 hover:text-white">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {/* Add Words */}
          <section className="bg-[#111]/50 rounded-2xl p-5 border border-white/5">
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t('sensitiveWords.addLabel')}</label>
            <div className="flex gap-3">
              <input
                value={newWord} onChange={(e) => setNewWord(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder={t('sensitiveWords.addPlaceholder')}
                className="flex-1 bg-[#111] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/20 transition-all"
              />
              <button onClick={handleAdd} disabled={loading || !newWord.trim()}
                className="px-4 py-3 rounded-xl bg-red-600 hover:bg-red-500 disabled:bg-[#222] disabled:text-gray-600 text-white text-sm font-bold transition-all shadow-lg shadow-red-900/20 disabled:shadow-none flex items-center gap-2">
                <PlusIcon className="w-4 h-4" />
                {t('common.add')}
              </button>
            </div>
          </section>

          {/* Check Text */}
          <section className="bg-[#111]/50 rounded-2xl p-5 border border-white/5">
            <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">{t('sensitiveWords.checkLabel')}</label>
            <div className="flex gap-3">
              <input
                value={checkText} onChange={(e) => { setCheckText(e.target.value); setCheckResult(null); }}
                onKeyDown={(e) => e.key === 'Enter' && handleCheck()}
                placeholder={t('sensitiveWords.checkPlaceholder')}
                className="flex-1 bg-[#111] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
              />
              <button onClick={handleCheck} disabled={!checkText.trim()}
                className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-[#222] disabled:text-gray-600 text-white text-sm font-bold transition-all shadow-lg shadow-blue-900/20 disabled:shadow-none">
                {t('sensitiveWords.checkBtn')}
              </button>
            </div>
            
            {checkResult !== null && (
              <div className={`mt-4 p-3 rounded-xl text-xs font-medium border flex items-center gap-2 animate-fade-in ${
                checkResult.length > 0 
                  ? 'bg-red-500/10 text-red-400 border-red-500/20' 
                  : 'bg-green-500/10 text-green-400 border-green-500/20'
              }`}>
                {checkResult.length > 0 ? <ShieldIcon className="w-4 h-4" /> : <CheckIcon className="w-4 h-4" />}
                {checkResult.length > 0
                  ? `${t('sensitiveWords.found')}: ${checkResult.join(', ')}`
                  : t('sensitiveWords.clean')}
              </div>
            )}
          </section>

          {/* Learned Words */}
          {words && words.learned.length > 0 && (
            <section>
              <h3 className="text-sm font-bold text-yellow-400 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]"></span>
                {t('sensitiveWords.learnedTitle')} <span className="text-gray-500 font-normal">({words.learned.length})</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {words.learned.map((w) => (
                  <div key={w} className="group inline-flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-xs text-yellow-200 transition-all hover:bg-yellow-500/20">
                    <span>{w}</span>
                    <div className="flex items-center gap-1 border-l border-yellow-500/20 pl-2 ml-1">
                      <button onClick={() => handleConfirm(w)} title={t('common.confirm')} className="text-yellow-500/70 hover:text-green-400 transition-colors p-0.5">
                        <CheckIcon className="w-3 h-3" />
                      </button>
                      <button onClick={() => handleRemove(w)} title={t('common.delete')} className="text-yellow-500/70 hover:text-red-400 transition-colors p-0.5">
                        <CloseIcon className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Manual Words */}
          {words && words.manual.length > 0 && (
            <section>
              <h3 className="text-sm font-bold text-gray-200 mb-3 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
                {t('sensitiveWords.manualTitle')} <span className="text-gray-500 font-normal">({words.manual.length})</span>
              </h3>
              <div className="flex flex-wrap gap-2">
                {words.manual.map((w) => (
                  <div key={w} className="group inline-flex items-center gap-2 px-3 py-1.5 bg-[#1a1a1a] border border-white/10 rounded-lg text-xs text-gray-300 transition-all hover:bg-[#222] hover:border-white/20">
                    <span>{w}</span>
                    <button onClick={() => handleRemove(w)} className="text-gray-500 hover:text-red-400 transition-colors p-0.5 ml-1">
                      <CloseIcon className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
