import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon, CheckIcon } from './Icons';

interface ShareModalProps {
  videoUrl: string;
  prompt?: string;
  onClose: () => void;
}

export default function ShareModal({ videoUrl, prompt, onClose }: ShareModalProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const proxyUrl = `${window.location.origin}/api/video-proxy?url=${encodeURIComponent(videoUrl)}`;
  const shareText = prompt ? `${prompt}\n\n${proxyUrl}` : proxyUrl;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity" onClick={onClose} />
      <div className="relative bg-[#1c1f2e] border border-white/10 rounded-3xl p-6 max-w-md w-full mx-4 shadow-2xl animate-scale-in">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg text-white font-bold flex items-center gap-2">
            <span className="text-xl">📤</span> {t('share.title')}
          </h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors text-gray-400 hover:text-white">
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {prompt && (
          <div className="mb-4">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2 block">Prompt</label>
            <p className="text-sm text-gray-300 line-clamp-3 bg-[#111] p-3 rounded-xl border border-white/5">{prompt}</p>
          </div>
        )}

        <div className="space-y-2 mb-6">
          <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Video Link</label>
          <div className="bg-[#111] rounded-xl p-3 border border-white/5 flex items-center justify-between gap-3">
            <p className="text-xs text-gray-400 truncate font-mono select-all flex-1">{proxyUrl}</p>
          </div>
        </div>

        <button
          onClick={handleCopy}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-bold transition-all shadow-lg shadow-purple-900/20 active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {copied ? <CheckIcon className="w-4 h-4" /> : null}
          {copied ? t('share.linkCopied') : t('share.copyLink')}
        </button>
      </div>
    </div>
  );
}
