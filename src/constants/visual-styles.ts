// 视觉风格预设 - 用于角色三视图生成
// 参考 moyin-creator 的风格系统

export type StyleCategory = '3d' | '2d' | 'real';

export interface StylePreset {
  id: string;
  name: string;
  category: StyleCategory;
  prompt: string;
  negativePrompt: string;
  description: string;
}

// 3D 风格
const STYLES_3D: StylePreset[] = [
  {
    id: '3d_xuanhuan',
    name: '3D玄幻',
    category: '3d',
    prompt: 'best quality, masterpiece, 8k, high detailed, stunning stylized 3D Chinese animation character render, Unreal Engine 5 style, cinematic lighting, soft volumetric fog, smooth porcelain skin texture, intricate traditional Chinese fabric details, fine embroidery, flowing robes, ethereal atmosphere, glowing spiritual energy, beautiful facial features, delicate body proportions, sharp focus, detailed background',
    negativePrompt: 'worst quality, low quality, bad quality, blurry, fuzzy, distorted, out of focus, 2D, flat, drawing, painting, sketch, anime, cartoon, realistic, photo, real life, photography, western style, modern clothing, extra limbs, missing limbs, mutated hands, distorted body, ugly, watermark, signature, text',
    description: '中国风玄幻，仙侠，虚幻引擎渲染，光效华丽',
  },
  {
    id: '3d_american',
    name: '3D美式',
    category: '3d',
    prompt: 'best quality, masterpiece, 8k, high detailed, Disney Pixar style 3D animation, expressive character design, large eyes, subsurface scattering skin, vibrant colors, warm lighting, cute, 3d render, cgsociety, detailed background, soft edges',
    negativePrompt: 'worst quality, low quality, bad quality, blurry, fuzzy, 2D, flat, sketch, anime, gloomy, dark, gritty, realistic, photo, ugly, distorted',
    description: '迪士尼/皮克斯风格，美式3D动画，色彩鲜艳',
  },
  {
    id: '3d_render_2d',
    name: '3D渲染2D',
    category: '3d',
    prompt: 'best quality, masterpiece, 8k, high detailed, Genshin Impact style, cel shaded 3D, anime style 3d rendering, clean lines, vibrant anime colors, 2.5d, toon shading',
    negativePrompt: 'worst quality, low quality, blurry, realistic, photorealistic, sketch, rough lines, heavy shadows, ugly, distorted',
    description: '三渲二，卡通渲染，原神风格',
  },
];

// 2D 动画
const STYLES_2D: StylePreset[] = [
  {
    id: '2d_animation',
    name: '2D动画',
    category: '2d',
    prompt: 'best quality, masterpiece, 8k, high detailed, standard Japanese anime style, clean lineart, flat color, anime character design, vibrant, detailed eyes',
    negativePrompt: 'worst quality, low quality, blurry, 3D, realistic, photorealistic, cgi, sketch, messy, ugly, bad anatomy',
    description: '标准日式2D动画风格',
  },
  {
    id: '2d_shoujo',
    name: '2D少女漫画',
    category: '2d',
    prompt: 'best quality, masterpiece, 8k, high detailed, shoujo manga style, delicate lineart, soft pastel colors, sparkles, flowers, romantic atmosphere, beautiful detailed eyes, flowing hair',
    negativePrompt: 'worst quality, low quality, blurry, 3D, realistic, dark, gritty, ugly, bad anatomy',
    description: '少女漫画风格，柔和色彩，浪漫氛围',
  },
  {
    id: '2d_ink',
    name: '2D水墨',
    category: '2d',
    prompt: 'best quality, masterpiece, 8k, high detailed, Chinese ink painting style, traditional brush strokes, flowing robes, martial arts, wuxia aesthetic, elegant composition, misty atmosphere',
    negativePrompt: 'worst quality, low quality, blurry, 3D, realistic, modern, western, ugly',
    description: '水墨武侠风格，传统国风',
  },
];

// 真人风格
const STYLES_REAL: StylePreset[] = [
  {
    id: 'real_cinematic',
    name: '真人电影',
    category: 'real',
    prompt: 'best quality, masterpiece, 8k, high detailed, cinematic photography, professional portrait, film grain, natural lighting, depth of field, sharp focus, realistic skin texture',
    negativePrompt: 'anime, cartoon, illustration, drawing, painting, 3D render, low quality, blurry, distorted',
    description: '电影级真人摄影，自然光照',
  },
  {
    id: 'real_fashion',
    name: '真人时尚',
    category: 'real',
    prompt: 'best quality, masterpiece, 8k, high detailed, fashion photography, studio lighting, professional model, high fashion, editorial style, clean background, sharp details',
    negativePrompt: 'anime, cartoon, illustration, 3D, low quality, blurry, amateur, casual',
    description: '时尚摄影，工作室光照',
  },
];

export const VISUAL_STYLE_PRESETS: StylePreset[] = [
  ...STYLES_3D,
  ...STYLES_2D,
  ...STYLES_REAL,
];

export const DEFAULT_STYLE_ID = '3d_render_2d';

// 根据 ID 获取风格
export function getStyleById(styleId: string): StylePreset | undefined {
  return VISUAL_STYLE_PRESETS.find(s => s.id === styleId);
}

// 获取风格的提示词
export function getStylePrompt(styleId: string): string {
  const style = getStyleById(styleId);
  return style?.prompt || VISUAL_STYLE_PRESETS[0].prompt;
}

// 获取风格的负面提示词
export function getStyleNegativePrompt(styleId: string): string {
  const style = getStyleById(styleId);
  return style?.negativePrompt || VISUAL_STYLE_PRESETS[0].negativePrompt;
}

// 获取风格名称
export function getStyleName(styleId: string): string {
  const style = getStyleById(styleId);
  return style?.name || styleId;
}

// 按分类获取风格列表
export function getStylesByCategory(category: StyleCategory): StylePreset[] {
  return VISUAL_STYLE_PRESETS.filter(s => s.category === category);
}
