// 短剧制片模块类型定义

// ==================== 项目 ====================

export type ProductionStatus =
  | 'created'
  | 'script_uploaded'
  | 'cleaning'
  | 'asset_extracting'
  | 'asset_confirmed'
  | 'generating'
  | 'voice_generating'
  | 'compositing'
  | 'composing'
  | 'composed'
  | 'done';

export interface ProductionConfig {
  ratio: '9:16' | '16:9';
  episodeDuration: { min: number; max: number };
  shotDuration: { min: number; max: number };
  language: string;
  requireSubtitles: boolean;
  forbiddenShotTypes: string[];
  qualityRules: string[];
}

export const DEFAULT_PRODUCTION_CONFIG: ProductionConfig = {
  ratio: '9:16',
  episodeDuration: { min: 50, max: 60 },
  shotDuration: { min: 1, max: 3 },
  language: 'en',
  requireSubtitles: true,
  forbiddenShotTypes: ['慢镜头', '发呆镜头', '人物背面镜头', '思考镜头'],
  qualityRules: [
    '口型对准',
    '人物一致性保持',
    '需有背景音乐',
    '英文字幕准确',
    '重要角色登场需标注名称',
    '禁止CG风场景',
    '不可有明显穿帮',
    '血腥暴力需远景处理',
  ],
};

export interface ProductionProject {
  id: string;
  title: string;
  status: ProductionStatus;
  totalEpisodes: number;
  config: ProductionConfig;
  requirementsText?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface ProductionProjectListItem {
  id: string;
  title: string;
  status: ProductionStatus;
  totalEpisodes: number;
  createdAt: number;
  updatedAt: number;
}

// ==================== 分镜 ====================

export type ShotStatus = 'pending' | 'generating' | 'done' | 'error';
export type AudioStatus = 'pending' | 'generating' | 'done' | 'error';

export interface ProductionShot {
  index: number;
  scene: string;
  content: string;
  cameraWork: string;
  visualRequirement: string;
  soundDesign: string;
  duration: number;
  dialogue?: string;
  dialogueParsed?: DialogueLine[];
  note?: string;
  characterRefs: string[];
  locationRefs: string[];
  propRefs: string[];
  refImageUrls?: string[];
  videoUrl?: string;
  videoStatus?: ShotStatus;
  videoError?: string;
  audioUrl?: string;
  audioStatus?: AudioStatus;
  audioError?: string;
}

export interface DialogueLine {
  characterId: string;
  characterName: string;
  text: string;
  emotion?: string;
  direction?: string;
}

export type EpisodeStatus =
  | 'raw'
  | 'cleaned'
  | 'shots_ready'
  | 'generating'
  | 'voice_done'
  | 'composed'
  | 'done';

export interface ProductionEpisode {
  id: string;
  projectId: string;
  episodeNumber: number;
  rawScript?: string;
  cleanedScript?: string;
  shots: ProductionShot[];
  status: EpisodeStatus;
  videoUrl?: string;
  composedUrl?: string;
  createdAt: number;
  updatedAt?: number;
}

// ==================== 资产 ====================

export type AssetType = 'character' | 'location' | 'prop';
export type AssetStatus = 'extracted' | 'image_generating' | 'images_ready' | 'confirmed';

export interface ProfileImages {
  main?: string;
  front?: string;
  side?: string;
  back?: string;
  costume?: string;
  props?: string;
  expressions?: string;
  custom?: Array<{ label: string; url: string }>;
}

export interface CharacterMetadata {
  age: string;
  gender: string;
  faceType: string;
  eyes: string;
  hair: string;
  skinColor: string;
  bodyType: string;
  clothing: string;
  shoes: string;
  signatureFeatures: string;
  personality: string;
  background: string;
  keyExperiences: string;
}

export interface LocationMetadata {
  interior: boolean;
  timeOfDay: string;
  atmosphere: string;
  keyElements: string[];
}

export interface PropMetadata {
  category: string;
  associatedCharacter?: string;
  description: string;
}

export interface ProductionAsset {
  id: string;
  projectId: string;
  assetType: AssetType;
  name: string;
  description: string;
  visualPrompt?: string;
  metadata: CharacterMetadata | LocationMetadata | PropMetadata;
  imageUrls: string[];
  profileImages?: ProfileImages;
  voiceProfileId?: string;
  version: number;
  status: AssetStatus;
  createdAt: number;
  updatedAt?: number;
}

export interface AssetVariant {
  id: string;
  assetId: string;
  episodeNumber: number;
  variantLabel: string;
  description: string;
  visualPrompt?: string;
  imageUrls: string[];
  metadataOverride?: Partial<CharacterMetadata>;
  createdAt: number;
}

// ==================== 语音 ====================

export type TTSProviderType = 'doubao';

export interface VoiceOption {
  voiceId: string;
  name: string;
  gender: string;
  language: string;
  sampleUrl?: string;
  tags?: string[];
}

export interface VoiceProfile {
  id: string;
  projectId: string;
  characterAssetId?: string;
  provider: TTSProviderType;
  voiceId: string;
  voiceName: string;
  language: string;
  speed: number;
  pitch: number;
  emotion?: string;
  sampleAudioUrl?: string;
  createdAt: number;
}

// ==================== 质检 ====================

export type QualityLevel = 'pass' | 'warning' | 'fail';

export interface QualityCheckItem {
  rule: string;
  level: QualityLevel;
  message: string;
  episodeNumber?: number;
  shotIndex?: number;
}

export interface QualityReport {
  projectId: string;
  totalChecks: number;
  passed: number;
  warnings: number;
  failures: number;
  items: QualityCheckItem[];
  checkedAt: number;
}

// ==================== 工作台Tab ====================

export type ProductionWorkspaceTab =
  | 'script'
  | 'assets'
  | 'voice'
  | 'timeline'
  | 'quality';

// ==================== 分段 / 音乐 ====================

export type SegmentStatus = 'pending' | 'generating' | 'done' | 'error';
export type MusicStatus = 'pending' | 'generating' | 'done' | 'error';

export interface ProductionSegment {
  id: string;
  projectId: string;
  episodeId: string;
  segmentIndex: number;
  shotIds: number[];
  totalDuration: number;
  mergedPrompt: string;
  transitionHint: string;
  videoUrl?: string;
  musicUrl?: string;
  composedUrl?: string;
  videoStatus: SegmentStatus;
  musicStatus: MusicStatus;
  createdAt: number;
}

export interface MusicTrack {
  id: string;
  segmentId: string;
  source: 'suno' | 'manual';
  prompt?: string;
  audioUrl: string;
  duration: number;
  createdAt: number;
}

export interface SunoConfig {
  apiKey: string;
  baseUrl?: string;
}

export function statusToDefaultProductionTab(status: ProductionStatus): ProductionWorkspaceTab {
  switch (status) {
    case 'created':
    case 'script_uploaded':
    case 'cleaning':
      return 'script';
    case 'asset_extracting':
    case 'asset_confirmed':
      return 'assets';
    case 'voice_generating':
      return 'voice';
    case 'generating':
    case 'compositing':
    case 'composing':
    case 'composed':
    case 'done':
      return 'timeline';
    default:
      return 'script';
  }
}
