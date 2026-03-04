import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AspectRatio, Duration, ModelId, ReferenceMode, UploadedImage,
  GenerationState, PresetTemplate,
} from '../types';
import { RATIO_OPTIONS, DURATION_OPTIONS, REFERENCE_MODES, MODEL_OPTIONS } from '../types';
import { generateVideo } from '../services/videoService';
import { addHistory } from '../services/historyService';
import VideoPlayer from './VideoPlayer';
import PresetSelector from './PresetSelector';
import ShareModal from './ShareModal';
import { CloseIcon, PlusIcon, SparkleIcon, CheckIcon } from './Icons';

let nextId = 0;

interface VideoGenModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessionId: string;
}

export default function VideoGenModal({ isOpen, onClose, sessionId }: VideoGenModalProps) {
  const { t } = useTranslation();
  const [images, setImages] = useState<UploadedImage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState<ModelId>('seedance-2.0-fast');
  const [ratio, setRatio] = useState<AspectRatio>('16:9');
  const [duration, setDuration] = useState<Duration>(5);
  const [referenceMode, setReferenceMode] = useState<ReferenceMode>('全能参考');
  const [generation, setGeneration] = useState<GenerationState>({ status: 'idle' });
  const [autoGenImage, setAutoGenImage] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maxImages = 5;

  const addFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const remaining = maxImages - images.length;
    if (remaining <= 0) return;
    const newFiles = Array.from(fileList).slice(0, remaining);
    const newImages: UploadedImage[] = newFiles.map((file, i) => ({
      id: `img-${++nextId}`, file, previewUrl: URL.createObjectURL(file), index: images.length + i + 1,
    }));
    setImages([...images, ...newImages]);
  }, [images]);

  const removeImage = useCallback((id: string) => {
    const removed = images.find((img) => img.id === id);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
    setImages(images.filter((img) => img.id !== id).map((img, i) => ({ ...img, index: i + 1 })));
  }, [images]);

  const clearAllImages = useCallback(() => {
    images.forEach((img) => URL.revokeObjectURL(img.previewUrl));
    setImages([]);
  }, [images]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() && images.length === 0) return;
    if (generation.status === 'generating') return;
    setGeneration({ status: 'generating', progress: t('generate.submitting') });
    try {
      const result = await generateVideo(
        { prompt, model, ratio, duration, files: images.map((img) => img.file), sessionId: sessionId || undefined, autoGenImage },
        (progress) => setGeneration((prev) => ({ ...prev, progress })),
      );
      if (result.data?.[0]?.url) {
        setGeneration({ status: 'success', result });
        addHistory({
          id: crypto.randomUUID(), prompt, model, ratio, duration,
          videoUrl: result.data[0].url, createdAt: Date.now(), status: 'done',
        });
      } else {
        setGeneration({ status: 'error', error: '未获取到视频结果，请重试' });
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : '未知错误';
      setGeneration({ status: 'error', error: msg });
      addHistory({ id: crypto.randomUUID(), prompt, model, ratio, duration, videoUrl: '', createdAt: Date.now(), status: 'error', error: msg });
    }
  }, [prompt, images, model, ratio, duration, sessionId, generation.status, t, autoGenImage]);

  const handleReset = () => { setPrompt(''); clearAllImages(); setGeneration({ status: 'idle' }); };

  const handlePreset = (preset: PresetTemplate) => {
    setModel(preset.model);
    setRatio(preset.ratio);
    setDuration(preset.duration);
    if (preset.promptPrefix && !prompt.startsWith(preset.promptPrefix)) {
      setPrompt(preset.promptPrefix + prompt);
    }
  };

  const videoUrl = generation.status === 'success' && generation.result?.data?.[0]?.url ? generation.result.data[0].url : null;
  const revisedPrompt = generation.status === 'success' ? generation.result?.data?.[0]?.revised_prompt : undefined;
  const isGenerating = generation.status === 'generating';
  const canGenerate = (prompt.trim() || images.length > 0) && !isGenerating;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full h-full md:w-[95vw] md:h-[90vh] max-w-[1600px] bg-[#0a0a0a] md:rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row border border-white/5">
        
        {/* Left: Config Panel */}
        <div className="w-full md:w-[480px] lg:w-[520px] flex-shrink-0 border-r border-white/5 bg-[#0a0a0a] flex flex-col h-full z-10">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur-sm sticky top-0 z-20">
            <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></span>
              {t('generate.title')}
            </h2>
            <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-colors text-gray-400 hover:text-white">
              <CloseIcon className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-8">
            {/* Presets */}
            <section>
              <PresetSelector onSelect={handlePreset} />
            </section>

            {/* Reference Images */}
            <section className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                  {t('generate.refImages')}
                  <span className="text-xs font-normal text-gray-500 bg-white/5 px-2 py-0.5 rounded-full">{images.length}/{maxImages}</span>
                </label>
                {images.length > 0 && (
                  <button onClick={clearAllImages} className="text-xs text-red-400 hover:text-red-300 transition-colors px-2 py-1 hover:bg-red-900/20 rounded">
                    {t('generate.clearAll')}
                  </button>
                )}
              </div>
              
              <div className="grid grid-cols-4 gap-3">
                {images.map((img) => (
                  <div key={img.id} className="relative group aspect-square rounded-xl overflow-hidden border border-white/10 bg-[#111]">
                    <img src={img.previewUrl} alt={`ref ${img.index}`} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <button onClick={() => removeImage(img.id)} className="p-1.5 bg-red-500/80 rounded-full text-white hover:bg-red-600 transition-colors">
                        <CloseIcon className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="absolute bottom-1 left-1 bg-black/60 backdrop-blur-sm text-[10px] text-white px-1.5 py-0.5 rounded font-mono">@{img.index}</span>
                  </div>
                ))}
                
                {images.length < maxImages && (
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                    className="aspect-square border border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center bg-[#111]/50 cursor-pointer hover:border-green-500/40 hover:bg-green-500/5 transition-all group"
                  >
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center mb-1 group-hover:scale-110 transition-transform group-hover:bg-green-500/20">
                      <PlusIcon className="w-4 h-4 text-gray-400 group-hover:text-green-400" />
                    </div>
                    <span className="text-[10px] text-gray-500 group-hover:text-gray-300">Upload</span>
                  </div>
                )}
              </div>
              
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              
              <label className="flex items-center gap-2 cursor-pointer group w-fit">
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${autoGenImage ? 'bg-green-500 border-green-500' : 'border-white/20 bg-transparent group-hover:border-white/40'}`}>
                  {autoGenImage && <CheckIcon className="w-3 h-3 text-white" />}
                </div>
                <input type="checkbox" checked={autoGenImage} onChange={(e) => setAutoGenImage(e.target.checked)} className="hidden" />
                <span className="text-xs text-gray-400 group-hover:text-gray-300 transition-colors">{t('generate.autoGenImage')}</span>
              </label>
            </section>

            {/* Prompt */}
            <section className="space-y-3">
              <label className="text-sm font-semibold text-gray-200">{t('generate.prompt')}</label>
              <div className="relative group">
                <textarea
                  className="w-full bg-[#111] border border-white/10 rounded-xl p-4 text-sm text-gray-200 placeholder-gray-600 focus:border-green-500/50 focus:ring-1 focus:ring-green-500/20 transition-all resize-none min-h-[120px] leading-relaxed"
                  placeholder={t('generate.promptPlaceholder')}
                  value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={5000} disabled={isGenerating}
                />
                <div className="absolute bottom-3 right-3 text-[10px] text-gray-600 font-mono bg-[#111]/80 px-1.5 py-0.5 rounded border border-white/5">
                  {prompt.length}/5000
                </div>
              </div>
            </section>

            {/* Settings Grid */}
            <section className="grid grid-cols-1 gap-6 bg-[#111]/30 p-5 rounded-2xl border border-white/5">
              {/* Model */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">{t('generate.selectModel')}</label>
                <div className="grid grid-cols-1 gap-2">
                  {MODEL_OPTIONS.map((opt) => (
                    <button key={opt.value} onClick={() => setModel(opt.value)}
                      className={`flex items-center justify-between px-4 py-3 rounded-xl border transition-all text-left group ${model === opt.value ? 'border-green-500/30 bg-green-500/10' : 'border-white/5 bg-[#0a0a0a] hover:border-white/10 hover:bg-[#111]'}`}>
                      <div>
                        <div className={`text-sm font-medium ${model === opt.value ? 'text-green-400' : 'text-gray-300'}`}>{opt.label}</div>
                        <div className="text-[10px] text-gray-500 mt-0.5">{opt.description}</div>
                      </div>
                      {model === opt.value && <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reference Mode */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">{t('generate.refMode')}</label>
                <div className="flex p-1 bg-[#0a0a0a] rounded-xl border border-white/5">
                  {REFERENCE_MODES.map((mode) => (
                    <button key={mode} onClick={() => setReferenceMode(mode)}
                      className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${referenceMode === mode ? 'bg-white/10 text-white shadow-sm' : 'text-gray-500 hover:text-gray-300'}`}>
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Ratio & Duration Row */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">{t('generate.aspectRatio')}</label>
                  <div className="grid grid-cols-3 gap-2">
                    {RATIO_OPTIONS.map((opt) => {
                      const isSelected = opt.value === ratio;
                      return (
                        <button key={opt.value} onClick={() => setRatio(opt.value)}
                          className={`flex flex-col items-center justify-center gap-1.5 py-2.5 rounded-xl border transition-all ${isSelected ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-white/5 bg-[#0a0a0a] text-gray-500 hover:border-white/10 hover:bg-[#111]'}`}>
                          <span className="text-xs font-medium">{opt.label}</span>
                          <span className="text-[10px] opacity-60">{opt.value}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">{t('generate.duration')}</label>
                  <div className="grid grid-cols-2 gap-2">
                    {DURATION_OPTIONS.map((d) => (
                      <button key={d} onClick={() => setDuration(d)}
                        className={`py-2.5 rounded-xl border text-xs font-medium transition-all ${duration === d ? 'border-green-500/30 bg-green-500/10 text-green-400' : 'border-white/5 bg-[#0a0a0a] text-gray-500 hover:border-white/10 hover:bg-[#111]'}`}>
                        {d}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Footer Actions */}
          <div className="p-6 border-t border-white/5 bg-[#0a0a0a]/95 backdrop-blur sticky bottom-0 z-20">
            {isGenerating && (
              <div className="mb-4">
                <div className="flex justify-between text-xs text-gray-400 mb-2 font-mono">
                  <span>{generation.progress || t('generate.processing')}</span>
                  <span className="animate-pulse">...</span>
                </div>
                <div className="w-full h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-green-600 to-green-400 rounded-full animate-progress shadow-[0_0_10px_rgba(34,197,94,0.4)]" />
                </div>
              </div>
            )}
            <div className="flex gap-4">
              <button onClick={handleGenerate} disabled={!canGenerate}
                className="flex-1 relative overflow-hidden group bg-green-600 hover:bg-green-500 disabled:bg-[#1a1a1a] disabled:text-gray-600 text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-green-900/20 disabled:shadow-none flex items-center justify-center gap-2">
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                {isGenerating ? (
                  <><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />{t('generate.generating')}</>
                ) : (
                  <><SparkleIcon className="w-5 h-5" />{t('generate.generateBtn')}</>
                )}
              </button>
              <button onClick={handleReset} disabled={isGenerating}
                className="px-6 bg-[#1a1a1a] hover:bg-[#222] disabled:text-gray-700 text-gray-400 font-medium py-3.5 rounded-xl transition-all border border-white/5 hover:text-white">
                {t('common.reset')}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Preview Area */}
        <div className="flex-1 bg-[#050505] relative flex flex-col items-center justify-center p-8 overflow-hidden">
          {/* Background Grid */}
          <div className="absolute inset-0 opacity-20 pointer-events-none" 
            style={{ 
              backgroundImage: 'radial-gradient(#333 1px, transparent 1px)', 
              backgroundSize: '24px 24px' 
            }} 
          />
          
          <div className="w-full max-w-4xl aspect-video bg-[#0a0a0a] rounded-2xl border border-white/5 shadow-2xl overflow-hidden relative z-10 flex flex-col">
            <VideoPlayer
              videoUrl={videoUrl} revisedPrompt={revisedPrompt} isLoading={isGenerating}
              error={generation.status === 'error' ? generation.error : undefined} progress={generation.progress}
              onShare={videoUrl ? () => setShowShare(true) : undefined}
            />
          </div>
          
          {/* Status Text */}
          {!videoUrl && !isGenerating && !generation.error && (
            <div className="mt-8 text-center space-y-2 opacity-50">
              <p className="text-gray-500 text-sm">Ready to create</p>
              <p className="text-xs text-gray-700 font-mono">Configure settings on the left to start</p>
            </div>
          )}
        </div>
      </div>

      {showShare && videoUrl && <ShareModal videoUrl={videoUrl} prompt={revisedPrompt} onClose={() => setShowShare(false)} />}
    </div>
  );
}
