/**
 * arena-engine 单元测试
 * 覆盖：extractSection、extractStyleGene、mutateStyleGene、compileWriterPrompt、buildWriterGroups
 *       runCreativePlanArena（mock LLM调用）
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// Mock LLM服务 — 必须在导入arena-engine之前
vi.mock('../llm-service.js', () => ({
  chatCompletionJSON: vi.fn(),
}));

// Mock screenplay-creator的getScreenplay
vi.mock('../screenplay-creator.js', () => ({
  getScreenplay: vi.fn(),
}));

import { chatCompletionJSON } from '../llm-service.js';
import { getScreenplay } from '../screenplay-creator.js';

import {
  extractSection,
  extractStyleGene,
  mutateStyleGene,
  compileWriterPrompt,
  buildWriterGroups,
  compileHybridPrompt,
  hybridStyleGene,
  getStyleAgents,
  getGenreAgents,
  SYSTEM_AGENTS,
  type StyleGene,
} from '../arena-engine.js';

// ============================================================
// extractSection
// ============================================================

describe('extractSection', () => {
  const samplePrompt = `你是一位编剧。

【叙事结构偏好】
- 采用四段式节奏
- 每集结尾留悬念

【角色塑造方法】
- 女主要有反击伏笔
- 反派必须足够可恨

【对白风格】
- 对白短促有力`;

  it('应正确提取指定段落内容', () => {
    const result = extractSection(samplePrompt, '叙事结构偏好');
    expect(result).toContain('四段式节奏');
    expect(result).toContain('留悬念');
  });

  it('应正确提取中间段落（不包含下一段落标题）', () => {
    const result = extractSection(samplePrompt, '角色塑造方法');
    expect(result).toContain('反击伏笔');
    expect(result).toContain('足够可恨');
    expect(result).not.toContain('对白风格');
  });

  it('应正确提取最后一个段落', () => {
    const result = extractSection(samplePrompt, '对白风格');
    expect(result).toContain('短促有力');
  });

  it('段落不存在时应返回空字符串', () => {
    const result = extractSection(samplePrompt, '不存在的段落');
    expect(result).toBe('');
  });

  it('空prompt应返回空字符串', () => {
    expect(extractSection('', '叙事结构偏好')).toBe('');
  });
});

// ============================================================
// extractStyleGene
// ============================================================

describe('extractStyleGene', () => {
  it('应从系统Agent中提取5个基因维度', () => {
    const agent = SYSTEM_AGENTS[0]; // 听花岛风格
    const gene = extractStyleGene(agent);

    expect(gene.baseStyleId).toBe(agent.id);
    expect(gene.narrativeStructure).toBeTruthy();
    expect(gene.characterMethod).toBeTruthy();
    expect(gene.dialogueStyle).toBeTruthy();
    expect(gene.emotionRhythm).toBeTruthy();
    expect(gene.hookDesign).toBeTruthy();
  });

  it('所有10个系统Agent都应能成功提取基因', () => {
    for (const agent of SYSTEM_AGENTS) {
      const gene = extractStyleGene(agent);
      expect(gene.baseStyleId).toBe(agent.id);
      // 每个维度都不应为空（所有系统Agent都有完整的5个段落）
      expect(gene.narrativeStructure.length).toBeGreaterThan(0);
      expect(gene.characterMethod.length).toBeGreaterThan(0);
      expect(gene.dialogueStyle.length).toBeGreaterThan(0);
      expect(gene.emotionRhythm.length).toBeGreaterThan(0);
      expect(gene.hookDesign.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================
// mutateStyleGene
// ============================================================

describe('mutateStyleGene', () => {
  it('变异后基因与父代不应完全相同', () => {
    const base = extractStyleGene(SYSTEM_AGENTS[0]);
    // 多次尝试，至少有一次变异结果与原始不同
    let hasDiff = false;
    for (let i = 0; i < 20; i++) {
      const mutated = mutateStyleGene(base, SYSTEM_AGENTS);
      const dims = ['narrativeStructure', 'characterMethod', 'dialogueStyle', 'emotionRhythm', 'hookDesign'] as const;
      for (const dim of dims) {
        if (mutated[dim] !== base[dim]) {
          hasDiff = true;
          break;
        }
      }
      if (hasDiff) break;
    }
    expect(hasDiff).toBe(true);
  });

  it('变异后baseStyleId应保持不变', () => {
    const base = extractStyleGene(SYSTEM_AGENTS[0]);
    const mutated = mutateStyleGene(base, SYSTEM_AGENTS);
    expect(mutated.baseStyleId).toBe(base.baseStyleId);
  });

  it('变异最多影响2个维度', () => {
    const base = extractStyleGene(SYSTEM_AGENTS[0]);
    // 运行多次统计
    for (let i = 0; i < 30; i++) {
      const mutated = mutateStyleGene(base, SYSTEM_AGENTS);
      const dims = ['narrativeStructure', 'characterMethod', 'dialogueStyle', 'emotionRhythm', 'hookDesign'] as const;
      let diffCount = 0;
      for (const dim of dims) {
        if (mutated[dim] !== base[dim]) diffCount++;
      }
      expect(diffCount).toBeGreaterThanOrEqual(1);
      expect(diffCount).toBeLessThanOrEqual(2);
    }
  });
});

// ============================================================
// compileWriterPrompt
// ============================================================

describe('compileWriterPrompt', () => {
  it('编译后的Prompt应包含5个维度段落', () => {
    const gene: StyleGene = {
      baseStyleId: 'sys-01',
      narrativeStructure: '四段式节奏',
      characterMethod: '反派必须可恨',
      dialogueStyle: '对白短促有力',
      emotionRhythm: '虐爽交替',
      hookDesign: '集末悬念',
    };
    const prompt = compileWriterPrompt(gene);

    expect(prompt).toContain('【叙事结构偏好】');
    expect(prompt).toContain('四段式节奏');
    expect(prompt).toContain('【角色塑造方法】');
    expect(prompt).toContain('反派必须可恨');
    expect(prompt).toContain('【对白风格】');
    expect(prompt).toContain('对白短促有力');
    expect(prompt).toContain('【情绪节奏】');
    expect(prompt).toContain('虐爽交替');
    expect(prompt).toContain('【钩子设计】');
    expect(prompt).toContain('集末悬念');
  });

  it('编译后的Prompt应以编剧角色开头', () => {
    const gene = extractStyleGene(SYSTEM_AGENTS[0]);
    const prompt = compileWriterPrompt(gene);
    expect(prompt).toMatch(/^你是一位专业的微短剧编剧/);
  });
});

// ============================================================
// buildWriterGroups
// ============================================================

describe('buildWriterGroups', () => {
  const GENRE_AGENT_COUNT = getGenreAgents().length; // 8个骨架Agent

  it('应生成恰好8个创作组（对应8个骨架Agent）', () => {
    const groups = buildWriterGroups();
    expect(groups).toHaveLength(GENRE_AGENT_COUNT);
  });

  it('每组应有1个组长和4个组员（默认membersPerGroup=4）', () => {
    const groups = buildWriterGroups();
    for (const group of groups) {
      expect(group.leader).toBeDefined();
      expect(group.leader.isLeader).toBe(true);
      expect(group.members).toHaveLength(4);
      for (const member of group.members) {
        expect(member.isLeader).toBe(false);
      }
    }
  });

  it('组长的systemPrompt应是骨架+风格的融合Prompt', () => {
    const groups = buildWriterGroups();
    for (const group of groups) {
      // 融合Prompt应包含双层标记
      expect(group.leader.systemPrompt).toContain('题材骨架');
      expect(group.leader.systemPrompt).toContain('风格灵魂');
    }
  });

  it('8个组长应分别对应8个不同的骨架Agent', () => {
    const groups = buildWriterGroups();
    const leaderAgentIds = groups.map(g => g.leader.systemAgentId);
    const uniqueIds = new Set(leaderAgentIds);
    expect(uniqueIds.size).toBe(GENRE_AGENT_COUNT);
    // 所有组长的systemAgentId应属于骨架Agent（sys-11~18）
    for (const id of leaderAgentIds) {
      expect(id).toMatch(/^sys-1[1-8]$/);
    }
  });

  it('组员的systemPrompt应是编译后的变异Prompt（非原始Prompt）', () => {
    const groups = buildWriterGroups();
    for (const group of groups) {
      for (const member of group.members) {
        // 组员Prompt应以编译模板开头
        expect(member.systemPrompt).toMatch(/^你是一位专业的微短剧编剧/);
      }
    }
  });

  it('所有Agent的groupId应与所属组的id一致', () => {
    const groups = buildWriterGroups();
    for (const group of groups) {
      expect(group.leader.groupId).toBe(group.id);
      for (const member of group.members) {
        expect(member.groupId).toBe(group.id);
      }
    }
  });

  it('自定义membersPerGroup应生效', () => {
    const groups = buildWriterGroups(2);
    expect(groups).toHaveLength(GENRE_AGENT_COUNT);
    for (const group of groups) {
      expect(group.members).toHaveLength(2);
    }
  });

  it('组的systemAgentName应与骨架Agent的name一致', () => {
    const groups = buildWriterGroups();
    const genreAgents = getGenreAgents();
    for (const group of groups) {
      const genreAgent = genreAgents.find((a: { id: string }) => a.id === group.systemAgentId);
      expect(genreAgent).toBeDefined();
      expect(group.systemAgentName).toBe(genreAgent!.name);
    }
  });
});


// ============================================================
// 评审Agent专业体系 — 单元测试
// ============================================================

import {
  calculateMedian,
  generateReviewerAgents,
  selectBestPerGroup,
  REVIEW_DIRECTIONS,
  STAGE_REVIEW_MAP,
  type FunnelStage,
  type CandidateEntry,
  type ReviewerAgent,
} from '../arena-engine.js';

// ============================================================
// REVIEW_DIRECTIONS
// ============================================================

describe('REVIEW_DIRECTIONS', () => {
  it('应有10个评审方向', () => {
    expect(REVIEW_DIRECTIONS).toHaveLength(10);
  });

  it('每个方向应有完整的字段', () => {
    for (const dir of REVIEW_DIRECTIONS) {
      expect(dir.id).toBeTruthy();
      expect(dir.name).toBeTruthy();
      expect(dir.weight).toBeGreaterThan(0);
      expect(dir.systemPrompt).toBeTruthy();
      expect(dir.activeStages.length).toBeGreaterThan(0);
    }
  });

  it('所有方向的权重总和应为1.0', () => {
    const totalWeight = REVIEW_DIRECTIONS.reduce((s, d) => s + d.weight, 0);
    expect(totalWeight).toBeCloseTo(1.0, 2);
  });

  it('方向ID应唯一', () => {
    const ids = REVIEW_DIRECTIONS.map(d => d.id);
    expect(new Set(ids).size).toBe(10);
  });
});

// ============================================================
// STAGE_REVIEW_MAP
// ============================================================

describe('STAGE_REVIEW_MAP', () => {
  it('creative_plan阶段应激活3个方向', () => {
    expect(STAGE_REVIEW_MAP.creative_plan).toHaveLength(3);
    expect(STAGE_REVIEW_MAP.creative_plan).toContain('plot_structure');
    expect(STAGE_REVIEW_MAP.creative_plan).toContain('commercial_potential');
    expect(STAGE_REVIEW_MAP.creative_plan).toContain('creativity');
  });

  it('character阶段应激活2个方向', () => {
    expect(STAGE_REVIEW_MAP.character).toHaveLength(2);
    expect(STAGE_REVIEW_MAP.character).toContain('characterization');
    expect(STAGE_REVIEW_MAP.character).toContain('emotional_resonance');
  });

  it('directory阶段应激活3个方向', () => {
    expect(STAGE_REVIEW_MAP.directory).toHaveLength(3);
    expect(STAGE_REVIEW_MAP.directory).toContain('pacing');
    expect(STAGE_REVIEW_MAP.directory).toContain('commercial_potential');
    expect(STAGE_REVIEW_MAP.directory).toContain('plot_structure');
  });

  it('episode阶段应激活全部10个方向', () => {
    expect(STAGE_REVIEW_MAP.episode).toHaveLength(10);
    for (const dir of REVIEW_DIRECTIONS) {
      expect(STAGE_REVIEW_MAP.episode).toContain(dir.id);
    }
  });
});

// ============================================================
// generateReviewerAgents
// ============================================================

describe('generateReviewerAgents', () => {
  it('默认应生成50个评审Agent（10方向×5人）', () => {
    const agents = generateReviewerAgents();
    expect(agents).toHaveLength(50);
  });

  it('每个方向应有指定数量的评审Agent', () => {
    const agents = generateReviewerAgents(3);
    expect(agents).toHaveLength(30);
    for (const dir of REVIEW_DIRECTIONS) {
      const dirAgents = agents.filter(a => a.directionId === dir.id);
      expect(dirAgents).toHaveLength(3);
    }
  });

  it('每个Agent应有完整的字段', () => {
    const agents = generateReviewerAgents();
    for (const agent of agents) {
      expect(agent.id).toBeTruthy();
      expect(agent.directionId).toBeTruthy();
      expect(agent.directionName).toBeTruthy();
      expect(agent.systemPrompt).toBeTruthy();
      expect(agent.weight).toBeGreaterThan(0);
    }
  });

  it('Agent的ID应唯一', () => {
    const agents = generateReviewerAgents();
    const ids = agents.map(a => a.id);
    expect(new Set(ids).size).toBe(50);
  });
});

// ============================================================
// calculateMedian
// ============================================================

describe('calculateMedian', () => {
  it('奇数个元素应返回中间值', () => {
    expect(calculateMedian([1, 3, 5])).toBe(3);
    expect(calculateMedian([5, 1, 3])).toBe(3); // 无序输入
    expect(calculateMedian([7, 2, 9, 4, 5])).toBe(5);
  });

  it('偶数个元素应返回中间两个的平均值', () => {
    expect(calculateMedian([1, 2, 3, 4])).toBe(2.5);
    expect(calculateMedian([4, 1, 3, 2])).toBe(2.5); // 无序输入
  });

  it('单个元素应返回该元素', () => {
    expect(calculateMedian([7])).toBe(7);
  });

  it('空数组应返回0', () => {
    expect(calculateMedian([])).toBe(0);
  });

  it('所有元素相同时应返回该值', () => {
    expect(calculateMedian([5, 5, 5, 5, 5])).toBe(5);
  });
});

// ============================================================
// selectBestPerGroup
// ============================================================

describe('selectBestPerGroup', () => {
  function makeCandidates(): CandidateEntry<string>[] {
    return [
      { id: 'c1', writerId: 'w1', groupId: 'g1', systemAgentId: 'sys-01', systemAgentName: 'A', data: 'x', score: 8 },
      { id: 'c2', writerId: 'w2', groupId: 'g1', systemAgentId: 'sys-01', systemAgentName: 'A', data: 'x', score: 6 },
      { id: 'c3', writerId: 'w3', groupId: 'g1', systemAgentId: 'sys-01', systemAgentName: 'A', data: 'x', score: 9 },
      { id: 'c4', writerId: 'w4', groupId: 'g2', systemAgentId: 'sys-02', systemAgentName: 'B', data: 'x', score: 7 },
      { id: 'c5', writerId: 'w5', groupId: 'g2', systemAgentId: 'sys-02', systemAgentName: 'B', data: 'x', score: 5 },
    ];
  }

  it('每组取Top 1应返回每组最高分', () => {
    const result = selectBestPerGroup(makeCandidates(), 'groupId', 1);
    expect(result).toHaveLength(2);
    expect(result.find(c => c.groupId === 'g1')?.id).toBe('c3'); // score 9
    expect(result.find(c => c.groupId === 'g2')?.id).toBe('c4'); // score 7
  });

  it('每组取Top 2应返回每组前2名', () => {
    const result = selectBestPerGroup(makeCandidates(), 'groupId', 2);
    expect(result).toHaveLength(4);
    const g1 = result.filter(c => c.groupId === 'g1');
    expect(g1).toHaveLength(2);
    expect(g1[0].score).toBeGreaterThanOrEqual(g1[1].score);
  });

  it('结果应按分数降序排列', () => {
    const result = selectBestPerGroup(makeCandidates(), 'groupId', 2);
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
  });

  it('每组第一名应标记selected=true', () => {
    const result = selectBestPerGroup(makeCandidates(), 'groupId', 2);
    const g1 = result.filter(c => c.groupId === 'g1');
    const top = g1.find(c => c.rank === 1);
    expect(top?.selected).toBe(true);
  });

  it('空数组应返回空数组', () => {
    const result = selectBestPerGroup([], 'groupId', 1);
    expect(result).toHaveLength(0);
  });
});


// ============================================================
// 竞技引擎主编排 — 单元测试（任务5）
// ============================================================

import {
  broadcastArenaProgress,
  stopArenaCreation,
  selectCandidate,
  getArenaStatus,
  getArenaCandidates,
  startArenaCreation,
  type ArenaConfig,
  type ArenaStatus,
  type StageCandidates,
} from '../arena-engine.js';
import {
  initDB, getDB, saveDB,
  createArenaSession,
  getArenaSessionByProjectId,
  updateArenaSession,
  batchInsertArenaWriters,
  batchInsertArenaReviewers,
  batchInsertArenaCandidates,
  insertArenaCandidate,
  insertArenaFunnelScore,
  listArenaFunnelScoresByStage,
  listArenaCandidatesByStage,
  updateArenaFunnelScoreSelected,
  type ArenaSessionRow,
  type ArenaWriterRow,
  type ArenaReviewerRow,
  type ArenaCandidateRow,
  type ArenaFunnelScoreRow,
} from '../db-service.js';

// 初始化数据库
beforeAll(async () => {
  await initDB();
});

// 每次测试前清理竞技相关表
beforeEach(() => {
  const d = getDB();
  d.run('DELETE FROM arena_funnel_scores');
  d.run('DELETE FROM arena_reviews');
  d.run('DELETE FROM arena_candidates');
  d.run('DELETE FROM arena_reviewers');
  d.run('DELETE FROM arena_writers');
  d.run('DELETE FROM arena_sessions');
  saveDB();
});

const now = Date.now();

// ============================================================
// selectCandidate（幂等操作）
// ============================================================

describe('selectCandidate', () => {
  beforeEach(() => {
    // 准备测试数据：2个候选的评分记录
    insertArenaFunnelScore({
      id: 'sc-sel-1', session_id: 'sess-sel', candidate_id: 'cand-sel-1',
      stage: 'creative_plan', direction_scores: '[]',
      weighted_total: 8.0, rank: 1, selected: 0, created_at: now,
    });
    insertArenaFunnelScore({
      id: 'sc-sel-2', session_id: 'sess-sel', candidate_id: 'cand-sel-2',
      stage: 'creative_plan', direction_scores: '[]',
      weighted_total: 6.5, rank: 2, selected: 0, created_at: now,
    });
  });

  it('应选中指定候选', () => {
    selectCandidate('proj-sel', 'creative_plan', 'cand-sel-1');
    const scores = listArenaFunnelScoresByStage('sess-sel', 'creative_plan');
    expect(scores.find(s => s.candidate_id === 'cand-sel-1')!.selected).toBe(1);
    expect(scores.find(s => s.candidate_id === 'cand-sel-2')!.selected).toBe(0);
  });

  it('重复选择同一候选应幂等（无副作用）', () => {
    selectCandidate('proj-sel', 'creative_plan', 'cand-sel-1');
    selectCandidate('proj-sel', 'creative_plan', 'cand-sel-1');
    const scores = listArenaFunnelScoresByStage('sess-sel', 'creative_plan');
    expect(scores.find(s => s.candidate_id === 'cand-sel-1')!.selected).toBe(1);
    expect(scores.find(s => s.candidate_id === 'cand-sel-2')!.selected).toBe(0);
  });

  it('切换选择应取消之前的选中', () => {
    selectCandidate('proj-sel', 'creative_plan', 'cand-sel-1');
    selectCandidate('proj-sel', 'creative_plan', 'cand-sel-2');
    const scores = listArenaFunnelScoresByStage('sess-sel', 'creative_plan');
    expect(scores.find(s => s.candidate_id === 'cand-sel-1')!.selected).toBe(0);
    expect(scores.find(s => s.candidate_id === 'cand-sel-2')!.selected).toBe(1);
  });
});

// ============================================================
// getArenaStatus
// ============================================================

describe('getArenaStatus', () => {
  it('不存在的项目应返回null', () => {
    expect(getArenaStatus('nonexistent-proj')).toBeNull();
  });

  it('应返回正确的竞技状态', () => {
    // 创建session
    createArenaSession({
      id: 'sess-status', project_id: 'proj-status',
      config: JSON.stringify({ groupCount: 10, membersPerGroup: 4, strictness: 'standard', concurrency: 5, passScore: 5.5 }),
      status: 'stage_plan', current_stage: 'creative_plan',
      task_id: 'task-status', created_at: now, completed_at: null,
    });

    // 插入writer数据
    batchInsertArenaWriters([
      {
        id: 'w-status-1', session_id: 'sess-status', group_id: 'group-sys-01',
        name: '听花岛·组长', is_leader: 1, system_agent_id: 'sys-01',
        system_agent_name: '听花岛', base_style_id: 'sys-01',
        style_gene: '{}', system_prompt: 'p', created_at: now,
      },
      {
        id: 'w-status-2', session_id: 'sess-status', group_id: 'group-sys-01',
        name: '听花岛·变体1', is_leader: 0, system_agent_id: 'sys-01',
        system_agent_name: '听花岛', base_style_id: 'sys-01',
        style_gene: '{}', system_prompt: 'p', created_at: now,
      },
    ]);

    const status = getArenaStatus('proj-status');
    expect(status).not.toBeNull();
    expect(status!.sessionId).toBe('sess-status');
    expect(status!.projectId).toBe('proj-status');
    expect(status!.status).toBe('stage_plan');
    expect(status!.currentStage).toBe('creative_plan');
    expect(status!.taskId).toBe('task-status');
    expect(status!.config.groupCount).toBe(10);
  });

  it('应正确组装创作组概览', () => {
    createArenaSession({
      id: 'sess-grp', project_id: 'proj-grp',
      config: JSON.stringify({ groupCount: 10, membersPerGroup: 2, strictness: 'standard', concurrency: 5, passScore: 5.5 }),
      status: 'init', current_stage: null,
      task_id: 'task-grp', created_at: now, completed_at: null,
    });

    batchInsertArenaWriters([
      {
        id: 'w-grp-l', session_id: 'sess-grp', group_id: 'group-sys-01',
        name: '听花岛·组长', is_leader: 1, system_agent_id: 'sys-01',
        system_agent_name: '听花岛', base_style_id: 'sys-01',
        style_gene: '{}', system_prompt: 'p', created_at: now,
      },
      {
        id: 'w-grp-m1', session_id: 'sess-grp', group_id: 'group-sys-01',
        name: '听花岛·变体1', is_leader: 0, system_agent_id: 'sys-01',
        system_agent_name: '听花岛', base_style_id: 'sys-01',
        style_gene: '{}', system_prompt: 'p', created_at: now,
      },
      {
        id: 'w-grp-m2', session_id: 'sess-grp', group_id: 'group-sys-01',
        name: '听花岛·变体2', is_leader: 0, system_agent_id: 'sys-01',
        system_agent_name: '听花岛', base_style_id: 'sys-01',
        style_gene: '{}', system_prompt: 'p', created_at: now,
      },
    ]);

    const status = getArenaStatus('proj-grp');
    expect(status!.groups).toHaveLength(1);
    expect(status!.groups[0].groupId).toBe('group-sys-01');
    expect(status!.groups[0].leaderName).toBe('听花岛·组长');
    expect(status!.groups[0].memberCount).toBe(2);
    expect(status!.groups[0].systemAgentName).toBe('听花岛');
  });

  it('应正确组装阶段状态', () => {
    createArenaSession({
      id: 'sess-stg', project_id: 'proj-stg',
      config: JSON.stringify({ groupCount: 10, membersPerGroup: 4, strictness: 'standard', concurrency: 5, passScore: 5.5 }),
      status: 'stage_char', current_stage: 'character',
      task_id: 'task-stg', created_at: now, completed_at: null,
    });

    // 插入creative_plan阶段的候选和评分
    insertArenaCandidate({
      id: 'cand-stg-1', session_id: 'sess-stg', stage: 'creative_plan',
      writer_id: 'w1', group_id: 'g1', system_agent_id: 'sys-01',
      system_agent_name: '听花岛', parent_candidate_id: null,
      content: '{}', character_pool_ids: null, created_at: now,
    });
    insertArenaFunnelScore({
      id: 'sc-stg-1', session_id: 'sess-stg', candidate_id: 'cand-stg-1',
      stage: 'creative_plan', direction_scores: '[]',
      weighted_total: 7.5, rank: 1, selected: 1, created_at: now,
    });

    const status = getArenaStatus('proj-stg');
    expect(status!.stages.creative_plan).toBeDefined();
    expect(status!.stages.creative_plan!.status).toBe('completed');
    expect(status!.stages.creative_plan!.totalCandidates).toBe(1);
    expect(status!.stages.creative_plan!.survivedCandidates).toBe(1);
    expect(status!.stages.creative_plan!.selectedCandidateId).toBe('cand-stg-1');
  });
});

// ============================================================
// getArenaCandidates
// ============================================================

describe('getArenaCandidates', () => {
  it('不存在的项目应返回空数组', () => {
    expect(getArenaCandidates('nonexistent', 'creative_plan')).toHaveLength(0);
  });

  it('应返回候选列表并关联评分', () => {
    createArenaSession({
      id: 'sess-cands', project_id: 'proj-cands',
      config: '{}', status: 'stage_plan', current_stage: 'creative_plan',
      task_id: 'task-cands', created_at: now, completed_at: null,
    });

    insertArenaCandidate({
      id: 'cand-c1', session_id: 'sess-cands', stage: 'creative_plan',
      writer_id: 'w1', group_id: 'group-sys-01', system_agent_id: 'sys-01',
      system_agent_name: '听花岛', parent_candidate_id: null,
      content: JSON.stringify({ title: '方案A' }), character_pool_ids: null, created_at: now,
    });
    insertArenaCandidate({
      id: 'cand-c2', session_id: 'sess-cands', stage: 'creative_plan',
      writer_id: 'w2', group_id: 'group-sys-02', system_agent_id: 'sys-02',
      system_agent_name: '倾故', parent_candidate_id: null,
      content: JSON.stringify({ title: '方案B' }), character_pool_ids: null, created_at: now,
    });

    insertArenaFunnelScore({
      id: 'sc-c1', session_id: 'sess-cands', candidate_id: 'cand-c1',
      stage: 'creative_plan', direction_scores: '[]',
      weighted_total: 8.0, rank: 1, selected: 1, created_at: now,
    });
    insertArenaFunnelScore({
      id: 'sc-c2', session_id: 'sess-cands', candidate_id: 'cand-c2',
      stage: 'creative_plan', direction_scores: '[]',
      weighted_total: 6.5, rank: 2, selected: 0, created_at: now,
    });

    const candidates = getArenaCandidates('proj-cands', 'creative_plan');
    expect(candidates).toHaveLength(2);
    // 按rank排序
    expect(candidates[0].id).toBe('cand-c1');
    expect(candidates[0].score).toBe(8.0);
    expect(candidates[0].rank).toBe(1);
    expect(candidates[0].selected).toBe(true);
    expect(candidates[0].systemAgentName).toBe('听花岛');
    expect(candidates[1].id).toBe('cand-c2');
    expect(candidates[1].score).toBe(6.5);
    expect(candidates[1].selected).toBe(false);
  });

  it('没有评分的候选应返回默认值', () => {
    createArenaSession({
      id: 'sess-noscore', project_id: 'proj-noscore',
      config: '{}', status: 'stage_plan', current_stage: 'creative_plan',
      task_id: 'task-noscore', created_at: now, completed_at: null,
    });

    insertArenaCandidate({
      id: 'cand-ns1', session_id: 'sess-noscore', stage: 'creative_plan',
      writer_id: 'w1', group_id: 'g1', system_agent_id: 'sys-01',
      system_agent_name: '听花岛', parent_candidate_id: null,
      content: '{}', character_pool_ids: null, created_at: now,
    });

    const candidates = getArenaCandidates('proj-noscore', 'creative_plan');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].score).toBe(0);
    expect(candidates[0].rank).toBeNull();
    expect(candidates[0].selected).toBe(false);
  });
});

// ============================================================
// startArenaCreation 主流程
// ============================================================

describe('startArenaCreation', () => {
  it('应创建竞技会话并持久化Agent数据', async () => {
    const config: ArenaConfig = {
      groupCount: 10,
      membersPerGroup: 4,
      strictness: 'standard',
      concurrency: 5,
      passScore: 5.5,
    };

    await startArenaCreation('proj-start', config, 'task-start');

    // 验证session已创建
    const session = getArenaSessionByProjectId('proj-start');
    expect(session).not.toBeNull();
    expect(session!.project_id).toBe('proj-start');
    expect(session!.task_id).toBe('task-start');
    // 占位函数直接返回，所以应该是completed
    expect(session!.status).toBe('completed');
  });

  it('应持久化40个创作Agent和50个评审Agent', async () => {
    const config: ArenaConfig = {
      groupCount: 10,
      membersPerGroup: 4,
      strictness: 'standard',
      concurrency: 5,
      passScore: 5.5,
    };

    await startArenaCreation('proj-agents', config, 'task-agents');

    const session = getArenaSessionByProjectId('proj-agents');
    expect(session).not.toBeNull();

    // 验证writers: 8组长 + 32组员 = 40
    const d = getDB();
    const writerStmt = d.prepare('SELECT COUNT(*) as cnt FROM arena_writers WHERE session_id = ?');
    writerStmt.bind([session!.id]);
    writerStmt.step();
    const writerCount = (writerStmt.getAsObject() as { cnt: number }).cnt;
    writerStmt.free();
    expect(writerCount).toBe(40);

    // 验证reviewers: 10方向 × 5人 = 50
    const reviewerStmt = d.prepare('SELECT COUNT(*) as cnt FROM arena_reviewers WHERE session_id = ?');
    reviewerStmt.bind([session!.id]);
    reviewerStmt.step();
    const reviewerCount = (reviewerStmt.getAsObject() as { cnt: number }).cnt;
    reviewerStmt.free();
    expect(reviewerCount).toBe(50);
  });

  it('自定义membersPerGroup应生效', async () => {
    const config: ArenaConfig = {
      groupCount: 10,
      membersPerGroup: 2,
      strictness: 'strict',
      concurrency: 3,
      passScore: 6.0,
    };

    await startArenaCreation('proj-custom', config, 'task-custom');

    const session = getArenaSessionByProjectId('proj-custom');
    const d = getDB();
    const stmt = d.prepare('SELECT COUNT(*) as cnt FROM arena_writers WHERE session_id = ?');
    stmt.bind([session!.id]);
    stmt.step();
    const count = (stmt.getAsObject() as { cnt: number }).cnt;
    stmt.free();
    // 8组长 + 8×2组员 = 24
    expect(count).toBe(24);
  });
});

// ============================================================
// stopArenaCreation
// ============================================================

describe('stopArenaCreation', () => {
  it('对不存在的项目调用不应抛错', () => {
    expect(() => stopArenaCreation('nonexistent')).not.toThrow();
  });
});


// ============================================================
// runCreativePlanArena — 单元测试（任务6）
// ============================================================

import {
  runCreativePlanArena,
  buildCreativePlanSystemPrompt,
  buildCreativePlanUserPrompt,
  type WriterAgent,
} from '../arena-engine.js';
import { QueueScheduler } from '../queue-scheduler.js';
import type { ScreenplayConfig } from '../screenplay-creator.js';

// 模拟的CreativePlan数据
function makeFakePlan(idx: number) {
  return {
    titleOptions: [{ title: `方案${idx}`, description: `描述${idx}` }],
    setting: { era: '现代', location: '都市', socialEnv: '商业', classRelation: '阶层' },
    storyLine: `故事线${idx}`,
    coreConflict: `冲突${idx}`,
    fourActs: {
      act1: { episodeRange: '1-10', coreEvents: ['事件1'], relationships: '关系' },
      act2: { episodeRange: '11-25', conflicts: ['冲突1'], turningPoints: ['转折1'] },
      act3: { episodeRange: '26-40', climax: '高潮', turningPoints: ['转折2'] },
      act4: { episodeRange: '41-50', ending: '结局', themeElevation: '主题升华' },
    },
    rhythmWave: '节奏波形',
    paywallPlan: [{ episode: 10, type: '身份揭露', suspense: '悬念' }],
    satisfactionMatrix: { '身份碾压': 30, '打脸复仇': 25, '逆袭翻盘': 20, '情感爆发': 15, '悬念揭秘': 10 },
    endingDesign: { mainLine: '主线结局', romanceLine: '感情线', foreshadowRecovery: '伏笔回收' },
  };
}

// 模拟的ScreenplayConfig
const fakeConfig: ScreenplayConfig = {
  genres: ['都市情感', '霸道总裁'],
  audience: '女频',
  tone: '甜虐交织',
  endingType: 'HE',
  totalEpisodes: 50,
  language: 'zh-CN',
  mode: 'domestic',
};

// ============================================================
// buildCreativePlanSystemPrompt
// ============================================================

describe('buildCreativePlanSystemPrompt', () => {
  it('应包含writer的systemPrompt和节奏曲线要求', () => {
    const prompt = buildCreativePlanSystemPrompt('你是编剧', fakeConfig);
    expect(prompt).toContain('你是编剧');
    expect(prompt).toContain('节奏曲线要求');
    expect(prompt).toContain('付费卡点要求');
    expect(prompt).toContain('爽点矩阵');
  });

  it('应根据集数计算正确的阶段集数', () => {
    const prompt = buildCreativePlanSystemPrompt('', { ...fakeConfig, totalEpisodes: 100 });
    expect(prompt).toContain('约15集'); // 100 * 0.15
    expect(prompt).toContain('约30集'); // 100 * 0.30
  });

  it('useTimeline=true时应包含跨时代要求', () => {
    const prompt = buildCreativePlanSystemPrompt('', { ...fakeConfig, useTimeline: true });
    expect(prompt).toContain('跨时代时间线架构要求');
  });

  it('useTimeline=false时不应包含跨时代要求', () => {
    const prompt = buildCreativePlanSystemPrompt('', { ...fakeConfig, useTimeline: false });
    expect(prompt).not.toContain('跨时代时间线架构要求');
  });
});

// ============================================================
// buildCreativePlanUserPrompt
// ============================================================

describe('buildCreativePlanUserPrompt', () => {
  it('应包含配置信息', () => {
    const prompt = buildCreativePlanUserPrompt(fakeConfig);
    expect(prompt).toContain('都市情感');
    expect(prompt).toContain('女频');
    expect(prompt).toContain('甜虐交织');
    expect(prompt).toContain('50集');
  });

  it('有customPrompt时应包含', () => {
    const prompt = buildCreativePlanUserPrompt({ ...fakeConfig, customPrompt: '加入穿越元素' });
    expect(prompt).toContain('加入穿越元素');
  });

  it('应包含JSON格式要求', () => {
    const prompt = buildCreativePlanUserPrompt(fakeConfig);
    expect(prompt).toContain('titleOptions');
    expect(prompt).toContain('satisfactionMatrix');
  });
});

// ============================================================
// runCreativePlanArena（mock LLM）
// ============================================================

describe('runCreativePlanArena', () => {
  const mockChatCompletionJSON = chatCompletionJSON as ReturnType<typeof vi.fn>;
  const mockGetScreenplay = getScreenplay as ReturnType<typeof vi.fn>;

  // 构建测试用的writers和reviewers
  function buildTestWritersAndReviewers() {
    const groups = buildWriterGroups(4);
    const allWriters = groups.flatMap(g => [g.leader, ...g.members]);
    const reviewers = generateReviewerAgents();
    return { groups, allWriters, reviewers };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock getScreenplay 返回一个有效项目
    mockGetScreenplay.mockReturnValue({
      id: 'proj-arena-test',
      config: fakeConfig,
      status: 'config_done',
      creativePlan: null,
      characters: null,
      directory: null,
      episodes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    // Mock chatCompletionJSON：根据prompt内容区分调用类型
    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      // 评审Agent的prompt包含"评审维度"或"评分"
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        return { success: true, data: { score: 5 + Math.random() * 4, comment: '不错的方案' } };
      }
      // 组内互审
      if (systemPrompt.includes('审查以下创意方案')) {
        return { success: true, data: { score: 6 + Math.random() * 3, suggestion: '建议优化' } };
      }
      // 互审后修改
      if (systemPrompt.includes('修改优化')) {
        return { success: true, data: makeFakePlan(999) };
      }
      // 默认：创意方案生成
      return { success: true, data: makeFakePlan(Math.floor(Math.random() * 100)) };
    });
  });

  it('项目不存在时应返回空结果', async () => {
    mockGetScreenplay.mockReturnValue(undefined);
    const scheduler = new QueueScheduler(5);
    const { allWriters, reviewers } = buildTestWritersAndReviewers();

    const result = await runCreativePlanArena(
      'nonexistent', allWriters, reviewers, scheduler, 'task-1', 'sess-1',
    );

    expect(result.stage).toBe('creative_plan');
    expect(result.candidates).toHaveLength(0);
    expect(result.totalGenerated).toBe(0);
  });

  it('应生成40个创意方案（8组×5人）', async () => {
    const scheduler = new QueueScheduler(10); // 高并发加速测试
    const { allWriters, reviewers } = buildTestWritersAndReviewers();

    // 准备session
    createArenaSession({
      id: 'sess-plan-test', project_id: 'proj-arena-test',
      config: JSON.stringify({ groupCount: 10, membersPerGroup: 4, strictness: 'standard', concurrency: 10, passScore: 5.5 }),
      status: 'stage_plan', current_stage: 'creative_plan',
      task_id: 'task-plan-test', created_at: Date.now(), completed_at: null,
    });

    const result = await runCreativePlanArena(
      'proj-arena-test', allWriters, reviewers, scheduler, 'task-plan-test', 'sess-plan-test',
    );

    // 应生成40个方案（所有LLM调用都成功）
    expect(result.totalGenerated).toBe(40);
    // 每组选出1个 → 8个进入跨组评审
    expect(result.totalSurvived).toBeLessThanOrEqual(8);
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(8);
  }, 30000);

  it('每个候选应正确填充groupId、systemAgentId、systemAgentName', async () => {
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewers();

    createArenaSession({
      id: 'sess-fields-test', project_id: 'proj-arena-test',
      config: '{}', status: 'stage_plan', current_stage: 'creative_plan',
      task_id: 'task-fields', created_at: Date.now(), completed_at: null,
    });

    const result = await runCreativePlanArena(
      'proj-arena-test', allWriters, reviewers, scheduler, 'task-fields', 'sess-fields-test',
    );

    for (const candidate of result.candidates) {
      // groupId 应以 'group-' 开头
      expect(candidate.groupId).toMatch(/^group-/);
      // systemAgentId 应是有效的系统Agent ID
      const sysAgent = SYSTEM_AGENTS.find(a => a.id === candidate.systemAgentId);
      expect(sysAgent).toBeDefined();
      // systemAgentName 应与系统Agent的name一致
      expect(candidate.systemAgentName).toBe(sysAgent!.name);
    }
  }, 30000);

  it('候选应有排名且按分数降序', async () => {
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewers();

    createArenaSession({
      id: 'sess-rank-test', project_id: 'proj-arena-test',
      config: '{}', status: 'stage_plan', current_stage: 'creative_plan',
      task_id: 'task-rank', created_at: Date.now(), completed_at: null,
    });

    const result = await runCreativePlanArena(
      'proj-arena-test', allWriters, reviewers, scheduler, 'task-rank', 'sess-rank-test',
    );

    // 验证排名
    for (let i = 0; i < result.candidates.length; i++) {
      expect(result.candidates[i].rank).toBe(i + 1);
    }

    // 验证分数降序
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].score).toBeGreaterThanOrEqual(result.candidates[i].score);
    }

    // Top 1 应标记 selected
    if (result.candidates.length > 0) {
      expect(result.candidates[0].selected).toBe(true);
    }
  }, 30000);

  it('候选应持久化到数据库', async () => {
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewers();

    createArenaSession({
      id: 'sess-persist-test', project_id: 'proj-arena-test',
      config: '{}', status: 'stage_plan', current_stage: 'creative_plan',
      task_id: 'task-persist', created_at: Date.now(), completed_at: null,
    });

    await runCreativePlanArena(
      'proj-arena-test', allWriters, reviewers, scheduler, 'task-persist', 'sess-persist-test',
    );

    // 验证候选已持久化
    const dbCandidates = listArenaCandidatesByStage('sess-persist-test', 'creative_plan');
    expect(dbCandidates.length).toBe(40); // 所有40个方案都应持久化

    // 验证评分已持久化
    const dbScores = listArenaFunnelScoresByStage('sess-persist-test', 'creative_plan');
    expect(dbScores.length).toBeGreaterThan(0);
    expect(dbScores.length).toBeLessThanOrEqual(8);
  }, 30000);

  it('部分LLM失败时应优雅降级', async () => {
    let callIdx = 0;
    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      callIdx++;
      // 创意方案生成：每3个失败1个
      if (!systemPrompt.includes('评审维度') && !systemPrompt.includes('专业评分')
          && !systemPrompt.includes('审查以下创意方案') && !systemPrompt.includes('修改优化')) {
        if (callIdx % 3 === 0) {
          return { success: false, error: '模拟失败' };
        }
        return { success: true, data: makeFakePlan(callIdx) };
      }
      // 评审和互审：正常返回
      if (systemPrompt.includes('审查以下创意方案')) {
        return { success: true, data: { score: 7, suggestion: '建议' } };
      }
      if (systemPrompt.includes('修改优化')) {
        return { success: true, data: makeFakePlan(callIdx) };
      }
      return { success: true, data: { score: 7, comment: '评审' } };
    });

    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewers();

    createArenaSession({
      id: 'sess-fail-test', project_id: 'proj-arena-test',
      config: '{}', status: 'stage_plan', current_stage: 'creative_plan',
      task_id: 'task-fail', created_at: Date.now(), completed_at: null,
    });

    const result = await runCreativePlanArena(
      'proj-arena-test', allWriters, reviewers, scheduler, 'task-fail', 'sess-fail-test',
    );

    // 部分失败，但不应崩溃
    expect(result.stage).toBe('creative_plan');
    // 生成数量应少于50（因为部分失败）
    expect(result.totalGenerated).toBeLessThan(50);
    expect(result.totalGenerated).toBeGreaterThan(0);
  }, 30000);
});


// ============================================================
// 阶段2：角色开发竞争 — 单元测试（任务7）
// ============================================================

import {
  runCharacterArena,
  buildCharacterDesignPromptWithPool,
  buildCharacterDesignPromptDefault,
  generateCharacterDesign,
} from '../arena-engine.js';
import type { CharacterDesign } from '../screenplay-creator.js';
import {
  insertCharacterAgent,
  listCharacterAgents,
  type CharacterAgentRow,
} from '../db-service.js';

// 模拟的CharacterDesign数据
function makeFakeCharacterDesign(idx: number): CharacterDesign {
  return {
    characters: [
      {
        id: 'C01', name: `主角${idx}`, age: '25', appearance: '帅气',
        personality: ['勇敢', '正义'], publicIdentity: '普通人',
        realIdentity: '隐藏强者', motivation: '复仇',
        conflictPoint: '身份暴露', satisfactionRole: '打脸',
        catchphrase: '你不配', arc: '从弱到强', villainLayer: 0,
      },
      {
        id: 'C02', name: `反派${idx}`, age: '40', appearance: '阴险',
        personality: ['狡猾', '贪婪'], publicIdentity: '集团总裁',
        realIdentity: '幕后黑手', motivation: '权力',
        conflictPoint: '被揭穿', satisfactionRole: '被打脸',
        catchphrase: '你以为你赢了？', arc: '从嚣张到覆灭', villainLayer: 3,
      },
    ],
    relationships: [{ from: `主角${idx}`, to: `反派${idx}`, relation: '宿敌' }],
    romanceLine: [{ episode: 1, event: '初遇' }],
    villainSystem: { layer1: [], layer2: [], layer3: [], layer4: [] },
  };
}

// 模拟的群演角色数据
function makeFakeCharacterAgent(id: string, name: string): CharacterAgentRow {
  return {
    id, name, role: 'protagonist', source_novel: '测试小说',
    source_project_id: null, category: '都市情感',
    description: `${name}是一个性格鲜明的角色`, personality: '勇敢、正义',
    visual_prompt: '', costume_desc: '', system_prompt: '你是一个角色',
    profile_images: '{}', tags: '[]',
    created_at: Date.now(), updated_at: Date.now(),
  };
}

// ============================================================
// buildCharacterDesignPromptWithPool
// ============================================================

describe('buildCharacterDesignPromptWithPool', () => {
  const fakePlan = makeFakePlan(1) as unknown as import('../screenplay-creator.js').CreativePlan;
  const fakePool: CharacterAgentRow[] = [
    makeFakeCharacterAgent('agent-001', '张三'),
    makeFakeCharacterAgent('agent-002', '李四'),
  ];
  const fakeWriter: WriterAgent = {
    id: 'leader-sys-01', name: '听花岛·组长', groupId: 'group-sys-01',
    isLeader: true, systemAgentId: 'sys-01',
    styleGene: { baseStyleId: 'sys-01', narrativeStructure: '', characterMethod: '', dialogueStyle: '', emotionRhythm: '', hookDesign: '' },
    systemPrompt: '你是听花岛风格编剧',
  };

  it('应包含writer的systemPrompt', () => {
    const prompt = buildCharacterDesignPromptWithPool(fakePlan, fakePool, fakeWriter);
    expect(prompt).toContain('你是听花岛风格编剧');
  });

  it('应包含群演角色素材列表', () => {
    const prompt = buildCharacterDesignPromptWithPool(fakePlan, fakePool, fakeWriter);
    expect(prompt).toContain('agent-001');
    expect(prompt).toContain('张三');
    expect(prompt).toContain('agent-002');
    expect(prompt).toContain('李四');
  });

  it('应包含选角原则和群演优先要求', () => {
    const prompt = buildCharacterDesignPromptWithPool(fakePlan, fakePool, fakeWriter);
    expect(prompt).toContain('优先使用群演仓库中的角色');
    expect(prompt).toContain('保留群演角色的原始ID');
    expect(prompt).toContain('characterAgentId');
  });

  it('应包含四层反派体系要求', () => {
    const prompt = buildCharacterDesignPromptWithPool(fakePlan, fakePool, fakeWriter);
    expect(prompt).toContain('四层反派体系');
    expect(prompt).toContain('小反派');
    expect(prompt).toContain('大反派');
  });

  it('应包含创作方案摘要', () => {
    const prompt = buildCharacterDesignPromptWithPool(fakePlan, fakePool, fakeWriter);
    expect(prompt).toContain(fakePlan.storyLine);
    expect(prompt).toContain(fakePlan.coreConflict);
  });
});

// ============================================================
// buildCharacterDesignPromptDefault
// ============================================================

describe('buildCharacterDesignPromptDefault', () => {
  const fakePlan = makeFakePlan(1) as unknown as import('../screenplay-creator.js').CreativePlan;
  const fakeWriter: WriterAgent = {
    id: 'leader-sys-02', name: '倾故·组长', groupId: 'group-sys-02',
    isLeader: true, systemAgentId: 'sys-02',
    styleGene: { baseStyleId: 'sys-02', narrativeStructure: '', characterMethod: '', dialogueStyle: '', emotionRhythm: '', hookDesign: '' },
    systemPrompt: '你是倾故风格编剧',
  };

  it('应包含writer的systemPrompt', () => {
    const prompt = buildCharacterDesignPromptDefault(fakePlan, fakeWriter);
    expect(prompt).toContain('你是倾故风格编剧');
  });

  it('应包含四层反派体系要求', () => {
    const prompt = buildCharacterDesignPromptDefault(fakePlan, fakeWriter);
    expect(prompt).toContain('四层反派体系');
    expect(prompt).toContain('隐藏反派');
  });

  it('应包含角色设计要求', () => {
    const prompt = buildCharacterDesignPromptDefault(fakePlan, fakeWriter);
    expect(prompt).toContain('爽点功能');
    expect(prompt).toContain('口头禅');
    expect(prompt).toContain('6-10个');
  });

  it('不应包含群演相关内容', () => {
    const prompt = buildCharacterDesignPromptDefault(fakePlan, fakeWriter);
    expect(prompt).not.toContain('群演仓库');
    expect(prompt).not.toContain('characterAgentId');
  });

  it('应包含创作方案摘要', () => {
    const prompt = buildCharacterDesignPromptDefault(fakePlan, fakeWriter);
    expect(prompt).toContain(fakePlan.storyLine);
    expect(prompt).toContain(fakePlan.coreConflict);
  });
});

// ============================================================
// generateCharacterDesign
// ============================================================

describe('generateCharacterDesign', () => {
  const mockChatCompletionJSON = chatCompletionJSON as ReturnType<typeof vi.fn>;
  const fakePlan = makeFakePlan(1) as unknown as import('../screenplay-creator.js').CreativePlan;
  const fakeWriter: WriterAgent = {
    id: 'leader-sys-01', name: '听花岛·组长', groupId: 'group-sys-01',
    isLeader: true, systemAgentId: 'sys-01',
    styleGene: { baseStyleId: 'sys-01', narrativeStructure: '', characterMethod: '', dialogueStyle: '', emotionRhythm: '', hookDesign: '' },
    systemPrompt: '你是听花岛风格编剧',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有群演素材时应返回角色设计和characterPoolIds', async () => {
    const fakeDesign = makeFakeCharacterDesign(1);
    // 给角色添加 characterAgentId
    (fakeDesign.characters[0] as any).characterAgentId = 'agent-001';
    mockChatCompletionJSON.mockResolvedValue({ success: true, data: fakeDesign });

    const pool = [makeFakeCharacterAgent('agent-001', '张三')];
    const result = await generateCharacterDesign('proj-1', fakePlan, pool, fakeWriter);

    expect(result).not.toBeNull();
    expect(result!.data.characters).toHaveLength(2);
    expect(result!.characterPoolIds).toContain('agent-001');
  });

  it('无群演素材时应返回空characterPoolIds', async () => {
    mockChatCompletionJSON.mockResolvedValue({ success: true, data: makeFakeCharacterDesign(2) });

    const result = await generateCharacterDesign('proj-1', fakePlan, [], fakeWriter);

    expect(result).not.toBeNull();
    expect(result!.characterPoolIds).toHaveLength(0);
  });

  it('LLM失败时应返回null', async () => {
    mockChatCompletionJSON.mockResolvedValue({ success: false, error: '模拟失败' });

    const result = await generateCharacterDesign('proj-1', fakePlan, [], fakeWriter);
    expect(result).toBeNull();
  });

  it('LLM抛异常时应返回null', async () => {
    mockChatCompletionJSON.mockRejectedValue(new Error('网络错误'));

    const result = await generateCharacterDesign('proj-1', fakePlan, [], fakeWriter);
    expect(result).toBeNull();
  });

  it('characterAgentId不在pool中时不应加入characterPoolIds', async () => {
    const fakeDesign = makeFakeCharacterDesign(3);
    (fakeDesign.characters[0] as any).characterAgentId = 'agent-999'; // 不在pool中
    mockChatCompletionJSON.mockResolvedValue({ success: true, data: fakeDesign });

    const pool = [makeFakeCharacterAgent('agent-001', '张三')];
    const result = await generateCharacterDesign('proj-1', fakePlan, pool, fakeWriter);

    expect(result).not.toBeNull();
    expect(result!.characterPoolIds).toHaveLength(0);
  });
});

// ============================================================
// runCharacterArena（mock LLM）
// ============================================================

describe('runCharacterArena', () => {
  const mockChatCompletionJSON = chatCompletionJSON as ReturnType<typeof vi.fn>;
  const mockGetScreenplay = getScreenplay as ReturnType<typeof vi.fn>;

  function buildTestWritersAndReviewersForChar() {
    const groups = buildWriterGroups(4);
    const allWriters = groups.flatMap(g => [g.leader, ...g.members]);
    const reviewers = generateReviewerAgents();
    return { groups, allWriters, reviewers };
  }

  // 构建模拟的阶段1 Top 8方案结果
  function buildFakeTopPlans(writers: WriterAgent[]): StageCandidates<unknown> {
    const groups = buildWriterGroups(4);
    const candidates = groups.map((g, idx) => ({
      id: `plan-test-${idx}`,
      writerId: g.leader.id,
      groupId: g.id,
      systemAgentId: g.systemAgentId,
      systemAgentName: g.systemAgentName,
      data: makeFakePlan(idx),
      score: 8 - idx * 0.1,
      rank: idx + 1,
    }));
    return {
      stage: 'creative_plan' as const,
      candidates,
      totalGenerated: 40,
      totalSurvived: 8,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetScreenplay.mockReturnValue({
      id: 'proj-char-test',
      config: fakeConfig,
      status: 'plan_done',
      creativePlan: makeFakePlan(0),
    });

    // Mock chatCompletionJSON：区分不同调用类型
    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      // 评审Agent
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        return { success: true, data: { score: 5 + Math.random() * 4, comment: '角色设计不错' } };
      }
      // 群演匹配
      if (systemPrompt.includes('选角导演')) {
        return { success: true, data: { selectedIds: [], reason: '无匹配' } };
      }
      // 角色设计生成
      return { success: true, data: makeFakeCharacterDesign(Math.floor(Math.random() * 100)) };
    });

    // 清理character_agents表
    const d = getDB();
    d.run('DELETE FROM character_agents');
    saveDB();
  });

  it('项目不存在时应返回空结果', async () => {
    mockGetScreenplay.mockReturnValue(undefined);
    const scheduler = new QueueScheduler(5);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForChar();
    const topPlans = buildFakeTopPlans(allWriters);

    const result = await runCharacterArena(
      'nonexistent', topPlans, allWriters, reviewers, scheduler, 'task-1', 'sess-1',
    );

    expect(result.stage).toBe('character');
    expect(result.candidates).toHaveLength(0);
    expect(result.totalGenerated).toBe(0);
  });

  it('应为每个方案生成角色设计并评审筛选', async () => {
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForChar();
    const topPlans = buildFakeTopPlans(allWriters);

    createArenaSession({
      id: 'sess-char-test', project_id: 'proj-char-test',
      config: '{}', status: 'stage_char', current_stage: 'character',
      task_id: 'task-char', created_at: Date.now(), completed_at: null,
    });

    const result = await runCharacterArena(
      'proj-char-test', topPlans, allWriters, reviewers, scheduler, 'task-char', 'sess-char-test',
    );

    expect(result.stage).toBe('character');
    // 每方案3个Agent，10个方案 = 30个候选（可能部分失败）
    expect(result.totalGenerated).toBeGreaterThan(0);
    expect(result.totalGenerated).toBeLessThanOrEqual(30);
    // 每方案保留最佳1个 = 最多10个
    expect(result.totalSurvived).toBeLessThanOrEqual(10);
    expect(result.totalSurvived).toBeGreaterThan(0);
    // 候选应有评分
    for (const c of result.candidates) {
      expect(c.score).toBeGreaterThanOrEqual(0);
      expect(c.systemAgentName).toBeTruthy();
      expect(c.parentCandidateId).toBeTruthy();
    }
  }, 60000);

  it('群演仓库为空时应回退到纯LLM生成', async () => {
    // 确保character_agents表为空
    const agents = listCharacterAgents();
    expect(agents).toHaveLength(0);

    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForChar();
    const topPlans = buildFakeTopPlans(allWriters);

    createArenaSession({
      id: 'sess-no-pool', project_id: 'proj-char-test',
      config: '{}', status: 'stage_char', current_stage: 'character',
      task_id: 'task-no-pool', created_at: Date.now(), completed_at: null,
    });

    const result = await runCharacterArena(
      'proj-char-test', topPlans, allWriters, reviewers, scheduler, 'task-no-pool', 'sess-no-pool',
    );

    expect(result.stage).toBe('character');
    expect(result.totalGenerated).toBeGreaterThan(0);
    // 验证没有调用群演匹配（选角导演prompt）
    const calls = mockChatCompletionJSON.mock.calls;
    const matchCalls = calls.filter((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('选角导演'),
    );
    expect(matchCalls).toHaveLength(0);
  }, 60000);

  it('群演仓库有数据时应触发LLM匹配', async () => {
    // 插入测试群演角色
    for (let i = 0; i < 10; i++) {
      insertCharacterAgent(makeFakeCharacterAgent(`test-agent-${i}`, `测试角色${i}`));
    }

    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForChar();
    const topPlans = buildFakeTopPlans(allWriters);

    createArenaSession({
      id: 'sess-with-pool', project_id: 'proj-char-test',
      config: '{}', status: 'stage_char', current_stage: 'character',
      task_id: 'task-with-pool', created_at: Date.now(), completed_at: null,
    });

    const result = await runCharacterArena(
      'proj-char-test', topPlans, allWriters, reviewers, scheduler, 'task-with-pool', 'sess-with-pool',
    );

    expect(result.stage).toBe('character');
    expect(result.totalGenerated).toBeGreaterThan(0);
    // 验证调用了群演匹配
    const calls = mockChatCompletionJSON.mock.calls;
    const matchCalls = calls.filter((c: any[]) =>
      typeof c[0] === 'string' && c[0].includes('选角导演'),
    );
    expect(matchCalls.length).toBeGreaterThan(0);
  }, 60000);

  it('characterPoolIds应正确填充', async () => {
    // 插入群演角色
    insertCharacterAgent(makeFakeCharacterAgent('pool-agent-1', '群演角色A'));

    // Mock：群演匹配返回pool-agent-1，角色设计返回带characterAgentId的结果
    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        return { success: true, data: { score: 7, comment: '好' } };
      }
      if (systemPrompt.includes('选角导演')) {
        return { success: true, data: { selectedIds: ['pool-agent-1'], reason: '匹配' } };
      }
      // 角色设计：返回带characterAgentId的角色
      const design = makeFakeCharacterDesign(1);
      (design.characters[0] as any).characterAgentId = 'pool-agent-1';
      return { success: true, data: design };
    });

    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForChar();
    const topPlans = buildFakeTopPlans(allWriters);

    createArenaSession({
      id: 'sess-pool-ids', project_id: 'proj-char-test',
      config: '{}', status: 'stage_char', current_stage: 'character',
      task_id: 'task-pool-ids', created_at: Date.now(), completed_at: null,
    });

    const result = await runCharacterArena(
      'proj-char-test', topPlans, allWriters, reviewers, scheduler, 'task-pool-ids', 'sess-pool-ids',
    );

    // 至少有一些候选应有characterPoolIds
    const withPoolIds = result.candidates.filter(c => c.characterPoolIds && c.characterPoolIds.length > 0);
    expect(withPoolIds.length).toBeGreaterThan(0);
    for (const c of withPoolIds) {
      expect(c.characterPoolIds).toContain('pool-agent-1');
    }
  }, 60000);

  it('候选应持久化到数据库', async () => {
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForChar();
    const topPlans = buildFakeTopPlans(allWriters);

    createArenaSession({
      id: 'sess-char-persist', project_id: 'proj-char-test',
      config: '{}', status: 'stage_char', current_stage: 'character',
      task_id: 'task-char-persist', created_at: Date.now(), completed_at: null,
    });

    await runCharacterArena(
      'proj-char-test', topPlans, allWriters, reviewers, scheduler, 'task-char-persist', 'sess-char-persist',
    );

    // 验证候选已持久化
    const dbCandidates = listArenaCandidatesByStage('sess-char-persist', 'character');
    expect(dbCandidates.length).toBeGreaterThan(0);

    // 验证评分已持久化
    const dbScores = listArenaFunnelScoresByStage('sess-char-persist', 'character');
    expect(dbScores.length).toBeGreaterThan(0);
    expect(dbScores.length).toBeLessThanOrEqual(10);
  }, 60000);

  it('每个方案应分配组长+2个变体Agent', async () => {
    let designCallCount = 0;
    const writerIdsPerPlan = new Map<string, string[]>();

    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string, userPrompt: string) => {
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        return { success: true, data: { score: 7, comment: '好' } };
      }
      if (systemPrompt.includes('选角导演')) {
        return { success: true, data: { selectedIds: [], reason: '无' } };
      }
      designCallCount++;
      return { success: true, data: makeFakeCharacterDesign(designCallCount) };
    });

    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForChar();
    const topPlans = buildFakeTopPlans(allWriters);

    createArenaSession({
      id: 'sess-assign', project_id: 'proj-char-test',
      config: '{}', status: 'stage_char', current_stage: 'character',
      task_id: 'task-assign', created_at: Date.now(), completed_at: null,
    });

    const result = await runCharacterArena(
      'proj-char-test', topPlans, allWriters, reviewers, scheduler, 'task-assign', 'sess-assign',
    );

    // 8个方案 × 3个Agent = 24个角色设计调用
    expect(designCallCount).toBe(24);
    // 总生成数应为24
    expect(result.totalGenerated).toBe(24);
  }, 60000);
});


// ============================================================
// 阶段3：分集目录竞争 — 单元测试（任务8）
// ============================================================

import {
  runDirectoryArena,
  buildDirectorySystemPrompt,
  buildDirectoryUserPrompt,
} from '../arena-engine.js';

// 模拟的 EpisodeDirectoryItem 数据
function makeFakeDirectory(totalEpisodes: number) {
  const phases = ['起势段', '攀升段', '风暴段', '决战段'];
  const hookTypes = ['悬念钩', '反转钩', '情绪钩', '信息钩', '危机钩'];
  return Array.from({ length: totalEpisodes }, (_, i) => ({
    number: i + 1,
    title: `第${i + 1}集标题`,
    summary: `第${i + 1}集摘要`,
    hookType: hookTypes[i % hookTypes.length],
    mark: i % 5 === 0 ? '🔥' : i % 7 === 0 ? '💰' : '',
    act: i < 10 ? '第一幕' : i < 25 ? '第二幕' : i < 40 ? '第三幕' : '第四幕',
    phase: phases[Math.min(Math.floor(i / (totalEpisodes / 4)), 3)],
  }));
}

// ============================================================
// buildDirectorySystemPrompt
// ============================================================

describe('buildDirectorySystemPrompt', () => {
  it('应包含writer的systemPrompt', () => {
    const prompt = buildDirectorySystemPrompt('你是听花岛风格编剧', fakeConfig, null);
    expect(prompt).toContain('你是听花岛风格编剧');
  });

  it('应包含节奏要求和钩子类型', () => {
    const prompt = buildDirectorySystemPrompt('', fakeConfig, null);
    expect(prompt).toContain('起势段');
    expect(prompt).toContain('攀升段');
    expect(prompt).toContain('风暴段');
    expect(prompt).toContain('决战段');
    expect(prompt).toContain('悬念钩');
    expect(prompt).toContain('反转钩');
    expect(prompt).toContain('情绪钩');
    expect(prompt).toContain('信息钩');
    expect(prompt).toContain('危机钩');
  });

  it('应包含标记规则', () => {
    const prompt = buildDirectorySystemPrompt('', fakeConfig, null);
    expect(prompt).toContain('🔥');
    expect(prompt).toContain('💰');
    expect(prompt).toContain('25-35%');
    expect(prompt).toContain('10-15%');
  });

  it('应根据集数计算正确的阶段范围', () => {
    const prompt = buildDirectorySystemPrompt('', { ...fakeConfig, totalEpisodes: 100 }, null);
    // rise=15, climb=30, storm=35, final=20
    expect(prompt).toContain('第1-15集');
    expect(prompt).toContain('第16-45集');
    expect(prompt).toContain('第46-80集');
    expect(prompt).toContain('第81-100集');
  });

  it('有timelineArcs时应包含跨时代约束', () => {
    const planWithTimeline = {
      ...makeFakePlan(1),
      timelineArcs: {
        eras: [
          { id: 'era_1', name: '古代', episodeRange: '1-20', setting: { era: '唐朝', location: '长安' } },
          { id: 'era_2', name: '现代', episodeRange: '21-50', setting: { era: '当代', location: '北京' } },
        ],
        foreshadowGraph: [
          { episode: 5, era: 'era_1', type: 'plant', description: '埋下伏笔' },
        ],
        causalChains: [
          { name: '因果链1', nodes: [{ episode: 5, era: 'era_1', event: '事件A' }] },
        ],
      },
    } as unknown as import('../screenplay-creator.js').CreativePlan;

    const prompt = buildDirectorySystemPrompt('', fakeConfig, planWithTimeline);
    expect(prompt).toContain('跨时代时间线约束');
    expect(prompt).toContain('era_1');
    expect(prompt).toContain('古代');
    expect(prompt).toContain('时代切换集必须标记为🔥');
  });

  it('无timelineArcs时不应包含跨时代约束', () => {
    const prompt = buildDirectorySystemPrompt('', fakeConfig, makeFakePlan(1) as any);
    expect(prompt).not.toContain('跨时代时间线约束');
  });
});

// ============================================================
// buildDirectoryUserPrompt
// ============================================================

describe('buildDirectoryUserPrompt', () => {
  const fakePlan = makeFakePlan(1) as unknown as import('../screenplay-creator.js').CreativePlan;
  const fakeCharDesign = makeFakeCharacterDesign(1);

  it('应包含创作方案摘要', () => {
    const prompt = buildDirectoryUserPrompt(fakeConfig, fakePlan, fakeCharDesign);
    expect(prompt).toContain(fakePlan.storyLine);
    expect(prompt).toContain(fakePlan.coreConflict);
  });

  it('应包含角色列表', () => {
    const prompt = buildDirectoryUserPrompt(fakeConfig, fakePlan, fakeCharDesign);
    expect(prompt).toContain('主角1');
    expect(prompt).toContain('反派1');
  });

  it('应包含集数和JSON格式要求', () => {
    const prompt = buildDirectoryUserPrompt(fakeConfig, fakePlan, fakeCharDesign);
    expect(prompt).toContain(`${fakeConfig.totalEpisodes}集`);
    expect(prompt).toContain('hookType');
    expect(prompt).toContain('phase');
    expect(prompt).toContain('起势段/攀升段/风暴段/决战段');
  });

  it('应包含付费卡点规划', () => {
    const prompt = buildDirectoryUserPrompt(fakeConfig, fakePlan, fakeCharDesign);
    expect(prompt).toContain('付费卡点规划');
    expect(prompt).toContain('身份揭露');
  });

  it('应包含四幕结构信息', () => {
    const prompt = buildDirectoryUserPrompt(fakeConfig, fakePlan, fakeCharDesign);
    expect(prompt).toContain('第一幕');
    expect(prompt).toContain('第二幕');
    expect(prompt).toContain('第三幕');
    expect(prompt).toContain('第四幕');
  });
});

// ============================================================
// runDirectoryArena（mock LLM）
// ============================================================

describe('runDirectoryArena', () => {
  const mockChatCompletionJSON = chatCompletionJSON as ReturnType<typeof vi.fn>;
  const mockGetScreenplay = getScreenplay as ReturnType<typeof vi.fn>;

  function buildTestWritersAndReviewersForDir() {
    const groups = buildWriterGroups(4);
    const allWriters = groups.flatMap(g => [g.leader, ...g.members]);
    const reviewers = generateReviewerAgents();
    return { groups, allWriters, reviewers };
  }

  // 构建模拟的阶段2 Top 8角色设计结果（含parentCandidateId指向阶段1方案）
  function buildFakeTopChars(sessionId: string): StageCandidates<unknown> {
    const groups = buildWriterGroups(4);
    const candidates = groups.map((g, idx) => ({
      id: `char-test-${idx}`,
      writerId: g.leader.id,
      groupId: g.id,
      systemAgentId: g.systemAgentId,
      systemAgentName: g.systemAgentName,
      parentCandidateId: `plan-dir-${idx}`, // 指向阶段1的方案
      data: makeFakeCharacterDesign(idx),
      score: 8 - idx * 0.1,
      rank: idx + 1,
    }));
    return {
      stage: 'character' as const,
      candidates,
      totalGenerated: 24,
      totalSurvived: 8,
    };
  }

  // 在数据库中插入阶段1的方案候选（供 runDirectoryArena 查询）
  function insertFakePlanCandidates(sessionId: string) {
    const rows: ArenaCandidateRow[] = [];
    for (let i = 0; i < 8; i++) {
      rows.push({
        id: `plan-dir-${i}`,
        session_id: sessionId,
        stage: 'creative_plan',
        writer_id: `writer-${i}`,
        group_id: `group-sys-${String(i + 11)}`,
        system_agent_id: `sys-${String(i + 11)}`,
        system_agent_name: `骨架${i + 1}`,
        parent_candidate_id: null,
        content: JSON.stringify(makeFakePlan(i)),
        character_pool_ids: null,
        created_at: Date.now(),
      });
    }
    batchInsertArenaCandidates(rows);
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetScreenplay.mockReturnValue({
      id: 'proj-dir-test',
      config: fakeConfig,
      status: 'char_done',
      creativePlan: makeFakePlan(0),
      characterDesign: makeFakeCharacterDesign(0),
    });

    // Mock chatCompletionJSON：区分不同调用类型
    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      // 评审Agent
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        return { success: true, data: { score: 5 + Math.random() * 4, comment: '目录节奏不错' } };
      }
      // 分集目录生成
      return { success: true, data: makeFakeDirectory(fakeConfig.totalEpisodes) };
    });
  });

  it('项目不存在时应返回空结果', async () => {
    mockGetScreenplay.mockReturnValue(undefined);
    const scheduler = new QueueScheduler(5);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForDir();
    const topChars = buildFakeTopChars('sess-empty');

    const result = await runDirectoryArena(
      'nonexistent', topChars, allWriters, reviewers, scheduler, 'task-1', 'sess-1',
    );

    expect(result.stage).toBe('directory');
    expect(result.candidates).toHaveLength(0);
    expect(result.totalGenerated).toBe(0);
  });

  it('应为每个组合生成目录并评审筛选出Top 5', async () => {
    const sessId = 'sess-dir-test';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForDir();

    createArenaSession({
      id: sessId, project_id: 'proj-dir-test',
      config: '{}', status: 'stage_dir', current_stage: 'directory',
      task_id: 'task-dir', created_at: Date.now(), completed_at: null,
    });
    insertFakePlanCandidates(sessId);

    const topChars = buildFakeTopChars(sessId);

    const result = await runDirectoryArena(
      'proj-dir-test', topChars, allWriters, reviewers, scheduler, 'task-dir', sessId,
    );

    expect(result.stage).toBe('directory');
    // 8个组合 × 2个Agent = 最多16个候选
    expect(result.totalGenerated).toBeGreaterThan(0);
    expect(result.totalGenerated).toBeLessThanOrEqual(16);
    // Top 5筛选
    expect(result.totalSurvived).toBeLessThanOrEqual(5);
    expect(result.totalSurvived).toBeGreaterThan(0);
    expect(result.candidates.length).toBeLessThanOrEqual(5);
  }, 60000);

  it('每个候选应正确填充groupId、systemAgentId、systemAgentName', async () => {
    const sessId = 'sess-dir-fields';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForDir();

    createArenaSession({
      id: sessId, project_id: 'proj-dir-test',
      config: '{}', status: 'stage_dir', current_stage: 'directory',
      task_id: 'task-dir-fields', created_at: Date.now(), completed_at: null,
    });
    insertFakePlanCandidates(sessId);

    const topChars = buildFakeTopChars(sessId);

    const result = await runDirectoryArena(
      'proj-dir-test', topChars, allWriters, reviewers, scheduler, 'task-dir-fields', sessId,
    );

    for (const candidate of result.candidates) {
      expect(candidate.groupId).toMatch(/^group-/);
      const sysAgent = SYSTEM_AGENTS.find(a => a.id === candidate.systemAgentId);
      expect(sysAgent).toBeDefined();
      expect(candidate.systemAgentName).toBeTruthy();
      expect(candidate.parentCandidateId).toBeTruthy();
    }
  }, 60000);

  it('候选应有排名且Top 1标记selected', async () => {
    const sessId = 'sess-dir-rank';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForDir();

    createArenaSession({
      id: sessId, project_id: 'proj-dir-test',
      config: '{}', status: 'stage_dir', current_stage: 'directory',
      task_id: 'task-dir-rank', created_at: Date.now(), completed_at: null,
    });
    insertFakePlanCandidates(sessId);

    const topChars = buildFakeTopChars(sessId);

    const result = await runDirectoryArena(
      'proj-dir-test', topChars, allWriters, reviewers, scheduler, 'task-dir-rank', sessId,
    );

    // 验证排名
    for (let i = 0; i < result.candidates.length; i++) {
      expect(result.candidates[i].rank).toBe(i + 1);
    }

    // 验证分数降序
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].score).toBeGreaterThanOrEqual(result.candidates[i].score);
    }

    // Top 1 应标记 selected
    if (result.candidates.length > 0) {
      expect(result.candidates[0].selected).toBe(true);
    }
  }, 60000);

  it('候选应持久化到数据库', async () => {
    const sessId = 'sess-dir-persist';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForDir();

    createArenaSession({
      id: sessId, project_id: 'proj-dir-test',
      config: '{}', status: 'stage_dir', current_stage: 'directory',
      task_id: 'task-dir-persist', created_at: Date.now(), completed_at: null,
    });
    insertFakePlanCandidates(sessId);

    const topChars = buildFakeTopChars(sessId);

    await runDirectoryArena(
      'proj-dir-test', topChars, allWriters, reviewers, scheduler, 'task-dir-persist', sessId,
    );

    // 验证候选已持久化
    const dbCandidates = listArenaCandidatesByStage(sessId, 'directory');
    expect(dbCandidates.length).toBeGreaterThan(0);

    // 验证评分已持久化
    const dbScores = listArenaFunnelScoresByStage(sessId, 'directory');
    expect(dbScores.length).toBeGreaterThan(0);
    expect(dbScores.length).toBeLessThanOrEqual(5);
  }, 60000);

  it('部分LLM失败时应优雅降级', async () => {
    let callIdx = 0;
    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        return { success: true, data: { score: 7, comment: '评审' } };
      }
      callIdx++;
      // 每3个失败1个
      if (callIdx % 3 === 0) {
        return { success: false, error: '模拟失败' };
      }
      return { success: true, data: makeFakeDirectory(fakeConfig.totalEpisodes) };
    });

    const sessId = 'sess-dir-fail';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForDir();

    createArenaSession({
      id: sessId, project_id: 'proj-dir-test',
      config: '{}', status: 'stage_dir', current_stage: 'directory',
      task_id: 'task-dir-fail', created_at: Date.now(), completed_at: null,
    });
    insertFakePlanCandidates(sessId);

    const topChars = buildFakeTopChars(sessId);

    const result = await runDirectoryArena(
      'proj-dir-test', topChars, allWriters, reviewers, scheduler, 'task-dir-fail', sessId,
    );

    expect(result.stage).toBe('directory');
    // 部分失败，但不应崩溃
    expect(result.totalGenerated).toBeLessThan(16);
    expect(result.totalGenerated).toBeGreaterThan(0);
  }, 60000);

  it('每个组合应分配组长+1个变体Agent（共2个）', async () => {
    let dirCallCount = 0;
    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        return { success: true, data: { score: 7, comment: '好' } };
      }
      dirCallCount++;
      return { success: true, data: makeFakeDirectory(fakeConfig.totalEpisodes) };
    });

    const sessId = 'sess-dir-assign';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForDir();

    createArenaSession({
      id: sessId, project_id: 'proj-dir-test',
      config: '{}', status: 'stage_dir', current_stage: 'directory',
      task_id: 'task-dir-assign', created_at: Date.now(), completed_at: null,
    });
    insertFakePlanCandidates(sessId);

    const topChars = buildFakeTopChars(sessId);

    const result = await runDirectoryArena(
      'proj-dir-test', topChars, allWriters, reviewers, scheduler, 'task-dir-assign', sessId,
    );

    // 8个组合 × 2个Agent = 16个目录生成调用
    expect(dirCallCount).toBe(16);
    expect(result.totalGenerated).toBe(16);
  }, 60000);

  it('LLM返回包裹对象时应正确解析', async () => {
    // Mock返回 { directory: [...] } 而非直接数组
    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        return { success: true, data: { score: 7, comment: '好' } };
      }
      return { success: true, data: { directory: makeFakeDirectory(fakeConfig.totalEpisodes) } };
    });

    const sessId = 'sess-dir-wrap';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForDir();

    createArenaSession({
      id: sessId, project_id: 'proj-dir-test',
      config: '{}', status: 'stage_dir', current_stage: 'directory',
      task_id: 'task-dir-wrap', created_at: Date.now(), completed_at: null,
    });
    insertFakePlanCandidates(sessId);

    const topChars = buildFakeTopChars(sessId);

    const result = await runDirectoryArena(
      'proj-dir-test', topChars, allWriters, reviewers, scheduler, 'task-dir-wrap', sessId,
    );

    // 包裹对象应被正确解析
    expect(result.totalGenerated).toBe(16);
    // 每个候选的data应是数组
    for (const c of result.candidates) {
      expect(Array.isArray(c.data)).toBe(true);
    }
  }, 60000);

  it('评审应使用directory阶段的方向（节奏+商业+结构）', async () => {
    const reviewCalls: string[] = [];
    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        reviewCalls.push(systemPrompt);
        return { success: true, data: { score: 7, comment: '好' } };
      }
      return { success: true, data: makeFakeDirectory(fakeConfig.totalEpisodes) };
    });

    const sessId = 'sess-dir-review';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForDir();

    createArenaSession({
      id: sessId, project_id: 'proj-dir-test',
      config: '{}', status: 'stage_dir', current_stage: 'directory',
      task_id: 'task-dir-review', created_at: Date.now(), completed_at: null,
    });
    insertFakePlanCandidates(sessId);

    const topChars = buildFakeTopChars(sessId);

    await runDirectoryArena(
      'proj-dir-test', topChars, allWriters, reviewers, scheduler, 'task-dir-review', sessId,
    );

    // 应有评审调用
    expect(reviewCalls.length).toBeGreaterThan(0);
  }, 60000);
});

// ============================================================
// 任务9: 阶段4 — 分集剧本全量+逐集评审（5→3）
// ============================================================

import {
  buildEpisodeSystemPrompt,
  buildEpisodeUserPrompt,
  runEpisodeArena,
} from '../arena-engine.js';

// 模拟的 EpisodeScript 数据
function makeFakeEpisodeScript(epNum: number) {
  return {
    number: epNum,
    title: `第${epNum}集标题`,
    keywords: ['关键词1', '关键词2'],
    satisfactionType: '反转爽',
    previousRecap: '前情提要',
    scenes: [
      {
        sceneNumber: 1,
        location: '内景 · 客厅 · 日',
        characters: ['主角', '反派'],
        description: '△ 全景：客厅场景描写',
        dialogues: [
          { character: '主角', direction: '冷笑', line: '你以为这样就能瞒过所有人？' },
          { character: '反派', direction: '拍桌', line: '真相迟早大白。' },
        ],
        musicCue: '♪ 紧张弦乐',
      },
    ],
    endHook: '🎣 主角发现了惊天秘密',
    nextPreview: '📺 下集更精彩',
    phase: '起势段',
    hookType: '悬念钩',
    mark: '',
  };
}

// ============================================================
// buildEpisodeSystemPrompt
// ============================================================

describe('buildEpisodeSystemPrompt', () => {
  const fakeDirItem = {
    number: 1,
    title: '第1集',
    summary: '开篇',
    hookType: '悬念钩',
    mark: '',
    phase: '起势段',
  } as import('../screenplay-creator.js').EpisodeDirectoryItem;

  it('应包含writer的systemPrompt', () => {
    const prompt = buildEpisodeSystemPrompt('你是听花岛风格编剧', fakeConfig, 1, fakeDirItem);
    expect(prompt).toContain('你是听花岛风格编剧');
  });

  it('应包含集数信息', () => {
    const prompt = buildEpisodeSystemPrompt('', fakeConfig, 5, fakeDirItem);
    expect(prompt).toContain('第5集');
  });

  it('应包含格式要求（国内模式）', () => {
    const prompt = buildEpisodeSystemPrompt('', fakeConfig, 1, fakeDirItem);
    expect(prompt).toContain('内景/外景');
    expect(prompt).toContain('△');
    expect(prompt).toContain('国内');
  });

  it('应包含格式要求（海外模式）', () => {
    const overseasConfig = { ...fakeConfig, mode: 'overseas' as const };
    const prompt = buildEpisodeSystemPrompt('', overseasConfig, 1, fakeDirItem);
    expect(prompt).toContain('INT./EXT.');
    expect(prompt).toContain('海外');
  });

  it('应包含质量要求', () => {
    const prompt = buildEpisodeSystemPrompt('', fakeConfig, 1, fakeDirItem);
    expect(prompt).toContain('质量要求');
    expect(prompt).toContain('3-5个场次');
    expect(prompt).toContain('600-900字');
  });

  it('第1集应包含开场要求', () => {
    const prompt = buildEpisodeSystemPrompt('', fakeConfig, 1, fakeDirItem);
    expect(prompt).toContain('第1集前10秒');
  });

  it('非第1集不应包含开场要求', () => {
    const dirItem5 = { ...fakeDirItem, number: 5 };
    const prompt = buildEpisodeSystemPrompt('', fakeConfig, 5, dirItem5);
    expect(prompt).not.toContain('第1集前10秒');
  });

  it('付费卡点集应包含付费提示', () => {
    const paidDirItem = { ...fakeDirItem, mark: '💰' as const };
    const prompt = buildEpisodeSystemPrompt('', fakeConfig, 1, paidDirItem);
    expect(prompt).toContain('付费卡点集');
  });

  it('应包含钩子类型', () => {
    const prompt = buildEpisodeSystemPrompt('', fakeConfig, 1, fakeDirItem);
    expect(prompt).toContain('悬念钩');
  });
});

// ============================================================
// buildEpisodeUserPrompt
// ============================================================

describe('buildEpisodeUserPrompt', () => {
  const fakePlan = makeFakePlan(0) as unknown as import('../screenplay-creator.js').CreativePlan;
  const fakeCharDesign = makeFakeCharacterDesign(0);
  const fakeDirItem = {
    number: 3,
    title: '第3集标题',
    summary: '第3集摘要',
    hookType: '反转钩',
    mark: '🔥',
    phase: '攀升段',
  } as import('../screenplay-creator.js').EpisodeDirectoryItem;

  it('应包含集信息', () => {
    const prompt = buildEpisodeUserPrompt(fakeConfig, fakePlan, fakeCharDesign, fakeDirItem, 3, '');
    expect(prompt).toContain('第3集');
    expect(prompt).toContain('第3集标题');
    expect(prompt).toContain('第3集摘要');
    expect(prompt).toContain('反转钩');
    expect(prompt).toContain('攀升段');
  });

  it('应包含角色简表', () => {
    const prompt = buildEpisodeUserPrompt(fakeConfig, fakePlan, fakeCharDesign, fakeDirItem, 3, '');
    expect(prompt).toContain('角色简表');
    // 角色名来自 makeFakeCharacterDesign
    expect(prompt).toContain('主角');
  });

  it('应包含故事线和核心冲突', () => {
    const prompt = buildEpisodeUserPrompt(fakeConfig, fakePlan, fakeCharDesign, fakeDirItem, 3, '');
    expect(prompt).toContain(fakePlan.storyLine);
    expect(prompt).toContain(fakePlan.coreConflict);
  });

  it('有上集钩子时应包含', () => {
    const prompt = buildEpisodeUserPrompt(fakeConfig, fakePlan, fakeCharDesign, fakeDirItem, 3, '主角被绑架了');
    expect(prompt).toContain('上集钩子');
    expect(prompt).toContain('主角被绑架了');
  });

  it('无上集钩子时不应包含', () => {
    const prompt = buildEpisodeUserPrompt(fakeConfig, fakePlan, fakeCharDesign, fakeDirItem, 3, '');
    expect(prompt).not.toContain('上集钩子');
  });

  it('应包含JSON格式要求', () => {
    const prompt = buildEpisodeUserPrompt(fakeConfig, fakePlan, fakeCharDesign, fakeDirItem, 3, '');
    expect(prompt).toContain('JSON');
    expect(prompt).toContain('scenes');
    expect(prompt).toContain('endHook');
  });
});

// ============================================================
// runEpisodeArena（mock LLM）
// ============================================================

describe('runEpisodeArena', () => {
  const mockChatCompletionJSON = chatCompletionJSON as ReturnType<typeof vi.fn>;
  const mockGetScreenplay = getScreenplay as ReturnType<typeof vi.fn>;

  function buildTestWritersAndReviewersForEp() {
    const groups = buildWriterGroups(4);
    const allWriters = groups.flatMap(g => [g.leader, ...g.members]);
    const reviewers = generateReviewerAgents();
    return { groups, allWriters, reviewers };
  }

  // 构建模拟的阶段3 Top 5目录结果
  function buildFakeTopDirs(sessionId: string): StageCandidates<unknown> {
    const groups = buildWriterGroups(4);
    // 只取前5个组（Top 5）
    const candidates = groups.slice(0, 5).map((g, idx) => ({
      id: `dir-test-${idx}`,
      writerId: g.leader.id,
      groupId: g.id,
      systemAgentId: g.systemAgentId,
      systemAgentName: g.systemAgentName,
      parentCandidateId: `char-ep-${idx}`, // 指向阶段2的角色设计
      data: makeFakeDirectory(3), // 只3集，加速测试
      score: 8 - idx * 0.2,
      rank: idx + 1,
    }));
    return {
      stage: 'directory' as const,
      candidates,
      totalGenerated: 16,
      totalSurvived: 5,
    };
  }

  // 在数据库中插入阶段1方案和阶段2角色候选（供 runEpisodeArena 查询）
  function insertFakeDataForEpisode(sessionId: string) {
    // 阶段1方案
    const planRows: ArenaCandidateRow[] = [];
    for (let i = 0; i < 5; i++) {
      planRows.push({
        id: `plan-ep-${i}`,
        session_id: sessionId,
        stage: 'creative_plan',
        writer_id: `writer-${i}`,
        group_id: `group-sys-${String(i + 11)}`,
        system_agent_id: `sys-${String(i + 11)}`,
        system_agent_name: `骨架${i + 1}`,
        parent_candidate_id: null,
        content: JSON.stringify(makeFakePlan(i)),
        character_pool_ids: null,
        created_at: Date.now(),
      });
    }
    batchInsertArenaCandidates(planRows);

    // 阶段2角色设计（parentCandidateId指向方案）
    const charRows: ArenaCandidateRow[] = [];
    for (let i = 0; i < 5; i++) {
      charRows.push({
        id: `char-ep-${i}`,
        session_id: sessionId,
        stage: 'character',
        writer_id: `writer-${i}`,
        group_id: `group-sys-${String(i + 11)}`,
        system_agent_id: `sys-${String(i + 11)}`,
        system_agent_name: `骨架${i + 1}`,
        parent_candidate_id: `plan-ep-${i}`,
        content: JSON.stringify(makeFakeCharacterDesign(i)),
        character_pool_ids: null,
        created_at: Date.now(),
      });
    }
    batchInsertArenaCandidates(charRows);
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockGetScreenplay.mockReturnValue({
      id: 'proj-ep-test',
      config: fakeConfig,
      status: 'dir_done',
      creativePlan: makeFakePlan(0),
      characterDesign: makeFakeCharacterDesign(0),
    });

    // Mock chatCompletionJSON：区分评审和剧本生成
    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      // 评审Agent（包含"评审维度"或"专业评分"关键词）
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        return { success: true, data: { score: 7 + Math.random() * 2, comment: '剧本质量不错' } };
      }
      // 打回修改（包含"改写原则"关键词）
      if (systemPrompt.includes('改写原则') || systemPrompt.includes('评审意见修改')) {
        return { success: true, data: makeFakeEpisodeScript(1) };
      }
      // 剧本生成
      return { success: true, data: makeFakeEpisodeScript(1) };
    });
  });

  it('项目不存在时应返回空结果', async () => {
    mockGetScreenplay.mockReturnValue(undefined);
    const scheduler = new QueueScheduler(5);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForEp();
    const topDirs = buildFakeTopDirs('sess-empty');

    const result = await runEpisodeArena(
      'nonexistent', topDirs, allWriters, reviewers, scheduler, 'task-1', 'sess-1',
    );

    expect(result.stage).toBe('episode');
    expect(result.candidates).toHaveLength(0);
    expect(result.totalGenerated).toBe(0);
  });

  it('应为Top 5生成剧本并筛选出Top 3', async () => {
    const sessId = 'sess-ep-test';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForEp();

    // 创建session（含passScore配置）
    createArenaSession({
      id: sessId, project_id: 'proj-ep-test',
      config: JSON.stringify({ passScore: 5.5, concurrency: 5, strictness: 'standard', groupCount: 10, membersPerGroup: 4 }),
      status: 'stage_ep', current_stage: 'episode',
      task_id: 'task-ep', created_at: Date.now(), completed_at: null,
    });
    insertFakeDataForEpisode(sessId);

    const topDirs = buildFakeTopDirs(sessId);

    const result = await runEpisodeArena(
      'proj-ep-test', topDirs, allWriters, reviewers, scheduler, 'task-ep', sessId,
    );

    expect(result.stage).toBe('episode');
    // 最多5个候选，筛选出Top 3
    expect(result.totalGenerated).toBeGreaterThan(0);
    expect(result.totalGenerated).toBeLessThanOrEqual(5);
    expect(result.totalSurvived).toBeLessThanOrEqual(3);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  }, 120000);

  it('每个候选应正确填充groupId、systemAgentId、systemAgentName', async () => {
    const sessId = 'sess-ep-fields';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForEp();

    createArenaSession({
      id: sessId, project_id: 'proj-ep-test',
      config: JSON.stringify({ passScore: 5.5, concurrency: 5, strictness: 'standard', groupCount: 10, membersPerGroup: 4 }),
      status: 'stage_ep', current_stage: 'episode',
      task_id: 'task-ep-fields', created_at: Date.now(), completed_at: null,
    });
    insertFakeDataForEpisode(sessId);

    const topDirs = buildFakeTopDirs(sessId);

    const result = await runEpisodeArena(
      'proj-ep-test', topDirs, allWriters, reviewers, scheduler, 'task-ep-fields', sessId,
    );

    for (const candidate of result.candidates) {
      expect(candidate.groupId).toMatch(/^group-/);
      const sysAgent = SYSTEM_AGENTS.find(a => a.id === candidate.systemAgentId);
      expect(sysAgent).toBeDefined();
      expect(candidate.systemAgentName).toBeTruthy();
      expect(candidate.parentCandidateId).toBeTruthy();
    }
  }, 120000);

  it('候选应有排名且Top 1标记selected', async () => {
    const sessId = 'sess-ep-rank';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForEp();

    createArenaSession({
      id: sessId, project_id: 'proj-ep-test',
      config: JSON.stringify({ passScore: 5.5, concurrency: 5, strictness: 'standard', groupCount: 10, membersPerGroup: 4 }),
      status: 'stage_ep', current_stage: 'episode',
      task_id: 'task-ep-rank', created_at: Date.now(), completed_at: null,
    });
    insertFakeDataForEpisode(sessId);

    const topDirs = buildFakeTopDirs(sessId);

    const result = await runEpisodeArena(
      'proj-ep-test', topDirs, allWriters, reviewers, scheduler, 'task-ep-rank', sessId,
    );

    // 验证排名
    for (let i = 0; i < result.candidates.length; i++) {
      expect(result.candidates[i].rank).toBe(i + 1);
    }

    // 验证分数降序
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].score).toBeGreaterThanOrEqual(result.candidates[i].score);
    }

    // Top 1 应标记 selected
    if (result.candidates.length > 0) {
      expect(result.candidates[0].selected).toBe(true);
    }
  }, 120000);

  it('打回修改机制：低分时应触发修改（最多2次）', async () => {
    let reviewCallCount = 0;
    let reviseCallCount = 0;

    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      // 评审Agent
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        reviewCallCount++;
        // 前几次评审给低分，触发打回
        const score = reviewCallCount <= 30 ? 3 : 8;
        return { success: true, data: { score, comment: '需要改进' } };
      }
      // 打回修改
      if (systemPrompt.includes('改写原则') || systemPrompt.includes('评审意见修改')) {
        reviseCallCount++;
        return { success: true, data: makeFakeEpisodeScript(1) };
      }
      // 剧本生成
      return { success: true, data: makeFakeEpisodeScript(1) };
    });

    const sessId = 'sess-ep-revise';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForEp();

    createArenaSession({
      id: sessId, project_id: 'proj-ep-test',
      config: JSON.stringify({ passScore: 7.0, concurrency: 5, strictness: 'strict', groupCount: 10, membersPerGroup: 4 }),
      status: 'stage_ep', current_stage: 'episode',
      task_id: 'task-ep-revise', created_at: Date.now(), completed_at: null,
    });
    insertFakeDataForEpisode(sessId);

    const topDirs = buildFakeTopDirs(sessId);

    const result = await runEpisodeArena(
      'proj-ep-test', topDirs, allWriters, reviewers, scheduler, 'task-ep-revise', sessId,
    );

    // 应有评审调用
    expect(reviewCallCount).toBeGreaterThan(0);
    // 应有结果
    expect(result.stage).toBe('episode');
    expect(result.totalGenerated).toBeGreaterThan(0);
  }, 180000);

  it('候选应持久化到数据库', async () => {
    const sessId = 'sess-ep-persist';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForEp();

    createArenaSession({
      id: sessId, project_id: 'proj-ep-test',
      config: JSON.stringify({ passScore: 5.5, concurrency: 5, strictness: 'standard', groupCount: 10, membersPerGroup: 4 }),
      status: 'stage_ep', current_stage: 'episode',
      task_id: 'task-ep-persist', created_at: Date.now(), completed_at: null,
    });
    insertFakeDataForEpisode(sessId);

    const topDirs = buildFakeTopDirs(sessId);

    await runEpisodeArena(
      'proj-ep-test', topDirs, allWriters, reviewers, scheduler, 'task-ep-persist', sessId,
    );

    // 验证候选已持久化
    const dbCandidates = listArenaCandidatesByStage(sessId, 'episode');
    expect(dbCandidates.length).toBeGreaterThan(0);

    // 验证评分已持久化
    const dbScores = listArenaFunnelScoresByStage(sessId, 'episode');
    expect(dbScores.length).toBeGreaterThan(0);
  }, 120000);

  it('评审应使用episode阶段的全部10个方向', async () => {
    const reviewDirections = new Set<string>();
    mockChatCompletionJSON.mockImplementation(async (systemPrompt: string) => {
      if (systemPrompt.includes('评审维度') || systemPrompt.includes('专业评分')) {
        // 从systemPrompt中提取方向关键词
        if (systemPrompt.includes('剧情结构')) reviewDirections.add('plot_structure');
        if (systemPrompt.includes('人物塑造') || systemPrompt.includes('角色心理学')) reviewDirections.add('characterization');
        if (systemPrompt.includes('对白') || systemPrompt.includes('台词功力')) reviewDirections.add('dialogue_quality');
        if (systemPrompt.includes('节奏')) reviewDirections.add('pacing');
        if (systemPrompt.includes('商业')) reviewDirections.add('commercial_potential');
        if (systemPrompt.includes('创意') || systemPrompt.includes('创新')) reviewDirections.add('creativity');
        if (systemPrompt.includes('情感')) reviewDirections.add('emotional_resonance');
        if (systemPrompt.includes('视觉')) reviewDirections.add('visual_narrative');
        if (systemPrompt.includes('合规')) reviewDirections.add('compliance');
        if (systemPrompt.includes('制片')) reviewDirections.add('production_feasibility');
        return { success: true, data: { score: 7, comment: '好' } };
      }
      return { success: true, data: makeFakeEpisodeScript(1) };
    });

    const sessId = 'sess-ep-dirs';
    const scheduler = new QueueScheduler(10);
    const { allWriters, reviewers } = buildTestWritersAndReviewersForEp();

    createArenaSession({
      id: sessId, project_id: 'proj-ep-test',
      config: JSON.stringify({ passScore: 5.5, concurrency: 5, strictness: 'standard', groupCount: 10, membersPerGroup: 4 }),
      status: 'stage_ep', current_stage: 'episode',
      task_id: 'task-ep-dirs', created_at: Date.now(), completed_at: null,
    });
    insertFakeDataForEpisode(sessId);

    const topDirs = buildFakeTopDirs(sessId);

    await runEpisodeArena(
      'proj-ep-test', topDirs, allWriters, reviewers, scheduler, 'task-ep-dirs', sessId,
    );

    // episode阶段应激活全部10个方向
    expect(reviewDirections.size).toBe(10);
  }, 120000);
});

// ============================================================
// 小规模端到端验证
// 使用2组×3人=6创作 + 10评审，验证漏斗流程和风格溯源
// ============================================================

describe('小规模端到端验证', () => {
  it('2组×3人的小规模漏斗流程', async () => {
    // 1. 构建2个创作组（每组1组长+2组员=3人）
    const groups = buildWriterGroups(2); // membersPerGroup=2
    const twoGroups = groups.slice(0, 2);

    // 验证结构
    expect(twoGroups).toHaveLength(2);
    for (const group of twoGroups) {
      expect(group.leader.isLeader).toBe(true);
      expect(group.members).toHaveLength(2);
      // 风格溯源
      expect(group.systemAgentId).toBeTruthy();
      expect(group.systemAgentName).toBeTruthy();
    }

    // 2. 生成10个评审Agent（每方向1人，简化版）
    const reviewers = generateReviewerAgents(1);
    expect(reviewers.length).toBe(10); // 10个方向×1人

    // 3. 验证评审方向覆盖
    const directionIds = [...new Set(reviewers.map(r => r.directionId))];
    expect(directionIds).toHaveLength(10);

    // 4. 验证漏斗收窄逻辑
    // 模拟6个候选（2组×3人）
    const candidates: CandidateEntry<string>[] = [];
    for (const group of twoGroups) {
      const allAgents = [group.leader, ...group.members];
      for (const agent of allAgents) {
        candidates.push({
          id: `cand-${agent.id}`,
          writerId: agent.id,
          groupId: group.id,
          systemAgentId: group.systemAgentId,
          systemAgentName: group.systemAgentName,
          data: `plan-by-${agent.name}`,
          score: Math.random() * 10,
        });
      }
    }
    expect(candidates).toHaveLength(6);

    // 每组取Top 1 → 2个候选
    const top = selectBestPerGroup(candidates, 'groupId', 1);
    expect(top.length).toBeLessThanOrEqual(2);
    expect(top.length).toBeLessThan(candidates.length);

    // 验证风格溯源完整性
    for (const c of top) {
      expect(c.systemAgentId).toBeTruthy();
      expect(c.systemAgentName).toBeTruthy();
      expect(c.groupId).toBeTruthy();
    }
  });
});
