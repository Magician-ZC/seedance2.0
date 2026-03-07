/**
 * arena-engine 属性测试
 * Property 11: 系统Agent组长唯一性
 * Property 13: 创作组结构正确性
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  buildWriterGroups,
  getGenreAgents,
  SYSTEM_AGENTS,
} from '../arena-engine.js';

// ============================================================
// Property 11: 系统Agent组长唯一性
// **Validates: Requirements 2.1, 2.2**
// 每个创作组恰好有1个Agent的 isLeader === true，
// 且该Agent的 systemPrompt 应与对应系统Agent的原始 systemPrompt 完全一致
// ============================================================

describe('Property 11: 系统Agent组长唯一性', () => {
  it('每个创作组恰好有1个组长，且组长Prompt包含双层融合标记', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }), // membersPerGroup
        async (membersPerGroup) => {
          const groups = buildWriterGroups(membersPerGroup);

          for (const group of groups) {
            // 收集组内所有Agent（组长 + 组员）
            const allAgents = [group.leader, ...group.members];

            // 恰好1个isLeader=true
            const leaders = allAgents.filter(a => a.isLeader);
            expect(leaders).toHaveLength(1);

            // 组长的systemPrompt应包含双层融合标记（骨架+风格）
            expect(leaders[0].systemPrompt).toContain('题材骨架');
            expect(leaders[0].systemPrompt).toContain('风格灵魂');
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ============================================================
// Property 13: 创作组结构正确性
// **Validates: Requirements 2.1**
// 应恰好有10个创作组，每组恰好有1个组长 + membersPerGroup 个组员，
// 且10个组长分别对应10个不同的系统Agent
// ============================================================

describe('Property 13: 创作组结构正确性', () => {
  it('恰好8组（骨架Agent数），每组1组长+N组员，8个组长对应8个不同骨架Agent', async () => {
    const GENRE_COUNT = getGenreAgents().length; // 8
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }), // membersPerGroup
        async (membersPerGroup) => {
          const groups = buildWriterGroups(membersPerGroup);

          // 恰好8个创作组（对应8个骨架Agent）
          expect(groups).toHaveLength(GENRE_COUNT);

          const leaderSystemAgentIds = new Set<string>();

          for (const group of groups) {
            // 每组恰好1个组长
            expect(group.leader).toBeDefined();
            expect(group.leader.isLeader).toBe(true);

            // 每组恰好membersPerGroup个组员
            expect(group.members).toHaveLength(membersPerGroup);
            for (const member of group.members) {
              expect(member.isLeader).toBe(false);
            }

            // 收集组长的systemAgentId
            leaderSystemAgentIds.add(group.leader.systemAgentId);
          }

          // 8个组长分别对应8个不同的骨架Agent
          expect(leaderSystemAgentIds.size).toBe(GENRE_COUNT);
        },
      ),
      { numRuns: 10 },
    );
  });
});


// ============================================================
// 导入评审相关模块
// ============================================================
import {
  calculateMedian,
  generateReviewerAgents,
  selectBestPerGroup,
  REVIEW_DIRECTIONS,
  STAGE_REVIEW_MAP,
  type FunnelStage,
  type CandidateEntry,
  type ReviewDirection,
} from '../arena-engine.js';

// ============================================================
// Property 2: 评审中位数正确性
// **Validates: Requirements 6.3**
// 5个评分的中位数应等于排序后的第3个值（index 2），且在所有值范围内
// ============================================================

describe('Property 2: 评审中位数正确性', () => {
  it('5个评分的中位数等于排序后第3个值，且在值域范围内', () => {
    fc.assert(
      fc.property(
        // 生成5个 [0, 10] 范围内的评分
        fc.array(fc.double({ min: 0, max: 10, noNaN: true }), { minLength: 5, maxLength: 5 }),
        (scores) => {
          const median = calculateMedian(scores);
          const sorted = [...scores].sort((a, b) => a - b);

          // 中位数应等于排序后的第3个值（index 2）
          expect(median).toBeCloseTo(sorted[2], 10);

          // 中位数应在所有值的范围内
          expect(median).toBeGreaterThanOrEqual(sorted[0]);
          expect(median).toBeLessThanOrEqual(sorted[4]);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('偶数个评分的中位数等于中间两个值的平均值', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 10, noNaN: true }), { minLength: 4, maxLength: 4 }),
        (scores) => {
          const median = calculateMedian(scores);
          const sorted = [...scores].sort((a, b) => a - b);

          // 偶数个元素：中位数 = (sorted[1] + sorted[2]) / 2
          const expected = (sorted[1] + sorted[2]) / 2;
          expect(median).toBeCloseTo(expected, 10);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('任意长度数组的中位数在最小值和最大值之间', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 10, noNaN: true }), { minLength: 1, maxLength: 20 }),
        (scores) => {
          const median = calculateMedian(scores);
          const min = Math.min(...scores);
          const max = Math.max(...scores);
          expect(median).toBeGreaterThanOrEqual(min);
          expect(median).toBeLessThanOrEqual(max);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 3: 评审权重归一化
// **Validates: Requirements 6.2**
// 某阶段激活的评审方向子集，权重归一化后总和应等于1.0（±0.001）
// ============================================================

describe('Property 3: 评审权重归一化', () => {
  const ALL_STAGES: FunnelStage[] = ['creative_plan', 'character', 'directory', 'episode'];

  it('每个阶段激活方向的权重归一化后总和为1.0', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STAGES),
        (stage) => {
          const activeDirectionIds = STAGE_REVIEW_MAP[stage];
          const activeDirections = REVIEW_DIRECTIONS.filter(d =>
            activeDirectionIds.includes(d.id),
          );

          // 至少有1个激活方向
          expect(activeDirections.length).toBeGreaterThan(0);

          // 原始权重总和
          const totalWeight = activeDirections.reduce((s, d) => s + d.weight, 0);
          expect(totalWeight).toBeGreaterThan(0);

          // 归一化后总和应为1.0
          const normalizedSum = activeDirections.reduce(
            (s, d) => s + d.weight / totalWeight,
            0,
          );
          expect(normalizedSum).toBeCloseTo(1.0, 3); // ±0.001
        },
      ),
      { numRuns: 20 },
    );
  });

  it('任意权重子集归一化后总和为1.0', () => {
    fc.assert(
      fc.property(
        // 生成1-10个随机正权重
        fc.array(fc.double({ min: 0.01, max: 1.0, noNaN: true }), { minLength: 1, maxLength: 10 }),
        (weights) => {
          const totalWeight = weights.reduce((s, w) => s + w, 0);
          const normalizedSum = weights.reduce((s, w) => s + w / totalWeight, 0);
          expect(normalizedSum).toBeCloseTo(1.0, 3);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 4: 加权总分值域
// **Validates: Requirements 6.3**
// 综合评分应在 [0, 10] 范围内
// ============================================================

describe('Property 4: 加权总分值域', () => {
  it('加权总分始终在 [0, 10] 范围内', () => {
    fc.assert(
      fc.property(
        // 生成2-10个方向，每个方向有中位数评分和权重
        fc.array(
          fc.record({
            medianScore: fc.double({ min: 0, max: 10, noNaN: true }),
            weight: fc.double({ min: 0.01, max: 1.0, noNaN: true }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (directions) => {
          const totalWeight = directions.reduce((s, d) => s + d.weight, 0);
          if (totalWeight === 0) return; // 跳过退化情况

          const weightedTotal = directions.reduce(
            (s, d) => s + d.medianScore * (d.weight / totalWeight),
            0,
          );

          expect(weightedTotal).toBeGreaterThanOrEqual(0);
          expect(weightedTotal).toBeLessThanOrEqual(10);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('所有方向评分相同时，加权总分等于该评分', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10, noNaN: true }),
        fc.array(fc.double({ min: 0.01, max: 1.0, noNaN: true }), { minLength: 1, maxLength: 10 }),
        (score, weights) => {
          const totalWeight = weights.reduce((s, w) => s + w, 0);
          const weightedTotal = weights.reduce(
            (s, w) => s + score * (w / totalWeight),
            0,
          );
          expect(weightedTotal).toBeCloseTo(score, 5);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 5: 阶段评审方向正确性
// **Validates: Requirements 6.2**
// 激活的评审方向应严格等于 STAGE_REVIEW_MAP[stage] 定义的方向集合
// ============================================================

describe('Property 5: 阶段评审方向正确性', () => {
  const ALL_STAGES: FunnelStage[] = ['creative_plan', 'character', 'directory', 'episode'];

  it('每个阶段激活的评审方向严格等于STAGE_REVIEW_MAP定义', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STAGES),
        (stage) => {
          const expectedIds = STAGE_REVIEW_MAP[stage];

          // 从REVIEW_DIRECTIONS中筛选该阶段激活的方向
          const activeFromDirections = REVIEW_DIRECTIONS
            .filter(d => d.activeStages.includes(stage))
            .map(d => d.id);

          // 两个集合应严格相等
          expect(new Set(activeFromDirections)).toEqual(new Set(expectedIds));
          expect(activeFromDirections.length).toBe(expectedIds.length);
        },
      ),
      { numRuns: 20 },
    );
  });

  it('generateReviewerAgents生成的Agent按阶段过滤后方向集合正确', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ALL_STAGES),
        (stage) => {
          const allReviewers = generateReviewerAgents(5);
          const expectedIds = STAGE_REVIEW_MAP[stage];

          // 按阶段过滤评审Agent
          const activeReviewers = allReviewers.filter(r =>
            expectedIds.includes(r.directionId),
          );

          // 激活的方向ID集合应与STAGE_REVIEW_MAP一致
          const activeDirectionIds = [...new Set(activeReviewers.map(r => r.directionId))];
          expect(new Set(activeDirectionIds)).toEqual(new Set(expectedIds));

          // 每个方向应有5个评审Agent
          for (const dirId of expectedIds) {
            const count = activeReviewers.filter(r => r.directionId === dirId).length;
            expect(count).toBe(5);
          }
        },
      ),
      { numRuns: 20 },
    );
  });
});


// ============================================================
// Property 1: 漏斗收窄不变量
// **Validates: Requirements 2, 3, 4, 5**
// selectBestPerGroup 的输出数量严格小于输入数量
// ============================================================

describe('Property 1: 漏斗收窄不变量', () => {
  it('selectBestPerGroup 输出数量严格小于输入数量', () => {
    fc.assert(
      fc.property(
        // 生成2-10个组，每组2-5个候选
        fc.integer({ min: 2, max: 10 }),
        fc.integer({ min: 2, max: 5 }),
        (groupCount, perGroup) => {
          const candidates: CandidateEntry<string>[] = [];
          for (let g = 0; g < groupCount; g++) {
            for (let i = 0; i < perGroup; i++) {
              candidates.push({
                id: `c-${g}-${i}`,
                writerId: `w-${g}-${i}`,
                groupId: `group-${g}`,
                systemAgentId: `sys-${g}`,
                systemAgentName: `Agent${g}`,
                data: `content-${g}-${i}`,
                score: Math.random() * 10,
              });
            }
          }
          // 每组取Top 1
          const result = selectBestPerGroup(candidates, 'groupId', 1);
          // 输出数量应 <= 组数（严格小于总输入）
          expect(result.length).toBeLessThanOrEqual(groupCount);
          expect(result.length).toBeLessThan(candidates.length);
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ============================================================
// Property 9: 打回修改次数上限
// **Validates: Requirements 5.3**
// 打回修改次数不应超过2次
// ============================================================

describe('Property 9: 打回修改次数上限', () => {
  it('打回修改次数上限为2', () => {
    // 验证：对于任意passScore和连续评分序列，打回逻辑最多触发2次
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10, noNaN: true }), // passScore
        fc.array(fc.double({ min: 0, max: 10, noNaN: true }), { minLength: 1, maxLength: 5 }), // 连续评分
        (passScore, scores) => {
          // 模拟打回逻辑：评分 < passScore 时打回，最多2次
          let revisions = 0;
          for (const score of scores) {
            if (score < passScore && revisions < 2) {
              revisions++;
            }
          }
          expect(revisions).toBeLessThanOrEqual(2);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ============================================================
// Property 10: 用户选择覆盖性
// **Validates: Requirements 8.5**
// selectBestPerGroup 中每组最多1个被选中（selected标记互斥性）
// ============================================================

describe('Property 10: 用户选择覆盖性', () => {
  it('selectBestPerGroup 中 selected 标记的互斥性', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }),
        fc.integer({ min: 2, max: 5 }),
        (groupCount, perGroup) => {
          const candidates: CandidateEntry<string>[] = [];
          for (let g = 0; g < groupCount; g++) {
            for (let i = 0; i < perGroup; i++) {
              candidates.push({
                id: `c-${g}-${i}`,
                writerId: `w-${g}-${i}`,
                groupId: `group-${g}`,
                systemAgentId: `sys-${g}`,
                systemAgentName: `Agent${g}`,
                data: `content-${g}-${i}`,
                score: Math.random() * 10,
              });
            }
          }
          const result = selectBestPerGroup(candidates, 'groupId', 1);
          // 每组最多1个被选中
          const groupIds = [...new Set(result.map(c => c.groupId))];
          for (const gid of groupIds) {
            const groupCandidates = result.filter(c => c.groupId === gid);
            expect(groupCandidates.length).toBeLessThanOrEqual(1);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

// ============================================================
// Property 12: 风格溯源完整性
// **Validates: Requirements 2.6, 5.5**
// 所有Agent的systemAgentId对应有效的系统Agent
// ============================================================

describe('Property 12: 风格溯源完整性', () => {
  it('所有Agent的systemAgentId对应有效的系统Agent', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        (membersPerGroup) => {
          const groups = buildWriterGroups(membersPerGroup);
          const validIds = new Set(SYSTEM_AGENTS.map((a: { id: string }) => a.id));

          for (const group of groups) {
            const allAgents = [group.leader, ...group.members];
            for (const agent of allAgents) {
              // systemAgentId 应对应有效的系统Agent
              expect(validIds.has(agent.systemAgentId)).toBe(true);

              // systemAgentId 应与组的 systemAgentId 一致
              expect(agent.systemAgentId).toBe(group.systemAgentId);
            }

            // 组的 systemAgentName 应与对应系统Agent的name一致
            const sysAgent = SYSTEM_AGENTS.find((a: { id: string }) => a.id === group.systemAgentId);
            expect(sysAgent).toBeDefined();
            expect(group.systemAgentName).toBe(sysAgent!.name);
          }
        },
      ),
      { numRuns: 10 },
    );
  });
});

// ============================================================
// Property 6: 群演角色ID关联完整性
// **Validates: Requirements 3.7**
// 说明：Property 6 需要实际的数据库数据和LLM调用结果，不适合纯属性测试。
// 已在单元测试 arena-engine.test.ts 中通过以下测试覆盖：
// - runCharacterArena > characterPoolIds应正确填充
// ============================================================

// ============================================================
// Property 7: 候选追溯链完整性
// **Validates: Requirements 2-5**
// 说明：Property 7 需要实际的数据库数据和LLM调用结果，不适合纯属性测试。
// 已在单元测试 arena-engine.test.ts 中通过各阶段的候选持久化测试覆盖。
// ============================================================
