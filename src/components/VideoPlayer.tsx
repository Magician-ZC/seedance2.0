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
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8 animate-fade-in">
        <div className="relative">
          <div className="absolute inset-0 bg-green-500/20 blur-xl rounded-full animate-pulse"></div>
          <SpinnerIcon className="w-16 h-16 text-green-400 relative z-10" />
        </div>
        <div className="text-center space-y-2">
          <p className="text-green-400 font-medium tracking-wide animate-pulse">{progress || t('generate.processing')}</p>
          <p className="text-gray-500 text-xs font-mono">{t('generate.waitHint')}</p>
        </div>
        
        {/* Progress Bar Visual */}
        <div className="w-64 h-1 bg-gray-800 rounded-full overflow-hidden mt-4">
          <div className="h-full bg-gradient-to-r from-green-600 to-emerald-400 animate-progress"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 animate-fade-in">
        <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20 shadow-[0_0_30px_rgba(239,68,68,0.2)]">
          <span className="text-3xl text-red-400">!</span>
        </div>
        <div className="text-center max-w-md space-y-2">
          <h3 className="text-red-400 font-semibold">{t('common.error')}</h3>
          <p className="text-gray-400 text-sm leading-relaxed">{error}</p>
          <p className="text-gray-600 text-xs mt-2">{t('generate.checkSettings')}</p>
        </div>
      </div>
    );
  }

  if (videoUrl) {
    const proxied = proxyUrl(videoUrl);
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 p-4 md:p-8 animate-fade-in w-full h-full">
        <div className="w-full h-full max-w-5xl max-h-[80vh] bg-black rounded-3xl overflow-hidden border border-white/10 shadow-2xl relative group flex flex-col">
          <video 
            controls 
            src={proxied} 
            className="w-full h-full object-contain bg-black" 
            autoPlay 
            loop 
          />
          
          {/* Overlay Controls */}
          <div className="absolute top-0 left-0 right-0 p-6 bg-gradient-to-b from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none">
             <div className="flex justify-end gap-3 pointer-events-auto">
              {onShare && (
                <button onClick={onShare} className="bg-white/10 hover:bg-white/20 backdrop-blur-md text-white px-4 py-2 rounded-xl text-xs font-bold transition-all border border-white/5 hover:scale-105 active:scale-95">
                  {t('common.share')}
                </button>
              )}
              <a href={proxied} download="seedance-video.mp4" className="bg-green-600/90 hover:bg-green-500 backdrop-blur-md text-white px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-lg shadow-green-900/30 hover:scale-105 active:scale-95 flex items-center gap-2">
                <DownloadIcon className="w-3.5 h-3.5" />
                {t('generate.downloadVideo')}
              </a>
            </div>
          </div>
        </div>
        
        {revisedPrompt && (
          <div className="max-w-2xl w-full bg-[#111] border border-white/5 rounded-xl p-4 transition-all hover:border-white/10">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1 font-bold">Prompt Used</div>
            <p className="text-gray-300 text-xs leading-relaxed font-mono">{revisedPrompt}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 opacity-40 hover:opacity-60 transition-opacity duration-500">
      <div className="w-32 h-32 rounded-3xl bg-[#1c1f2e] flex items-center justify-center border border-white/5 rotate-3 shadow-2xl">
        <FilmIcon className="w-12 h-12 text-gray-500" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-gray-400 font-medium">{t('generate.videoReady')}</p>
        <p className="text-xs text-gray-600 font-mono">{t('generate.supportHint')}</p>
      </div>
    </div>
  );
}
