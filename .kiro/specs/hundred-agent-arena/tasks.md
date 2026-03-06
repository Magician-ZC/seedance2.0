# 任务清单：百Agent竞技创作模式

## 任务 1: 并发队列调度器
- [ ] 创建 `server/src/queue-scheduler.ts`
- [ ] 实现 `QueueScheduler` 类：enqueue、enqueueBatch、stop
- [ ] 支持指数退避重试（默认3次）
- [ ] 支持任务超时（默认120s）
- [ ] 编写单元测试 `queue-scheduler.test.ts`

## 任务 2: 创作Agent风格变异生成
- [ ] 在 `server/src/arena-engine.ts` 中实现 `extractStyleGene`（从系统Agent的systemPrompt提取5个基因维度）
- [ ] 实现 `mutateStyleGene`（替换/增强/融合变异）
- [ ] 实现 `compileWriterPrompt`（将StyleGene编译为完整创作Prompt）
- [ ] 实现 `generateWriterAgents`（10个系统Agent各派生5个变体=50个）
- [ ] 编写属性测试：变异后基因与父代不完全相同

## 任务 3: 评审Agent专业体系
- [ ] 在 `arena-engine.ts` 中定义 `REVIEW_DIRECTIONS` 常量（10个方向的专业Prompt）
- [ ] 定义 `STAGE_REVIEW_MAP`（各阶段激活的评审方向）
- [ ] 实现 `generateReviewerAgents`（每方向5人=50人）
- [ ] 实现 `reviewCandidate` 通用评审函数（多方向×5人，取中位数，加权汇总）
- [ ] 实现 `calculateMedian` 中位数计算
- [ ] 编写属性测试：中位数正确性、权重归一化、加权总分值域

## 任务 4: 数据库表与持久化
- [ ] 在 `db-service.ts` 中创建 `arena_sessions`、`arena_writers`、`arena_reviewers`、`arena_candidates`、`arena_reviews`、`arena_scores` 表
- [ ] 实现竞技会话CRUD
- [ ] 实现候选产出和评审记录的持久化
- [ ] 实现断点续传的状态恢复逻辑

## 任务 5: 竞技引擎主编排
- [ ] 实现 `startArenaCreation` 主流程（串联4个阶段）
- [ ] 实现 `stopArenaCreation` 优雅停止
- [ ] 实现 `selectCandidate` 用户选择
- [ ] 实现 `getArenaStatus` 和 `getArenaCandidates` 查询
- [ ] 实现WebSocket进度推送（复用wsManager）

## 任务 6: 阶段1 — 创意方案竞争
- [ ] 实现 `runCreativePlanArena`：50个Agent并发生成创意方案
- [ ] 复用 `generateCreativePlan` 的核心LLM逻辑（提取system/user prompt构建）
- [ ] 接入评审（剧情结构+商业潜力+创意新颖度，15人）
- [ ] 实现Top 10筛选和排名

## 任务 7: 阶段2 — 角色开发竞争（群演仓库集成）
- [ ] 实现 `runCharacterArena`：群演匹配 + 10×3 Agent竞争
- [ ] 复用 `listCharacterAgents` 和群演匹配逻辑
- [ ] 实现 `buildCharacterDesignPromptWithPool`（含群演素材的角色设计Prompt）
- [ ] 实现 `generateCharacterDesign`（单Agent角色设计，支持群演/纯生成两种模式）
- [ ] 接入评审（人物塑造+情感共鸣，10人）
- [ ] 实现每方案保留最佳角色设计
- [ ] 保留群演角色ID关联（characterPoolIds）

## 任务 8: 阶段3 — 分集目录竞争
- [ ] 实现 `runDirectoryArena`：10×2 Agent竞争
- [ ] 复用 `generateDirectory` 的核心LLM逻辑
- [ ] 接入评审（节奏+商业+结构，15人）
- [ ] 实现Top 5筛选

## 任务 9: 阶段4 — 分集剧本全量+逐集评审
- [ ] 实现 `runEpisodeArena`：Top 5全量生成
- [ ] 复用 `generateEpisodeBatch` 的核心逻辑
- [ ] 实现逐集评审（全10方向，50人）
- [ ] 实现打回修改机制（评分<passScore时打回，最多2次）
- [ ] 实现Top 3筛选

## 任务 10: 路由集成
- [ ] 在 `index.ts` 的 `POST /api/screenplay/create` 中增加竞技模式分支
- [ ] 新增 `POST /api/screenplay/:id/arena/select` 用户选择候选
- [ ] 新增 `GET /api/screenplay/:id/arena/status` 竞技状态查询
- [ ] 新增 `GET /api/screenplay/:id/arena/candidates/:stage` 候选列表查询

## 任务 11: 前端配置面板增强
- [ ] 在 `ScreenplayCreator.tsx` 配置步骤中新增"竞技模式"开关
- [ ] 实现竞技参数配置区域（Agent数量、评审严格度）
- [ ] 在 `handleCreate` 中携带 arenaMode 和 arenaConfig

## 任务 12: 前端竞技结果展示
- [ ] 创作方案步骤：竞技模式时展示Top 10方案卡片（含评分、排名）
- [ ] 角色开发步骤：展示最佳角色+群演来源标注+"查看其他候选"
- [ ] 分集目录步骤：展示Top 5目录对比视图
- [ ] 分集撰写步骤：展示Top 3剧本选择+10维度雷达图对比
- [ ] 实现"选择此方案"交互，调用 `/arena/select` API

## 任务 13: 集成测试
- [ ] 编写竞技引擎核心逻辑单元测试
- [ ] 编写属性测试（所有Property）
- [ ] 小规模端到端验证（5创作+10评审，验证漏斗流程）
