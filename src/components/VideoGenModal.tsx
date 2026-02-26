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
import { CloseIcon, PlusIcon, SparkleIcon } from './Icons';

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
    <div className="fixed inset-0 z-[150] flex">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex w-full max-w-[1200px] max-h-[90vh] m-auto bg-[#0a0a0a] border border-white/10 rounded-2xl overflow-hidden shadow-2xl">
        {/* Left: Config */}
        <div className="w-[480px] flex-shrink-0 border-r border-white/5 overflow-y-auto custom-scrollbar p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-white">{t('generate.title')}</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
              <CloseIcon className="w-5 h-5 text-gray-400" />
            </button>
          </div>

          <div className="space-y-5">
            <PresetSelector onSelect={handlePreset} />

            {/* Reference Images */}
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm font-medium text-gray-300">{t('generate.refImages')}</label>
                {images.length > 0 && (
                  <button onClick={clearAllImages} className="text-xs text-red-400 hover:text-red-300">{t('generate.clearAll')}</button>
                )}
              </div>
              {images.length > 0 && (
                <div className="flex flex-wrap gap-3 mb-3">
                  {images.map((img) => (
                    <div key={img.id} className="relative group w-20 h-20 flex-shrink-0">
                      <img src={img.previewUrl} alt={`ref ${img.index}`} className="w-full h-full object-cover rounded-xl border border-white/10" />
                      <span className="absolute bottom-0 left-0 bg-black/70 text-[10px] text-green-400 px-1.5 py-0.5 rounded-br-xl rounded-tl-xl font-medium">@{img.index}</span>
                      <button onClick={() => removeImage(img.id)} className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-gray-800 border border-white/10 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600">
                        <CloseIcon className="w-3 h-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {images.length < maxImages && (
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}
                  className={`w-full ${images.length === 0 ? 'h-32' : 'h-20'} border border-dashed border-white/10 rounded-xl flex flex-col items-center justify-center bg-[#111] cursor-pointer hover:border-green-500/30 hover:bg-[#151515] transition-all`}
                >
                  <PlusIcon className="w-5 h-5 text-gray-600 mb-1" />
                  <span className="text-xs text-gray-600">
                    {images.length === 0 ? t('generate.uploadHint') : t('generate.uploadMore', { current: images.length, max: maxImages })}
                  </span>
                </div>
              )}
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
              <label className="flex items-center gap-2 mt-2 cursor-pointer">
                <input type="checkbox" checked={autoGenImage} onChange={(e) => setAutoGenImage(e.target.checked)}
                  className="w-4 h-4 rounded border-white/20 bg-[#111] text-green-500 focus:ring-green-500 focus:ring-offset-0" />
                <span className="text-xs text-gray-500">{t('generate.autoGenImage')}</span>
              </label>
            </div>

            {/* Prompt */}
            <div className="bg-[#111] rounded-xl p-4 border border-white/5">
              <label className="block text-sm font-medium mb-2 text-gray-300">{t('generate.prompt')}</label>
              <textarea
                className="w-full bg-transparent text-sm resize-none focus:outline-none min-h-[80px] placeholder-gray-600 text-gray-200"
                placeholder={t('generate.promptPlaceholder')}
                value={prompt} onChange={(e) => setPrompt(e.target.value)} maxLength={5000} disabled={isGenerating}
              />
              <div className="text-right text-xs text-gray-600 mt-1">{prompt.length}/5000</div>
            </div>

            {/* Model / Ratio / Duration */}
            <div className="bg-[#111] rounded-xl p-4 border border-white/5 space-y-4">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-2">{t('generate.selectModel')}</label>
                <div className="flex flex-col gap-2">
                  {MODEL_OPTIONS.map((opt) => (
                    <button key={opt.value} onClick={() => setModel(opt.value)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${model === opt.value ? 'border-green-500/50 bg-green-500/5' : 'border-white/5 bg-[#0a0a0a] hover:border-white/10'}`}>
                      <div className={`text-sm font-medium ${model === opt.value ? 'text-green-400' : 'text-gray-400'}`}>{opt.label}</div>
                      <div className="text-xs text-gray-600 mt-0.5">{opt.description}</div>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-2">{t('generate.refMode')}</label>
                <div className="flex gap-2">
                  {REFERENCE_MODES.map((mode) => (
                    <button key={mode} onClick={() => setReferenceMode(mode)}
                      className={`flex-1 py-2 rounded-lg text-sm border transition-all ${referenceMode === mode ? 'border-green-500/50 bg-green-500/5 text-green-400' : 'border-white/5 bg-[#0a0a0a] text-gray-500 hover:border-white/10'}`}>
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-2">{t('generate.aspectRatio')}</label>
                <div className="grid grid-cols-6 gap-1.5">
                  {RATIO_OPTIONS.map((opt) => {
                    const isSelected = opt.value === ratio;
                    const maxDim = 20;
                    const scale = maxDim / Math.max(opt.widthRatio, opt.heightRatio);
                    const w = Math.round(opt.widthRatio * scale);
                    const h = Math.round(opt.heightRatio * scale);
                    return (
                      <button key={opt.value} onClick={() => setRatio(opt.value)}
                        className={`flex flex-col items-center gap-1 py-2 rounded-lg border transition-all ${isSelected ? 'border-green-500/50 bg-green-500/5' : 'border-white/5 bg-[#0a0a0a] hover:border-white/10'}`}>
                        <div className="flex items-center justify-center w-6 h-6">
                          <div className={`rounded-sm border ${isSelected ? 'border-green-400' : 'border-gray-600'}`} style={{ width: `${w}px`, height: `${h}px` }} />
                        </div>
                        <span className={`text-[10px] ${isSelected ? 'text-green-400' : 'text-gray-500'}`}>{opt.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider block mb-2">{t('generate.duration')}</label>
                <div className="flex flex-wrap gap-1.5">
                  {DURATION_OPTIONS.map((d) => (
                    <button key={d} onClick={() => setDuration(d)}
                      className={`px-2.5 py-1.5 rounded-lg text-sm border transition-all ${duration === d ? 'border-green-500/50 bg-green-500/5 text-green-400' : 'border-white/5 bg-[#0a0a0a] text-gray-500 hover:border-white/10'}`}>
                      {d}{t('generate.seconds')}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Generate */}
            <div className="pb-2">
              {isGenerating && (
                <div className="mb-3">
                  <div className="text-xs text-gray-500 mb-1">{generation.progress || t('generate.processing')}</div>
                  <div className="w-full h-1.5 bg-[#1a1a1a] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-green-600 to-green-400 rounded-full animate-progress" />
                  </div>
                </div>
              )}
              <div className="flex gap-3">
                <button onClick={handleGenerate} disabled={!canGenerate}
                  className="flex-1 bg-gradient-to-r from-green-600 to-green-500 hover:from-green-500 hover:to-green-400 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-600 text-white font-medium py-3 rounded-xl transition-all flex items-center justify-center gap-2">
                  {isGenerating ? (
                    <><span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />{t('generate.generating')}</>
                  ) : (
                    <><SparkleIcon className="w-4 h-4" />{t('generate.generateBtn')}</>
                  )}
                </button>
                <button onClick={handleReset} disabled={isGenerating}
                  className="px-5 bg-[#1a1a1a] hover:bg-[#222] disabled:text-gray-700 text-gray-300 font-medium py-3 rounded-xl transition-all border border-white/5">
                  {t('common.reset')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Preview */}
        <div className="flex-1 bg-[#050505] overflow-y-auto flex flex-col">
          <VideoPlayer
            videoUrl={videoUrl} revisedPrompt={revisedPrompt} isLoading={isGenerating}
            error={generation.status === 'error' ? generation.error : undefined} progress={generation.progress}
            onShare={videoUrl ? () => setShowShare(true) : undefined}
          />
        </div>
      </div>

      {showShare && videoUrl && <ShareModal videoUrl={videoUrl} prompt={revisedPrompt} onClose={() => setShowShare(false)} />}
    </div>
  );
}
