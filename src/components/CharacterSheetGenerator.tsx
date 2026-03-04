// 角色设定图生成器 - 支持三视图、表情设定等
import { useState } from 'react';
import { getStyleById } from '../constants/visual-styles';
import StylePicker from './StylePicker';
import { CheckIcon, SparkleIcon, CloseIcon } from './Icons';

// 设定图元素类型
const SHEET_ELEMENTS = [
  { 
    id: 'three-view', 
    label: '三视图', 
    prompt: 'front view, side view, back view, turnaround',
    description: '正面、侧面、背面三视图结构',
    default: true 
  },
  { 
    id: 'expressions', 
    label: '表情设定', 
    prompt: 'expression sheet, multiple facial expressions, happy, sad, angry, surprised',
    description: '多种面部表情展示',
    default: true 
  },
  { 
    id: 'proportions', 
    label: '比例设定', 
    prompt: 'height chart, body proportions, head-to-body ratio reference',
    description: '身体比例、头身比参考',
    default: false 
  },
  { 
    id: 'poses', 
    label: '动作设定', 
    prompt: 'pose sheet, various action poses, standing, sitting, running',
    description: '各种常见动作姿势',
    default: false 
  },
] as const;

type SheetElementId = typeof SHEET_ELEMENTS[number]['id'];

interface CharacterSheetGeneratorProps {
  characterName: string;
  characterDesc: string;
  onGenerate: (prompt: string, negativePrompt: string) => Promise<string>;
  onSave: (imageUrl: string) => void;
  existingImage?: string;
}

