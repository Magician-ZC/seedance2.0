// 后端共享类型定义

export type ModelKey = 'seedance-2.0' | 'seedance-2.0-fast';

export interface TaskInfo {
  id: string;
  status: 'processing' | 'done' | 'error';
  progress: string;
  startTime: number;
  result: VideoGenerationResult | null;
  error: string | null;
  // 扩展字段：历史记录
  prompt?: string;
  model?: ModelKey;
  ratio?: string;
  duration?: number;
  thumbnailUrl?: string;
}

export interface VideoGenerationResult {
  created: number;
  data: Array<{
    url: string;
    revised_prompt: string;
  }>;
}

export interface GenerateVideoParams {
  prompt: string;
  ratio: string;
  duration: number;
  files: Express.Multer.File[];
  sessionId: string;
  model: string;
}

export interface UploadedImage {
  uri: string;
  width: number;
  height: number;
}

export interface MetaItem {
  meta_type: 'text' | 'image';
  text: string;
  material_ref?: { material_idx: number };
}

export interface HistoryRecord {
  id: string;
  taskId: string;
  prompt: string;
  model: ModelKey;
  ratio: string;
  duration: number;
  videoUrl: string;
  thumbnailUrl?: string;
  createdAt: number;
  status: 'done' | 'error';
  error?: string;
}

export interface PresetTemplate {
  id: string;
  name: string;
  nameEn: string;
  model: ModelKey;
  ratio: string;
  duration: number;
  promptPrefix?: string;
}

// WebSocket 消息类型
export interface WsMessage {
  type: 'task_progress' | 'task_done' | 'task_error';
  taskId: string;
  data: {
    status: string;
    progress?: string;
    elapsed?: number;
    result?: VideoGenerationResult;
    error?: string;
  };
}

// 视频分辨率配置
export interface ResolutionConfig {
  width: number;
  height: number;
}

export const MODEL_MAP: Record<string, string> = {
  'seedance-2.0': 'dreamina_seedance_40_pro',
  'seedance-2.0-fast': 'dreamina_seedance_40',
};

export const BENEFIT_TYPE_MAP: Record<string, string> = {
  'seedance-2.0': 'dreamina_video_seedance_20_pro',
  'seedance-2.0-fast': 'dreamina_seedance_20_fast',
};

export const VIDEO_RESOLUTION: Record<string, ResolutionConfig> = {
  '1:1': { width: 720, height: 720 },
  '4:3': { width: 960, height: 720 },
  '3:4': { width: 720, height: 960 },
  '16:9': { width: 1280, height: 720 },
  '9:16': { width: 720, height: 1280 },
  '21:9': { width: 1680, height: 720 },
};

export const DEFAULT_PRESETS: PresetTemplate[] = [
  { id: 'cinematic-landscape', name: '电影风景', nameEn: 'Cinematic Landscape', model: 'seedance-2.0', ratio: '21:9', duration: 10 },
  { id: 'social-vertical', name: '社交竖屏', nameEn: 'Social Vertical', model: 'seedance-2.0-fast', ratio: '9:16', duration: 5 },
  { id: 'product-showcase', name: '产品展示', nameEn: 'Product Showcase', model: 'seedance-2.0', ratio: '16:9', duration: 8 },
  { id: 'quick-preview', name: '快速预览', nameEn: 'Quick Preview', model: 'seedance-2.0-fast', ratio: '4:3', duration: 4 },
  { id: 'story-episode', name: '短剧分集', nameEn: 'Story Episode', model: 'seedance-2.0', ratio: '16:9', duration: 15, promptPrefix: '水墨武侠风格，' },
  { id: 'square-ad', name: '方形广告', nameEn: 'Square Ad', model: 'seedance-2.0-fast', ratio: '1:1', duration: 6 },
];
