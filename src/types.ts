export type AspectRatio = '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';

export type Duration = 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15;

export type ModelId = 'seedance-2.0' | 'seedance-2.0-fast';

export interface ModelOption {
  value: ModelId;
  label: string;
  description: string;
}

export type ReferenceMode = '全能参考' | '首帧参考' | '尾帧参考';

export interface UploadedImage {
  id: string;
  file: File;
  previewUrl: string;
  index: number;
}

export interface GenerateVideoRequest {
  prompt: string;
  model: ModelId;
  ratio: AspectRatio;
  duration: Duration;
  files: File[];
  sessionId?: string;
  autoGenImage?: boolean;
}

export interface VideoGenerationResponse {
  created: number;
  data: Array<{
    url: string;
    revised_prompt: string;
  }>;
}

export type GenerationStatus = 'idle' | 'generating' | 'success' | 'error';

export interface GenerationState {
  status: GenerationStatus;
  progress?: string;
  result?: VideoGenerationResponse;
  error?: string;
}

export interface RatioOption {
  value: AspectRatio;
  label: string;
  widthRatio: number;
  heightRatio: number;
}

export const RATIO_OPTIONS: RatioOption[] = [
  { value: '21:9', label: '21:9', widthRatio: 21, heightRatio: 9 },
  { value: '16:9', label: '16:9', widthRatio: 16, heightRatio: 9 },
  { value: '4:3', label: '4:3', widthRatio: 4, heightRatio: 3 },
  { value: '1:1', label: '1:1', widthRatio: 1, heightRatio: 1 },
  { value: '3:4', label: '3:4', widthRatio: 3, heightRatio: 4 },
  { value: '9:16', label: '9:16', widthRatio: 9, heightRatio: 16 },
];

export const DURATION_OPTIONS: Duration[] = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export const REFERENCE_MODES: ReferenceMode[] = ['全能参考', '首帧参考', '尾帧参考'];

export const MODEL_OPTIONS: ModelOption[] = [
  {
    value: 'seedance-2.0',
    label: 'Seedance 2.0',
    description: '全能主角，音视频图均可参考(暂不支持真人入镜)',
  },
  {
    value: 'seedance-2.0-fast',
    label: 'Seedance 2.0 Fast',
    description: '精简时长，音视频图均可参考(暂不支持真人入镜)',
  },
];

// 预设模板
export interface PresetTemplate {
  id: string;
  name: string;
  nameEn: string;
  model: ModelId;
  ratio: AspectRatio;
  duration: Duration;
  promptPrefix?: string;
}

export const DEFAULT_PRESETS: PresetTemplate[] = [
  { id: 'cinematic-landscape', name: '电影风景', nameEn: 'Cinematic Landscape', model: 'seedance-2.0', ratio: '21:9', duration: 10 },
  { id: 'social-vertical', name: '社交竖屏', nameEn: 'Social Vertical', model: 'seedance-2.0-fast', ratio: '9:16', duration: 5 },
  { id: 'product-showcase', name: '产品展示', nameEn: 'Product Showcase', model: 'seedance-2.0', ratio: '16:9', duration: 8 },
  { id: 'quick-preview', name: '快速预览', nameEn: 'Quick Preview', model: 'seedance-2.0-fast', ratio: '4:3', duration: 4 },
  { id: 'story-episode', name: '短剧分集', nameEn: 'Story Episode', model: 'seedance-2.0', ratio: '16:9', duration: 15, promptPrefix: '水墨武侠风格，' },
  { id: 'square-ad', name: '方形广告', nameEn: 'Square Ad', model: 'seedance-2.0-fast', ratio: '1:1', duration: 6 },
];
