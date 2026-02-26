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
}

export interface LocationInfo {
  id: string;
  originalName: string;
  newName: string;
  description: string;
  visualPrompt?: string;
  imageUrl?: string;
  imageUrls?: string[];
}

export interface Shot {
  index: number;
  startTime: number;
  endTime: number;
  prompt: string;
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
