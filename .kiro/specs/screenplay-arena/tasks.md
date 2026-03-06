# 实施计划：剧本角斗场（Screenplay Arena）

## 概述

按照"基础设施 → 后端服务 → 前端组件 → 集成联调"的顺序实施。后端以 `arena-service.ts` 为核心，前端以 `ArenaPanel.tsx` 为入口，通过 REST API 和 WebSocket 连接。所有属性测试使用 fast-check，单元测试使用 Vitest。

## 任务

- [x] 1. 数据库表结构与 TypeScript 类型定义
  - [x] 1.1 在 `db-service.ts` 中新增 5 张 arena 表的 CREATE TABLE 语句（arena_elo, arena_scores, arena_battles, arena_tournaments, arena_evolutions），在数据库初始化时执行
    - 参照设计文档中的数据模型定义
    - _Requirements: 2.11, 3.6, 4.8, 5.1_
  - [x] 1.2 创建 `server/src/arena-types.ts`，定义所有 TypeScript 类型接口（DimensionScores, ReviewRole, RoleScoreResult, ArenaScoreResult, BattleResult, DimensionBattleResult, TournamentResult, TournamentRound, TournamentMatch, LeaderboardEntry, EvolutionPlan, EvolutionElement, EvolutionRecord, ScreenplayArenaHistory, ArenaScreenplayInfo）
    - 参照设计文档中的 TypeScript 类型定义
    - _Requirements: 2.8, 3.2, 4.1, 5.3, 6.2_

- [x] 2. 核心业务逻辑 — arena-service.ts（评分与 ELO）
  - [x] 2.1 创建 `server/src/arena-service.ts`，实现 ELO 计算函数（calculateExpectedScore, updateELO）和已完成剧本过滤函数（getArenaScreenplays）
    - ELO 公式：K=32，初始 1200
    - 已完成剧本条件：status === 'exported' 或 episodes.length >= 1
    - _Requirements: 1.3, 5.1, 5.2_
  - [ ]* 2.2 编写属性测试：ELO 计算零和不变量
    - **Property 2: ELO 计算零和不变量**
    - **Validates: Requirements 3.5, 4.7, 5.2**
  - [ ]* 2.3 编写属性测试：ELO 初始值
    - **Property 3: ELO 初始值**
    - **Validates: Requirements 5.1**
  - [ ]* 2.4 编写属性测试：已完成剧本过滤正确性
    - **Property 1: 已完成剧本过滤正确性**
    - **Validates: Requirements 1.3**
  - [x] 2.5 实现评审团 System Prompt 模板（4 个角色：HitScreenwriter, PlatformReviewer, AudienceProxy, AuthorAgent），包含动态参数替换（audience 类型、agentSystemPrompt）
    - 参照设计文档中的完整 prompt 模板
    - _Requirements: 2.3, 2.4, 2.5, 2.6_
  - [ ]* 2.6 编写属性测试：观众代表 Prompt 动态适配
    - **Property 7: 观众代表 Prompt 动态适配**
    - **Validates: Requirements 2.6**
  - [x] 2.7 实现 scoreScreenplay 函数：依次调用各评审角色 LLM 评分，加权汇总，处理角色不可用和 LLM 失败的权重重分配，持久化存储评分结果
    - 权重：爆款编剧 40%、平台审核官 25%、观众代表 25%、作者 Agent 10%
    - 不可用时重分配：50%/30%/20%
    - _Requirements: 2.1, 2.2, 2.3, 2.7, 2.8, 2.9, 2.11, 2.12_
  - [ ]* 2.8 编写属性测试：评审团加权汇总正确性
    - **Property 4: 评审团加权汇总正确性**
    - **Validates: Requirements 2.7, 2.12**
  - [ ]* 2.9 编写属性测试：评分维度值域约束
    - **Property 5: 评分维度值域约束**
    - **Validates: Requirements 2.8**