export default function CharacterSheetGenerator({
  characterName,
  characterDesc,
  onGenerate,
  onSave,
  existingImage,
}: CharacterSheetGeneratorProps) {
  const [description, setDescription] = useState(characterDesc);
  const [selectedStyle, setSelectedStyle] = useState<string>('3d_render_2d');
  const [selectedElements, setSelectedElements] = useState<SheetElementId[]>(
    SHEET_ELEMENTS.filter(e => e.default).map(e => e.id)
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const toggleElement = (elementId: SheetElementId) => {
    setSelectedElements(prev => 
      prev.includes(elementId) 
        ? prev.filter(e => e !== elementId)
        : [...prev, elementId]
    );
  };

  const buildPrompt = (): { prompt: string; negativePrompt: string } => {
    const stylePreset = getStyleById(selectedStyle);
    const styleTokens = stylePreset?.prompt || 'anime style, professional quality';
    const isRealistic = stylePreset?.category === 'real';
    
    // 基础提示词
    const basePrompt = isRealistic
      ? `professional character reference for "${characterName}", ${description}, real person`
      : `professional character design sheet for "${characterName}", ${description}`;
    
    // 内容组合
    const contentParts: string[] = [];
    if (selectedElements.includes('three-view')) {
      contentParts.push('three-view turnaround (front view, side view, back view)');
    }
    if (selectedElements.includes('expressions')) {
      contentParts.push('expression sheet with multiple facial expressions (happy, sad, angry, surprised, neutral)');
    }
    if (selectedElements.includes('proportions')) {
      contentParts.push('body proportion reference, height chart, head-to-body ratio guide');
    }
    if (selectedElements.includes('poses')) {
      contentParts.push('pose sheet with various action poses (standing, sitting, running, jumping)');
    }
    
    const contentPrompt = contentParts.join(', ');
    
    // 完整提示词
    const fullPrompt = isRealistic
      ? `${basePrompt}, ${contentPrompt}, character reference sheet layout, white background, clean presentation, ${styleTokens}, photorealistic, real human, NOT anime, NOT cartoon, NOT illustration, NOT drawing`
      : `${basePrompt}, ${contentPrompt}, character reference sheet layout, white background, clean presentation, ${styleTokens}, detailed illustration, concept art, character model sheet`;
    
    const negativePrompt = stylePreset?.negativePrompt || 'blurry, low quality, watermark, text, cropped';
    
    return { prompt: fullPrompt, negativePrompt };
  };

  const handleGenerate = async () => {
    if (!description.trim() || selectedElements.length === 0) return;
    
    setIsGenerating(true);
    try {
      const { prompt, negativePrompt } = buildPrompt();
      const imageUrl = await onGenerate(prompt, negativePrompt);
      setPreviewUrl(imageUrl);
    } catch (error) {
      console.error('生成失败:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSavePreview = () => {
    if (previewUrl) {
      onSave(previewUrl);
      setPreviewUrl(null);
    }
  };

  // 预览模式
  if (previewUrl) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <span className="text-amber-400">👁</span> 预览角色设定图
          </h3>
          <span className="text-xs text-amber-500 font-medium px-2 py-0.5 bg-amber-500/10 rounded border border-amber-500/20">
            待确认
          </span>
        </div>

        <div className="relative rounded-xl overflow-hidden border border-amber-500/30 bg-[#111] shadow-lg shadow-amber-900/10">
          <img src={previewUrl} alt={`${characterName} 设定预览`} className="w-full h-auto" />
          <div className="absolute top-2 left-2 bg-amber-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm">
            PREVIEW
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={handleSavePreview}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl text-sm font-bold transition-all shadow-lg shadow-green-900/20 hover:scale-[1.02] flex items-center justify-center gap-2">
            <CheckIcon className="w-4 h-4" /> 保存设定图
          </button>
          <button onClick={handleGenerate}
            className="flex-1 bg-[#1a1a1a] hover:bg-[#222] text-white py-3 rounded-xl text-sm font-medium border border-white/10 transition-all hover:border-white/20 flex items-center justify-center gap-2">
            <span className="text-lg">↺</span> 重新生成
          </button>
        </div>

        <button onClick={() => setPreviewUrl(null)}
          className="w-full text-gray-500 hover:text-white py-2 text-xs transition-colors flex items-center justify-center gap-1">
          <CloseIcon className="w-3 h-3" /> 放弃并返回
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <SparkleIcon className="w-4 h-4 text-purple-400" />
          生成角色设定图
        </h3>
        {existingImage && <span className="text-xs text-green-400 font-medium">已保存</span>}
      </div>

      {/* 已有设定图预览 */}
      {existingImage && (
        <div className="relative rounded-xl overflow-hidden border border-green-500/30 bg-[#111] group">
          <img src={existingImage} alt={`${characterName} 设定`} className="w-full h-auto opacity-80 group-hover:opacity-100 transition-opacity" />
          <div className="absolute top-2 left-2 bg-green-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm">
            SAVED
          </div>
        </div>
      )}

      {/* 角色描述 */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">角色描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="详细描述角色外观，例如：一只橙色的小猫，有大大的蓝色眼睛，毛茸茸的尾巴，戴着红色铃铛项圈..."
          className="w-full bg-[#0a0a0a] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 outline-none focus:border-green-500/50 resize-none h-[100px] placeholder-gray-600 transition-all focus:bg-[#111]"
          disabled={isGenerating}
        />
      </div>

      {/* 视觉风格选择 */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">视觉风格</label>
        <StylePicker
          selectedStyleId={selectedStyle}
          onStyleChange={setSelectedStyle}
          disabled={isGenerating}
        />
      </div>

      {/* 设定图内容选择 */}
      <div className="space-y-2">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wider">设定图内容</label>
        <div className="grid grid-cols-1 gap-2">
          {SHEET_ELEMENTS.map((element) => (
            <div
              key={element.id}
              onClick={() => !isGenerating && toggleElement(element.id)}
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer group ${
                selectedElements.includes(element.id)
                  ? 'border-green-500/50 bg-green-500/10'
                  : 'border-white/5 hover:border-white/20 bg-[#111]'
              } ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                selectedElements.includes(element.id)
                  ? 'bg-green-500 border-green-500'
                  : 'border-white/20 group-hover:border-white/40'
              }`}>
                {selectedElements.includes(element.id) && (
                  <CheckIcon className="w-3.5 h-3.5 text-white" />
                )}
              </div>
              <div className="flex-1">
                <div className={`text-sm font-medium transition-colors ${selectedElements.includes(element.id) ? 'text-green-400' : 'text-gray-300'}`}>{element.label}</div>
                <p className="text-[10px] text-gray-500 mt-0.5">{element.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 生成按钮 */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || selectedElements.length === 0 || !description.trim()}
        className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:from-gray-800 disabled:to-gray-800 disabled:text-gray-500 text-white py-3.5 rounded-xl text-sm font-bold transition-all shadow-lg shadow-purple-900/20 hover:scale-[1.02] active:scale-[0.98] flex items-center justify-center gap-2"
      >
        {isGenerating ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            正在生成...
          </>
        ) : (
          <>
            <SparkleIcon className="w-4 h-4" />
            {existingImage ? '重新生成设定图' : '生成角色设定图'}
          </>
        )}
      </button>

      {/* 提示 */}
      <div className="text-[10px] text-gray-600 space-y-1 bg-[#111] p-3 rounded-lg border border-white/5">
        <p className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-gray-500"></span> 生成后可预览确认，满意再保存</p>
        <p className="flex items-center gap-1.5"><span className="w-1 h-1 rounded-full bg-gray-500"></span> 三视图可用于角色一致性参考</p>
      </div>
    </div>
  );
}
