import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from './Icons';

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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1c1f2e] border border-gray-800 rounded-3xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg text-gray-200 font-medium">{t('share.title')}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-800">
            <CloseIcon className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {prompt && <p className="text-sm text-gray-400 mb-3 line-clamp-2">{prompt}</p>}

        <div className="bg-[#161824] rounded-xl p-3 border border-gray-700 mb-4">
          <p className="text-xs text-gray-400 break-all select-all">{proxyUrl}</p>
        </div>

        <button
          onClick={handleCopy}
          className="w-full py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-sm font-bold transition-all"
        >
          {copied ? t('share.linkCopied') : t('share.copyLink')}
        </button>
      </div>
    </div>
  );
}