- [x] 3. 检查点 — 确保评分与 ELO 基础逻辑测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 4. 核心业务逻辑 — arena-service.ts（对战与锦标赛）
  - [x] 4.1 实现 battleScreenplays 函数：调用评审团对两个剧本进行六维度逐项对比，生成 BattleResult，更新 ELO，持久化存储，处理 LLM 失败时不更新 ELO
    - 包含 ELO 差距 > 400 的提示逻辑
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_
  - [ ]* 4.2 编写属性测试：对战结果结构完整性
    - **Property 8: 对战结果结构完整性**
    - **Validates: Requirements 3.2, 3.3**
  - [ ]* 4.3 编写属性测试：ELO 差距提示阈值
    - **Property 9: ELO 差距提示阈值**
    - **Validates: Requirements 3.7**
  - [x] 4.4 实现 startTournament 函数：支持淘汰赛（随机配对、奇数轮空）和循环赛（两两对战），复用 battleScreenplays，通过 wsManager 推送实时进度，持久化赛程和结果
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [ ]* 4.5 编写属性测试：淘汰赛配对覆盖性
    - **Property 10: 淘汰赛配对覆盖性**
    - **Validates: Requirements 4.2**
  - [ ]* 4.6 编写属性测试：循环赛场次完备性
    - **Property 11: 循环赛场次完备性**
    - **Validates: Requirements 4.3**
  - [x] 4.7 实现 getLeaderboard 和 getScreenplayHistory 查询函数
    - 排行榜按 ELO 降序，包含胜率计算
    - 历史记录包含对战和进化谱系
    - _Requirements: 5.3, 5.4, 7.1, 7.2_
  - [ ]* 4.8 编写属性测试：排行榜排序与字段完整性
    - **Property 12: 排行榜排序与字段完整性**
    - **Validates: Requirements 5.3, 5.4**

- [x] 5. 核心业务逻辑 — arena-service.ts（进化机制）
  - [x] 5.1 实现 generateEvolutionPlan 函数：调用 LLM 分析胜方优秀元素，生成 EvolutionPlan（包含 category、description、expectedEffect）
    - _Requirements: 6.1, 6.2, 6.3_
  - [x] 5.2 实现 executeEvolution 函数：基于用户选中的元素调用 LLM 重构败方剧本，创建新版本 ScreenplayProject（generation + 1），记录 arena_evolutions，初始化新剧本 ELO
    - 支持三种进化方式：enhance、expand、style_merge
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
  - [ ]* 5.3 编写属性测试：进化方案元素完整性
    - **Property 13: 进化方案元素完整性**
    - **Validates: Requirements 6.2, 6.3**
  - [ ]* 5.4 编写属性测试：进化版本保留与代数递增
    - **Property 14: 进化版本保留与代数递增**
    - **Validates: Requirements 6.7, 6.6**

- [x] 6. 检查点 — 确保后端核心逻辑全部测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 7. REST API 路由 — arena-routes.ts
  - [x] 7.1 创建 `server/src/arena-routes.ts`，实现所有 8 个 API 端点（GET /screenplays, POST /score, POST /battle, POST /tournament, GET /leaderboard, POST /evolve, GET /history/:screenplayId, POST /evolve/plan），包含输入验证和错误处理
    - 参照设计文档中的路由表
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [x] 7.2 在 `server/src/index.ts` 中挂载 arena 路由：`app.use('/api/arena', arenaRoutes)`
    - _Requirements: 8.1_
  - [ ]* 7.3 编写 API 路由单元测试（arena-routes.test.ts），验证请求/响应格式、输入验证和错误处理
    - _Requirements: 8.1-8.7_

- [x] 8. 检查点 — 确保后端 API 全部可用
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 9. 前端基础 — 侧边栏集成与 ArenaPanel 主面板
  - [x] 9.1 修改 `Sidebar.tsx`：NavTab 类型新增 'arena'，TOP_NAV 数组中插入角斗场导航项（位于 characters 之后、Agent 仓库分组之前），使用剑/盾牌图标
    - _Requirements: 1.1_
  - [x] 9.2 修改 `App.tsx`：activeTab === 'arena' 时渲染 ArenaPanel 组件
    - _Requirements: 1.1_
  - [x] 9.3 修改 `Header.tsx`：getTitle 函数新增 arena case，返回角斗场标题
    - _Requirements: 1.1_
  - [x] 9.4 创建 `src/components/ArenaPanel.tsx`：角斗场主面板，包含剧本卡片列表（含 ELO 积分和雷达图缩略图）、空状态提示、三个功能入口按钮（评分/对战/大乱斗），以及子视图路由切换逻辑
    - _Requirements: 1.2, 1.4, 1.5, 1.6_
  - [x] 9.5 更新 i18n 文件（zh.ts 和 en.ts），添加角斗场相关的所有中英文翻译键值
    - _Requirements: 1.1_

