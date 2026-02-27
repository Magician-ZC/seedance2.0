// 角色设定图生成器 - 支持三视图、表情设定等
import { useState } from 'react';
import { getStyleById } from '../constants/visual-styles';
import StylePicker from './StylePicker';

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
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium text-white">预览角色设定图</h3>
          <span className="text-xs text-amber-500 flex items-center gap-1">
            ⚠ 待确认
          </span>
        </div>

        <div className="relative rounded-xl overflow-hidden border-2 border-amber-500/50 bg-[#1a1a1a]">
          <img src={previewUrl} alt={`${characterName} 设定预览`} className="w-full h-auto" />
          <div className="absolute top-2 left-2 bg-amber-500 text-white text-xs px-2 py-1 rounded">
            预览
          </div>
        </div>

        <div className="flex gap-2">
          <button onClick={handleSavePreview}
            className="flex-1 bg-green-600 hover:bg-green-500 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">
            ✓ 保存设定图
          </button>
          <button onClick={handleGenerate}
            className="flex-1 bg-[#1a1a1a] hover:bg-[#222] text-white py-2.5 rounded-xl text-sm font-medium border border-white/10 transition-colors">
            🔄 重新生成
          </button>
        </div>

        <button onClick={() => setPreviewUrl(null)}
          className="w-full text-gray-500 hover:text-white py-2 text-sm transition-colors">
          放弃并返回
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-medium text-white">生成角色设定图</h3>

      {/* 已有设定图预览 */}
      {existingImage && (
        <div className="relative rounded-xl overflow-hidden border bg-[#1a1a1a]">
          <img src={existingImage} alt={`${characterName} 设定`} className="w-full h-auto" />
          <div className="absolute top-2 left-2 bg-green-500 text-white text-xs px-2 py-1 rounded">
            已保存
          </div>
        </div>
      )}

      {/* 角色描述 */}
      <div className="space-y-2">
        <label className="text-xs text-gray-400">角色描述（用于AI生成）</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="详细描述角色外观，例如：一只橙色的小猫，有大大的蓝色眼睛，毛茸茸的尾巴，戴着红色铃铛项圈..."
          className="w-full bg-[#1a1a1a] border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-300 outline-none focus:border-green-500/50 resize-none h-[100px] placeholder-gray-600 transition-colors"
          disabled={isGenerating}
        />
      </div>

      {/* 视觉风格选择 */}
      <div className="space-y-2">
        <label className="text-xs text-gray-400">视觉风格</label>
        <StylePicker
          selectedStyleId={selectedStyle}
          onStyleChange={setSelectedStyle}
          disabled={isGenerating}
        />
      </div>

      {/* 设定图内容选择 */}
      <div className="space-y-2">
        <label className="text-xs text-gray-400">设定图内容</label>
        <div className="space-y-2">
          {SHEET_ELEMENTS.map((element) => (
            <div
              key={element.id}
              onClick={() => !isGenerating && toggleElement(element.id)}
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all cursor-pointer ${
                selectedElements.includes(element.id)
                  ? 'border-green-500/50 bg-green-600/10'
                  : 'border-white/10 hover:border-white/20'
              } ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 mt-0.5 ${
                selectedElements.includes(element.id)
                  ? 'bg-green-600 border-green-600'
                  : 'border-white/20'
              }`}>
                {selectedElements.includes(element.id) && (
                  <span className="text-white text-xs">✓</span>
                )}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-white">{element.label}</div>
                <p className="text-xs text-gray-500 mt-0.5">{element.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 生成按钮 */}
      <button
        onClick={handleGenerate}
        disabled={isGenerating || selectedElements.length === 0 || !description.trim()}
        className="w-full bg-green-600 hover:bg-green-500 disabled:bg-gray-700 text-white py-3 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
      >
        {isGenerating ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            正在生成角色设定图...
          </>
        ) : (
          <>
            <span>🎨</span>
            {existingImage ? '重新生成设定图' : '生成角色设定图'}
          </>
        )}
      </button>

      {/* 提示 */}
      <div className="text-xs text-gray-500 space-y-1">
        <p>💡 生成后可预览确认，满意再保存</p>
        <p>💡 三视图可用于角色一致性参考</p>
      </div>
    </div>
  );
}
