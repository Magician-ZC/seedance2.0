// 剧本角斗场类型定义

// 六维度评分
export interface DimensionScores {
  plotStructure: number;       // 剧情结构 0-10
  characterization: number;    // 人物塑造 0-10
  dialogueQuality: number;     // 对白质量 0-10
  pacing: number;              // 节奏把控 0-10
  creativity: number;          // 创意新颖度 0-10
  commercialPotential: number; // 商业潜力 0-10
}

// 评审角色类型
export type ReviewRole = 'hitScreenwriter' | 'platformReviewer' | 'audienceProxy' | 'authorAgent';

// 单角色评分结果
export interface RoleScoreResult {
  role: ReviewRole;
  scores: DimensionScores;
  comments: Record<keyof DimensionScores, string>;
  weight: number;
}

// 综合评分结果
export interface ArenaScoreResult {
  id: string;
  screenplayId: string;
  mode: 'single' | 'panel';
  roleScores: RoleScoreResult[];
  finalScores: DimensionScores;
  finalComments: Record<keyof DimensionScores, string>;
  skippedRoles: ReviewRole[];
  createdAt: number;
}

// 对战维度结果
export interface DimensionBattleResult {
  dimension: keyof DimensionScores;
  scoreA: number;
  scoreB: number;
  winner: 'a' | 'b' | 'draw';
  comment: string;
}

// 对战结果
export interface BattleResult {
  id: string;
  screenplayIdA: string;
  screenplayIdB: string;
  dimensionResults: DimensionBattleResult[];
  finalVerdict: 'a' | 'b' | 'draw';
  improvementSuggestions: string[];
  eloChangeA: number;
  eloChangeB: number;
  createdAt: number;
}

// 锦标赛
export interface TournamentResult {
  id: string;
  format: 'elimination' | 'round-robin';
  screenplayIds: string[];
  rounds: TournamentRound[];
  championId: string | null;
  status: 'pending' | 'running' | 'completed';
}

export interface TournamentRound {
  roundNumber: number;
  matches: TournamentMatch[];
}

export interface TournamentMatch {
  screenplayIdA: string;
  screenplayIdB: string | null; // null = 轮空
  battleId?: string;
  winner?: string;
}

// 排行榜条目
export interface LeaderboardEntry {
  screenplayId: string;
  title: string;
  elo: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  latestScore?: DimensionScores;
}

// 进化方案
export interface EvolutionPlan {
  elements: EvolutionElement[];
}

export interface EvolutionElement {
  id: string;
  category: 'plot' | 'character' | 'dialogue' | 'pacing' | 'scene' | 'style';
  description: string;
  expectedEffect: string;
  sourceDetail: string;
}

// 进化记录
export interface EvolutionRecord {
  id: string;
  sourceScreenplayId: string;
  targetScreenplayId: string;
  winnerScreenplayId: string;
  battleId: string;
  absorbedElements: EvolutionElement[];
  evolutionType: 'enhance' | 'expand' | 'style_merge';
  generation: number;
  createdAt: number;
}

// 剧本角斗场历史
export interface ScreenplayArenaHistory {
  screenplayId: string;
  battles: BattleResult[];
  evolutions: EvolutionRecord[];
  scores: ArenaScoreResult[];
}

// 角斗场剧本信息（列表展示用）
export interface ArenaScreenplayInfo {
  id: string;
  title: string;
  episodeCount: number;
  elo: number;
  latestScore?: DimensionScores;
  generation: number;
  createdAt: number;
}