- [x] 10. 前端组件 — 评分与雷达图
  - [x] 10.1 创建 `RadarChart.tsx` 组件：基于 Canvas 或 SVG 绘制六维度雷达图，支持多数据集叠加（各角色独立视图 + 综合视图切换）
    - _Requirements: 2.10_
  - [x] 10.2 创建 `ScoreView.tsx` 组件：评审模式选择界面（单角色/评审团）、评审角色选择、评分进度展示、评分结果展示（雷达图 + 各维度点评），调用 POST /api/arena/score
    - _Requirements: 2.1, 2.2, 2.10_

- [x] 11. 前端组件 — 对战与进化
  - [x] 11.1 创建 `BattleView.tsx` 组件：对战剧本选择界面、ELO 差距提示、逐维度胜负对比面板、最终裁决、败方改进建议、"吸收进化"按钮，调用 POST /api/arena/battle
    - _Requirements: 3.1, 3.4, 3.7_
  - [x] 11.2 创建 `EvolutionView.tsx` 组件：进化方案展示（可勾选元素列表）、进化方式选择（增强/扩展/风格融合）、执行进化，调用 POST /api/arena/evolve/plan 和 POST /api/arena/evolve
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

- [x] 12. 前端组件 — 锦标赛与排行榜
  - [x] 12.1 创建 `TournamentView.tsx` 组件：赛制配置界面（选择参赛剧本、赛制类型）、淘汰赛对阵图/循环赛进度表、WebSocket 实时进度订阅、最终排名展示（冠军 🏆 标识），调用 POST /api/arena/tournament 并订阅 WebSocket
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 8.4, 8.8_
  - [x] 12.2 创建 `LeaderboardView.tsx` 组件：ELO 排行榜列表（排名序号、标题、ELO、胜负场、胜率）、排名变动动画效果，调用 GET /api/arena/leaderboard
    - _Requirements: 5.3, 5.4, 5.5_

- [x] 13. 前端组件 — 历史与谱系
  - [x] 13.1 创建 `HistoryView.tsx` 组件：剧本详情面板（对战历史列表 + 进化谱系时间线）、进化代数标记（Gen.N），调用 GET /api/arena/history/:screenplayId
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 14. 检查点 — 确保前后端集成完整
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 15. 补充属性测试与单元测试
  - [x]* 15.1 编写属性测试：评审团结果结构完整性
    - **Property 6: 评审团结果结构完整性**
    - **Validates: Requirements 2.3, 2.9**
  - [x]* 15.2 编写属性测试：对战历史关联完整性
    - **Property 15: 对战历史关联完整性**
    - **Validates: Requirements 7.1**
  - [x]* 15.3 编写属性测试：评分结果持久化 Round-Trip
    - **Property 16: 评分结果持久化 Round-Trip**
    - **Validates: Requirements 2.11, 3.6, 4.8**
  - [x]* 15.4 编写属性测试：LLM 失败时 ELO 不变性
    - **Property 17: LLM 失败时 ELO 不变性**
    - **Validates: Requirements 3.8**
  - [x]* 15.5 编写单元测试：System Prompt 模板关键词验证
    - 验证各角色 prompt 包含关键评判标准关键词
    - _Requirements: 2.4, 2.5_

- [x] 16. 最终检查点 — 全部测试通过，功能完整
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求条目，确保可追溯性
- 属性测试验证设计文档中定义的 17 个正确性属性
- 检查点任务确保增量验证，避免问题累积
