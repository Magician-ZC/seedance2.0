# 任务清单：百Agent竞技创作模式（系统Agent组长 + 漏斗式阶段竞争）

## 任务 1: 并发队列调度器
- [x] 创建 `server/src/queue-scheduler.ts`
- [x] 实现 `QueueScheduler` 类：enqueue、enqueueBatch、stop
- [x] 支持指数退避重试（默认3次）
- [x] 支持任务超时（默认120s）
- [x] 编写单元测试 `server/src/__tests__/queue-scheduler.test.ts`

## 任务 2: 系统Agent组长 + 变体组员生成
- [x] 在 `server/src/arena-engine.ts` 中导入 `SYSTEM_AGENTS`（来自 `system-agents-data.ts`）
- [x] 实现 `extractStyleGene`：从系统Agent的systemPrompt中提取5个基因维度（叙事结构、角色塑造、对白风格、情绪节奏、钩子设计）
- [x] 实现 `extractSection`：正则提取【xxx】段落内容
- [x] 实现 `mutateStyleGene`：随机选1-2个维度，用其他系统Agent的对应基因替换或融合
- [x] 实现 `compileWriterPrompt`：将StyleGene编译为完整创作Prompt
- [x] 实现 `buildWriterGroups`：10个系统Agent各自担任组长，每组派生4个变体组员（共10组×5人=50人）
  - 组长：`isLeader=true`，`systemPrompt`=系统Agent原始完整Prompt
  - 组员：`isLeader=false`，`systemPrompt`=变异后编译的Prompt
- [x] 编写单元测试：验证10组结构、组长Prompt一致性、变异后基因与父代不完全相同
- [x] 编写属性测试：Property 11（组长唯一性）、Property 13（创作组结构正确性）

## 任务 3: 评审Agent专业体系
- [x] 在 `arena-engine.ts` 中定义 `REVIEW_DIRECTIONS` 常量（10个方向的专业Prompt）
- [x] 定义 `STAGE_REVIEW_MAP`（各阶段激活的评审方向）
- [x] 实现 `generateReviewerAgents`（每方向5人=50人）
- [x] 实现 `reviewCandidate` 通用评审函数（多方向×5人，取中位数，加权汇总）
- [x] 实现 `executeSingleReview`（单个评审Agent执行评审，返回评分+点评）
- [x] 实现 `calculateMedian` 中位数计算
- [x] 实现 `selectBestPerGroup` 通用筛选函数（按分组取Top N）
- [x] 编写属性测试：Property 2（中位数）、Property 3（权重归一化）、Property 4（加权总分值域）、Property 5（阶段方向正确性）

## 任务 4: 数据库表与持久化
- [x] 在 `db-service.ts` 中创建 `arena_sessions` 表
- [x] 创建 `arena_writers` 表（含 `group_id`、`is_leader`、`system_agent_id`、`system_agent_name` 字段）
- [x] 创建 `arena_reviewers` 表
- [x] 创建 `arena_candidates` 表（含 `group_id`、`system_agent_id`、`system_agent_name` 字段用于风格溯源）
- [x] 创建 `arena_reviews` 表
- [x] 创建 `arena_scores` 表
- [x] 实现竞技会话CRUD（createArenaSession、getArenaSession、updateArenaSession）
- [x] 实现创作Agent和评审Agent的批量持久化
- [x] 实现候选产出和评审记录的持久化
- [x] 实现断点续传的状态恢复逻辑（从最后完成的阶段继续）

## 任务 5: 竞技引擎主编排
- [x] 实现 `startArenaCreation` 主流程：
  1. 调用 `buildWriterGroups()` 组建10个系统Agent创作组
  2. 调用 `generateReviewerAgents()` 生成50个评审Agent
  3. 串联4个阶段（创意方案→角色→目录→剧本）
  4. 每个阶段完成后持久化中间状态
- [x] 实现 `stopArenaCreation` 优雅停止（调用 QueueScheduler.stop()）
- [x] 实现 `selectCandidate` 用户选择（幂等操作）
- [x] 实现 `getArenaStatus` 和 `getArenaCandidates` 查询
- [x] 实现WebSocket进度推送（复用wsManager，包含系统Agent组信息）

## 任务 6: 阶段1 — 创意方案竞争（10组×5人→组内互审→10→跨组评审→10）
- [x] 实现 `runCreativePlanArena`：
  1. 10个创作组各5人（组长+4组员）并发生成创意方案（共50个）
  2. 组长使用原始systemPrompt，组员使用变异后Prompt
  3. 复用 `generateCreativePlan` 的核心LLM逻辑（提取system/user prompt构建）
- [x] 实现组内互审机制：
  1. 组长审查4个组员方案（组长视角：是否符合本组风格）
  2. 组员之间环形互审（组员1审组员2，组员2审组员3...）
  3. 组长方案不被组员审查
  4. 互审后组员可修改1轮，组长方案不修改
  5. 每组选出最佳1个方案（组长和组员平等竞争评分）→ 10个方案
