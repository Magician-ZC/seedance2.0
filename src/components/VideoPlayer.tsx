import { useTranslation } from 'react-i18next';
import { SpinnerIcon, FilmIcon, DownloadIcon } from './Icons';

interface VideoPlayerProps {
  videoUrl: string | null;
  revisedPrompt?: string;
  isLoading: boolean;
  error?: string;
  progress?: string;
  onShare?: () => void;
}

function proxyUrl(url: string): string {
  return `/api/video-proxy?url=${encodeURIComponent(url)}`;
}

export default function VideoPlayer({ videoUrl, revisedPrompt, isLoading, error, progress, onShare }: VideoPlayerProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4">
        <div className="relative"><SpinnerIcon className="w-12 h-12 text-purple-400" /></div>
        <div className="text-center">
          <p className="text-gray-300 text-sm">{progress || t('generate.processing')}</p>
          <p className="text-gray-500 text-xs mt-1">{t('generate.waitHint')}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
        <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
          <span className="text-2xl text-red-400">!</span>
        </div>
        <div className="text-center max-w-md">
          <p className="text-red-400 text-sm">{error}</p>
          <p className="text-gray-500 text-xs mt-1">{t('generate.checkSettings')}</p>
        </div>
      </div>
    );
  }

  if (videoUrl) {
    const proxied = proxyUrl(videoUrl);
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-4 md:p-8">
        <div className="w-full max-w-4xl bg-black rounded-2xl overflow-hidden border border-gray-800 shadow-2xl relative group">
          <video controls src={proxied} className="w-full max-h-[80vh] mx-auto" autoPlay loop />
          <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            {onShare && (
              <button onClick={onShare} className="bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-4 py-2 rounded-lg text-sm font-bold">
                {t('common.share')}
              </button>
            )}
            <a href={proxied} download="seedance-video.mp4" className="bg-white/20 hover:bg-white/30 backdrop-blur-md text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2">
              <DownloadIcon className="w-4 h-4" />{t('generate.downloadVideo')}
            </a>
          </div>
        </div>
        {revisedPrompt && <p className="text-gray-400 text-xs text-center max-w-lg">{revisedPrompt}</p>}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 opacity-50">
      <div className="w-24 h-24 rounded-full bg-[#1c1f2e] flex items-center justify-center border border-gray-800">
        <FilmIcon className="w-8 h-8 text-gray-600" />
      </div>
      <p className="text-gray-600">{t('generate.videoReady')}</p>
      <p className="text-xs text-gray-700">{t('generate.supportHint')}</p>
    </div>
  );
}
