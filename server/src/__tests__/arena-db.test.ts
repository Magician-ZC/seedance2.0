/**
 * 百Agent竞技模式 — 数据库持久化单元测试
 * 覆盖：6个表的CRUD、批量操作、断点续传状态恢复
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
  initDB, getDB, saveDB,
  createArenaSession,
  getArenaSession,
  getArenaSessionByProjectId,
  updateArenaSession,
  batchInsertArenaWriters,
  listArenaWritersBySession,
  batchInsertArenaReviewers,
  listArenaReviewersBySession,
  insertArenaCandidate,
  batchInsertArenaCandidates,
  listArenaCandidatesByStage,
  insertArenaReview,
  batchInsertArenaReviews,
  listArenaReviewsByCandidate,
  insertArenaFunnelScore,
  batchInsertArenaFunnelScores,
  listArenaFunnelScoresByStage,
  updateArenaFunnelScoreSelected,
  getArenaResumeState,
  getCompletedStageCandidates,
  getCompletedStageScores,
  type ArenaSessionRow,
  type ArenaWriterRow,
  type ArenaReviewerRow,
  type ArenaCandidateRow,
  type ArenaReviewRow,
  type ArenaFunnelScoreRow,
} from '../db-service.js';

// 初始化数据库
beforeAll(async () => {
  await initDB();
});

// 每次测试前清理竞技模式相关表，避免UNIQUE冲突
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
// 竞技会话 CRUD
// ============================================================

describe('ArenaSession CRUD', () => {
  const session: ArenaSessionRow = {
    id: 'test-session-1',
    project_id: 'proj-001',
    config: JSON.stringify({ groupCount: 10, concurrency: 5 }),
    status: 'init',
    current_stage: null,
    task_id: 'task-001',
    created_at: now,
    completed_at: null,
  };

  it('createArenaSession 应成功插入', () => {
    expect(() => createArenaSession(session)).not.toThrow();
  });

  it('getArenaSession 应返回正确数据', () => {
    createArenaSession(session);
    const row = getArenaSession('test-session-1');
    expect(row).not.toBeNull();
    expect(row!.id).toBe('test-session-1');
    expect(row!.project_id).toBe('proj-001');
    expect(row!.status).toBe('init');
    expect(row!.task_id).toBe('task-001');
  });

  it('getArenaSessionByProjectId 应返回最新会话', () => {
    createArenaSession(session);
    const row = getArenaSessionByProjectId('proj-001');
    expect(row).not.toBeNull();
    expect(row!.id).toBe('test-session-1');
  });

  it('updateArenaSession 应更新指定字段', () => {
    createArenaSession(session);
    updateArenaSession('test-session-1', { status: 'stage_plan', current_stage: 'creative_plan' });
    const row = getArenaSession('test-session-1');
    expect(row!.status).toBe('stage_plan');
    expect(row!.current_stage).toBe('creative_plan');
  });

  it('getArenaSession 不存在的ID应返回null', () => {
    expect(getArenaSession('nonexistent')).toBeNull();
  });
});

// ============================================================
// 创作Agent批量持久化
// ============================================================

describe('ArenaWriter 批量持久化', () => {
  const writers: ArenaWriterRow[] = [
    {
      id: 'leader-sys-01', session_id: 'sess-w', group_id: 'group-sys-01',
      name: '听花岛·组长', is_leader: 1, system_agent_id: 'sys-01',
      system_agent_name: '听花岛', base_style_id: 'sys-01',
      style_gene: JSON.stringify({ baseStyleId: 'sys-01' }),
      system_prompt: '原始prompt', created_at: now,
    },
    {
      id: 'member-sys-01-0', session_id: 'sess-w', group_id: 'group-sys-01',
      name: '听花岛·变体1', is_leader: 0, system_agent_id: 'sys-01',
      system_agent_name: '听花岛', base_style_id: 'sys-01',
      style_gene: JSON.stringify({ baseStyleId: 'sys-01' }),
      system_prompt: '变异prompt', created_at: now,
    },
  ];

  it('batchInsertArenaWriters 应成功批量插入', () => {
    expect(() => batchInsertArenaWriters(writers)).not.toThrow();
  });

  it('listArenaWritersBySession 应返回正确数据', () => {
    batchInsertArenaWriters(writers);
    const rows = listArenaWritersBySession('sess-w');
    expect(rows.length).toBe(2);
    // 组长排在前面（ORDER BY is_leader DESC）
    expect(rows[0].is_leader).toBe(1);
    expect(rows[0].name).toBe('听花岛·组长');
  });

  it('空session应返回空数组', () => {
    expect(listArenaWritersBySession('nonexistent')).toHaveLength(0);
  });
});

// ============================================================
// 评审Agent批量持久化
// ============================================================

describe('ArenaReviewer 批量持久化', () => {
  const reviewers: ArenaReviewerRow[] = [
    {
      id: 'rev-plot-0', session_id: 'sess-r', direction_id: 'plot_structure',
      direction_name: '剧情结构专家', system_prompt: '评审prompt',
      weight: 0.15, created_at: now,
    },
    {
      id: 'rev-char-0', session_id: 'sess-r', direction_id: 'characterization',
      direction_name: '人物塑造专家', system_prompt: '评审prompt',
      weight: 0.12, created_at: now,
    },
  ];

  it('batchInsertArenaReviewers 应成功批量插入', () => {
    expect(() => batchInsertArenaReviewers(reviewers)).not.toThrow();
  });

  it('listArenaReviewersBySession 应返回正确数据', () => {
    batchInsertArenaReviewers(reviewers);
    const rows = listArenaReviewersBySession('sess-r');
    expect(rows.length).toBe(2);
  });
});

// ============================================================
// 候选产出持久化
// ============================================================

describe('ArenaCandidate 持久化', () => {
  const candidate: ArenaCandidateRow = {
    id: 'cand-001', session_id: 'sess-c', stage: 'creative_plan',
    writer_id: 'leader-sys-01', group_id: 'group-sys-01',
    system_agent_id: 'sys-01', system_agent_name: '听花岛',
    parent_candidate_id: null, content: JSON.stringify({ title: '测试方案' }),
    character_pool_ids: null, created_at: now,
  };

  it('insertArenaCandidate 应成功插入', () => {
    expect(() => insertArenaCandidate(candidate)).not.toThrow();
  });

  it('batchInsertArenaCandidates 应成功批量插入', () => {
    const batch: ArenaCandidateRow[] = [
      { ...candidate, id: 'cand-002', writer_id: 'member-sys-01-0' },
      { ...candidate, id: 'cand-003', writer_id: 'member-sys-01-1', stage: 'character', parent_candidate_id: 'cand-001' },
    ];
    expect(() => batchInsertArenaCandidates(batch)).not.toThrow();
  });

  it('listArenaCandidatesByStage 应按阶段过滤', () => {
    insertArenaCandidate(candidate);
    batchInsertArenaCandidates([
      { ...candidate, id: 'cand-002', writer_id: 'member-sys-01-0' },
      { ...candidate, id: 'cand-003', writer_id: 'member-sys-01-1', stage: 'character', parent_candidate_id: 'cand-001' },
    ]);
    const planCands = listArenaCandidatesByStage('sess-c', 'creative_plan');
    expect(planCands.length).toBe(2);
    const charCands = listArenaCandidatesByStage('sess-c', 'character');
    expect(charCands.length).toBe(1);
  });

  it('候选应保留风格溯源字段', () => {
    insertArenaCandidate(candidate);
    const rows = listArenaCandidatesByStage('sess-c', 'creative_plan');
    for (const r of rows) {
      expect(r.system_agent_id).toBe('sys-01');
      expect(r.system_agent_name).toBe('听花岛');
      expect(r.group_id).toBe('group-sys-01');
    }
  });

  it('角色阶段候选应有parent_candidate_id', () => {
    batchInsertArenaCandidates([
      { ...candidate, id: 'cand-003', stage: 'character', parent_candidate_id: 'cand-001' },
    ]);
    const rows = listArenaCandidatesByStage('sess-c', 'character');
    expect(rows[0].parent_candidate_id).toBe('cand-001');
  });
});

// ============================================================
// 评审记录持久化
// ============================================================

describe('ArenaReview 持久化', () => {
  it('insertArenaReview 应成功插入', () => {
    const review: ArenaReviewRow = {
      id: 'review-001', session_id: 'sess-rv', candidate_id: 'cand-001',
      reviewer_id: 'rev-plot-0', direction_id: 'plot_structure',
      stage: 'creative_plan', score: 7.5, comments: '结构清晰', created_at: now,
    };
    expect(() => insertArenaReview(review)).not.toThrow();
  });

  it('batchInsertArenaReviews 应成功批量插入', () => {
    const batch: ArenaReviewRow[] = [
      {
        id: 'review-002', session_id: 'sess-rv', candidate_id: 'cand-001',
        reviewer_id: 'rev-char-0', direction_id: 'characterization',
        stage: 'creative_plan', score: 6.0, comments: '角色一般', created_at: now,
      },
      {
        id: 'review-003', session_id: 'sess-rv', candidate_id: 'cand-001',
        reviewer_id: 'rev-plot-1', direction_id: 'plot_structure',
        stage: 'creative_plan', score: 8.0, comments: '很好', created_at: now,
      },
    ];
    expect(() => batchInsertArenaReviews(batch)).not.toThrow();
  });

  it('listArenaReviewsByCandidate 应返回该候选的所有评审', () => {
    insertArenaReview({
      id: 'review-001', session_id: 'sess-rv', candidate_id: 'cand-001',
      reviewer_id: 'rev-plot-0', direction_id: 'plot_structure',
      stage: 'creative_plan', score: 7.5, comments: '结构清晰', created_at: now,
    });
    batchInsertArenaReviews([
      {
        id: 'review-002', session_id: 'sess-rv', candidate_id: 'cand-001',
        reviewer_id: 'rev-char-0', direction_id: 'characterization',
        stage: 'creative_plan', score: 6.0, comments: '角色一般', created_at: now,
      },
      {
        id: 'review-003', session_id: 'sess-rv', candidate_id: 'cand-001',
        reviewer_id: 'rev-plot-1', direction_id: 'plot_structure',
        stage: 'creative_plan', score: 8.0, comments: '很好', created_at: now,
      },
    ]);
    const rows = listArenaReviewsByCandidate('cand-001');
    expect(rows.length).toBe(3);
  });
});

// ============================================================
// 综合评分持久化
// ============================================================

describe('ArenaFunnelScore 持久化', () => {
  it('insertArenaFunnelScore 应成功插入', () => {
    const score: ArenaFunnelScoreRow = {
      id: 'score-001', session_id: 'sess-fs', candidate_id: 'cand-001',
      stage: 'creative_plan',
      direction_scores: JSON.stringify([{ directionId: 'plot_structure', medianScore: 7.5 }]),
      weighted_total: 7.2, rank: 1, selected: 0, created_at: now,
    };
    expect(() => insertArenaFunnelScore(score)).not.toThrow();
  });

  it('batchInsertArenaFunnelScores 应成功批量插入', () => {
    const batch: ArenaFunnelScoreRow[] = [
      {
        id: 'score-002', session_id: 'sess-fs', candidate_id: 'cand-002',
        stage: 'creative_plan', direction_scores: JSON.stringify([]),
        weighted_total: 6.5, rank: 2, selected: 0, created_at: now,
      },
    ];
    expect(() => batchInsertArenaFunnelScores(batch)).not.toThrow();
  });

  it('listArenaFunnelScoresByStage 应按rank排序', () => {
    insertArenaFunnelScore({
      id: 'score-001', session_id: 'sess-fs', candidate_id: 'cand-001',
      stage: 'creative_plan', direction_scores: '[]',
      weighted_total: 7.2, rank: 1, selected: 0, created_at: now,
    });
    batchInsertArenaFunnelScores([{
      id: 'score-002', session_id: 'sess-fs', candidate_id: 'cand-002',
      stage: 'creative_plan', direction_scores: '[]',
      weighted_total: 6.5, rank: 2, selected: 0, created_at: now,
    }]);
    const rows = listArenaFunnelScoresByStage('sess-fs', 'creative_plan');
    expect(rows.length).toBe(2);
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(2);
  });

  it('updateArenaFunnelScoreSelected 应正确设置选中状态（幂等）', () => {
    insertArenaFunnelScore({
      id: 'score-001', session_id: 'sess-fs', candidate_id: 'cand-001',
      stage: 'creative_plan', direction_scores: '[]',
      weighted_total: 7.2, rank: 1, selected: 0, created_at: now,
    });
    insertArenaFunnelScore({
      id: 'score-002', session_id: 'sess-fs', candidate_id: 'cand-002',
      stage: 'creative_plan', direction_scores: '[]',
      weighted_total: 6.5, rank: 2, selected: 0, created_at: now,
    });

    // 选中 cand-001
    updateArenaFunnelScoreSelected('cand-001', 'creative_plan', true);
    let rows = listArenaFunnelScoresByStage('sess-fs', 'creative_plan');
    expect(rows.find(r => r.candidate_id === 'cand-001')!.selected).toBe(1);
    expect(rows.find(r => r.candidate_id === 'cand-002')!.selected).toBe(0);

    // 切换选中到 cand-002（幂等：先取消所有，再选中新的）
    updateArenaFunnelScoreSelected('cand-002', 'creative_plan', true);
    rows = listArenaFunnelScoresByStage('sess-fs', 'creative_plan');
    expect(rows.find(r => r.candidate_id === 'cand-001')!.selected).toBe(0);
    expect(rows.find(r => r.candidate_id === 'cand-002')!.selected).toBe(1);
  });
});

// ============================================================
// 断点续传状态恢复
// ============================================================

describe('断点续传 getArenaResumeState', () => {
  it('init状态应从stage_plan开始', () => {
    createArenaSession({
      id: 'resume-init', project_id: 'proj-r1',
      config: '{}', status: 'init', current_stage: null,
      task_id: 'task-r1', created_at: now, completed_at: null,
    });
    const state = getArenaResumeState('resume-init');
    expect(state).not.toBeNull();
    expect(state!.resumeStage).toBe('stage_plan');
    expect(state!.completedStages).toHaveLength(0);
  });

  it('stage_char状态应从stage_char继续，stage_plan已完成', () => {
    createArenaSession({
      id: 'resume-char', project_id: 'proj-r2',
      config: '{}', status: 'stage_char', current_stage: 'character',
      task_id: 'task-r2', created_at: now, completed_at: null,
    });
    const state = getArenaResumeState('resume-char');
    expect(state).not.toBeNull();
    expect(state!.resumeStage).toBe('stage_char');
    expect(state!.completedStages).toEqual(['stage_plan']);
  });

  it('stage_ep状态应从stage_ep继续，前3个阶段已完成', () => {
    createArenaSession({
      id: 'resume-ep', project_id: 'proj-r3',
      config: '{}', status: 'stage_ep', current_stage: 'episode',
      task_id: 'task-r3', created_at: now, completed_at: null,
    });
    const state = getArenaResumeState('resume-ep');
    expect(state).not.toBeNull();
    expect(state!.resumeStage).toBe('stage_ep');
    expect(state!.completedStages).toEqual(['stage_plan', 'stage_char', 'stage_dir']);
  });

  it('completed状态应返回null', () => {
    createArenaSession({
      id: 'resume-done', project_id: 'proj-r4',
      config: '{}', status: 'completed', current_stage: null,
      task_id: 'task-r4', created_at: now, completed_at: now,
    });
    expect(getArenaResumeState('resume-done')).toBeNull();
  });

  it('stopped状态应根据current_stage推算已完成阶段', () => {
    createArenaSession({
      id: 'resume-stopped', project_id: 'proj-r5',
      config: '{}', status: 'stopped', current_stage: 'stage_dir',
      task_id: 'task-r5', created_at: now, completed_at: null,
    });
    const state = getArenaResumeState('resume-stopped');
    expect(state).not.toBeNull();
    expect(state!.resumeStage).toBe('stage_dir');
    expect(state!.completedStages).toEqual(['stage_plan', 'stage_char']);
  });

  it('不存在的session应返回null', () => {
    expect(getArenaResumeState('nonexistent')).toBeNull();
  });

  it('恢复状态应包含已持久化的writers和reviewers', () => {
    createArenaSession({
      id: 'resume-agents', project_id: 'proj-r6',
      config: '{}', status: 'init', current_stage: null,
      task_id: 'task-r6', created_at: now, completed_at: null,
    });
    batchInsertArenaWriters([{
      id: 'w-resume-1', session_id: 'resume-agents', group_id: 'g1',
      name: 'test', is_leader: 1, system_agent_id: 'sys-01',
      system_agent_name: '听花岛', base_style_id: 'sys-01',
      style_gene: '{}', system_prompt: 'p', created_at: now,
    }]);
    batchInsertArenaReviewers([{
      id: 'r-resume-1', session_id: 'resume-agents', direction_id: 'plot_structure',
      direction_name: '剧情结构专家', system_prompt: 'p', weight: 0.15, created_at: now,
    }]);

    const state = getArenaResumeState('resume-agents');
    expect(state!.writers.length).toBe(1);
    expect(state!.reviewers.length).toBe(1);
  });
});

// ============================================================
// 辅助查询函数
// ============================================================

describe('辅助查询函数', () => {
  it('getCompletedStageCandidates 应返回指定阶段的候选', () => {
    insertArenaCandidate({
      id: 'aux-cand-1', session_id: 'sess-aux', stage: 'creative_plan',
      writer_id: 'w1', group_id: 'g1', system_agent_id: 'sys-01',
      system_agent_name: '听花岛', parent_candidate_id: null,
      content: '{}', character_pool_ids: null, created_at: now,
    });
    const cands = getCompletedStageCandidates('sess-aux', 'creative_plan');
    expect(cands.length).toBe(1);
  });

  it('getCompletedStageScores 应返回指定阶段的评分', () => {
    insertArenaFunnelScore({
      id: 'aux-score-1', session_id: 'sess-aux', candidate_id: 'aux-cand-1',
      stage: 'creative_plan', direction_scores: '[]',
      weighted_total: 7.0, rank: 1, selected: 0, created_at: now,
    });
    const scores = getCompletedStageScores('sess-aux', 'creative_plan');
    expect(scores.length).toBe(1);
  });
});
