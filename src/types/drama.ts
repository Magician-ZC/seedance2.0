// 短剧项目相关类型定义

export interface CharacterInfo {
  id: string;
  originalName: string;
  newName: string;
  role: string;
  description: string;
  visualPrompt?: string;
  imageUrls: string[];
  confirmed: boolean;
  refImageUrl?: string;
  profileImages?: {
    main?: string;
    front?: string;
    side?: string;
    back?: string;
    costume?: string;
    props?: string;
    expressions?: string;
    custom?: Array<{ label: string; url: string }>;
  };
  profileStatus?: 'idle' | 'main_generating' | 'main_scoring' | 'detail_generating' | 'done';
}

export interface LocationInfo {
  id: string;
  originalName: string;
  newName: string;
  description: string;
  visualPrompt?: string;
  baseDescription?: string;    // 固定物理属性（不随镜头变化）
  baseVisualPrompt?: string;   // 基准生图 prompt（空场景，保证跨集一致性）
  spatialRelation?: string;    // 空间关系描述
  parentId?: string;           // 父级场景 ID
  adjacentLocations?: Array<{ id: string; direction: string; visibleFrom: boolean }>;
  variants?: Array<{ label: string; description: string }>;  // 状态变体，共享同一基准图
  imageUrl?: string;
  imageUrls?: string[];
}

export interface SpatialMap {
  tree: string;
  relations: Array<{ from: string; to: string; direction: string; bidirectionalView: boolean }>;
}

export interface Shot {
  index: number;
  startTime: number;
  endTime: number;
  prompt: string;
  dialogue?: string;
  action?: string;
  cameraAngle?: string;
  soundDesign?: string;
  characterRefs: string[];
  locationRefs: string[];
  transition?: string;
  refImageUrls?: string[];
  videoUrl?: string;
  videoStatus?: 'pending' | 'generating' | 'done' | 'error';
  videoError?: string;
}

export interface EpisodeScript {
  number: number;
  title: string;
  act: string;
  prompt: string;
  shots: Shot[];
  refImageUrls?: string[];
  videoUrl?: string;
  videoStatus?: 'pending' | 'generating' | 'done' | 'error';
  videoError?: string;
  score?: number;
}

export interface DramaProject {
  id: string;
  status: string;
  novel: {
    title: string;
    summary: string;
    characters: CharacterInfo[];
    locations: LocationInfo[];
    spatialMap?: SpatialMap;
    plotPoints: Array<{ chapter: number; summary: string; emotionalTone: string }>;
    themes: string[];
  };
  targetEpisodes: number;
  style: string;
  episodes: EpisodeScript[];
  createdAt: number;
  updatedAt?: number;
}

export interface DraftItem {
  id: string;
  title: string;
  status: string;
  style: string;
  targetEpisodes: number;
  createdAt: number;
  updatedAt: number;
}

// 后端 status → 工作台 tab 映射
export type WorkspaceTab = 'outline' | 'script' | 'characters' | 'materials';

export function statusToDefaultTab(status: string): WorkspaceTab {
  switch (status) {
    case 'analyzing':
    case 'copyright_check':
    case 'copyright':
      return 'outline';
    case 'character_confirm':
      return 'characters';
    case 'scripting':
    case 'ready':
    case 'batch_generating':
    case 'batch_done':
    case 'batch_partial':
      return 'script';
    default:
      return 'outline';
  }
}