- [x] 接入跨组评审（剧情结构+商业潜力+创意新颖度，15人）
- [x] 实现Top 10排名，每个方案标注系统Agent风格来源
- [x] 候选产出的 `CandidateEntry` 填充 `groupId`、`systemAgentId`、`systemAgentName`

## 任务 7: 阶段2 — 角色开发竞争（群演仓库集成，10×3→10）
- [x] 实现 `runCharacterArena`：
  1. 从群演仓库匹配角色素材（复用 `listCharacterAgents` + LLM智能匹配）
  2. 为10个方案各分配3个Agent：该方案所属系统Agent组长（必选）+ 2个组内变体Agent
  3. 组长使用原始systemPrompt中的【角色塑造方法】作为核心指导
- [x] 实现 `buildCharacterDesignPromptWithPool`（含群演素材的角色设计Prompt，注入组长风格特色）
- [x] 实现 `buildCharacterDesignPromptDefault`（纯LLM生成角色Prompt）
- [x] 实现 `generateCharacterDesign`（单Agent角色设计，支持群演/纯生成两种模式）
- [x] 接入评审（人物塑造+情感共鸣，10人）
- [x] 实现每方案保留最佳角色设计（共10套）
- [x] 保留群演角色ID关联（characterPoolIds）
- [x] 群演仓库为空时回退到纯LLM生成

## 任务 8: 阶段3 — 分集目录竞争（10×2→5）
- [x] 实现 `runDirectoryArena`：
  1. 为10套"方案+角色"组合各分配2个Agent：系统Agent组长（必选）+ 1个组内变体Agent
  2. 组长使用原始systemPrompt中的【叙事结构偏好】和【钩子设计】作为核心指导
  3. 复用 `generateDirectory` 的核心LLM逻辑
- [x] 接入评审（节奏+商业+结构，15人）
- [x] 实现Top 5筛选，标注系统Agent风格来源

## 任务 9: 阶段4 — 分集剧本全量+逐集评审（5→3）
- [x] 实现 `runEpisodeArena`：
  1. Top 5各由其所属系统Agent组长作为主创作Agent全量生成分集剧本
  2. 组长的完整systemPrompt（含【对白风格】【情绪节奏】等）注入每集生成Prompt
  3. 复用 `generateEpisodeBatch` 的核心逻辑
- [x] 实现逐集评审（全10方向，50人）
- [x] 实现打回修改机制：
  1. 评分 < passScore 时打回，附带评审意见
  2. 组长根据自身风格特色和评审意见修改
  3. 最多打回2次
- [x] 实现Top 3筛选，标注系统Agent风格来源（如"听花岛风格出品"）

## 任务 10: 路由集成
- [x] 在 `index.ts` 的 `POST /api/screenplay/create` 中增加竞技模式分支
- [x] 新增 `POST /api/screenplay/:id/arena/select` 用户选择候选
- [x] 新增 `GET /api/screenplay/:id/arena/status` 竞技状态查询
- [x] 新增 `GET /api/screenplay/:id/arena/candidates/:stage` 候选列表查询（含系统Agent风格来源信息）

## 任务 11: ScreenplayConfig 扩展
- [x] 在 `server/src/screenplay-creator.ts` 的 `ScreenplayConfig` 接口中新增 `arenaMode?: boolean` 和 `arenaConfig?: ArenaConfig`
- [x] 在前端 `ScreenplayCreator.tsx` 的配置状态中同步新增字段

## 任务 12: 前端配置面板增强
- [x] 在 `ScreenplayCreator.tsx` 配置步骤中新增"竞技模式"开关（位于"群演仓库"和"跨时代时间线"开关附近）
- [x] 实现竞技参数配置区域：评审严格度（标准/严格/极致）、并发数
- [x] 展示"10大编剧风格将各自带队竞争"的说明文案
- [x] 在 `handleCreate` 中携带 arenaMode 和 arenaConfig

## 任务 13: 前端竞技结果展示
- [x] 创作方案步骤：竞技模式时展示Top 10方案卡片（含评分、排名、系统Agent风格标签、评审点评）
- [x] 角色开发步骤：展示最佳角色+群演来源标注+"查看其他候选"抽屉
- [x] 分集目录步骤：展示Top 5目录对比视图（钩子密度、付费卡点分布），标注系统Agent风格来源
- [x] 分集撰写步骤：展示Top 3剧本选择+10维度雷达图对比，标注"听花岛风格出品"等风格来源
- [x] 实现"选择此方案"交互，调用 `/arena/select` API
- [x] 竞技进度通过现有 `useTaskProgress` hook + WebSocket 实时展示

## 任务 14: 集成测试
- [x] 编写竞技引擎核心逻辑单元测试（`arena-engine.test.ts`）
- [x] 编写属性测试（`arena-engine.property.test.ts`）：覆盖 Property 1-13
- [x] 编写并发调度器测试（`queue-scheduler.test.ts`）
- [x] 小规模端到端验证（2组×3人=6创作 + 10评审，验证漏斗流程和风格溯源）
