# 实现计划：Agent经验累积系统

## 概述

基于设计文档，将经验累积系统拆分为增量式的编码任务。每个任务构建在前一个任务之上，确保无孤立代码。核心思路：先建存储层，再建提取/匹配/注入逻辑，最后接入现有系统和API路由。

## 任务

- [x] 1. 经验存储层实现
  - [x] 1.1 在 `server/src/experience-store.ts` 中定义 ExperienceRow、ExperienceFilter、ExperienceStats 等类型接口，并实现 initExperienceTable 函数（在 db-service.ts 的 initDB 中调用）
    - 创建 experiences 表的 SQL DDL
    - 复用 db-service.ts 中的 getDB/saveDB 模式
    - _Requirements: 2.1, 2.2_

  - [x] 1.2 实现 ExperienceStore 的 CRUD 函数：insertExperience、getExperienceById、listExperiences（含筛选）、updateExperience、deleteExperience、incrementReferenceCount
    - listExperiences 支持按 type、genre、audience、minScore 筛选
    - 实现 listExperiencesBySourceProject 用于去重查询
    - 实现 getExperienceStats 统计函数
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [ ]* 1.3 编写 ExperienceStore 的属性测试
    - **Property 2: 经验存储round-trip一致性**
    - **Property 3: 经验筛选结果满足筛选条件**
    - **Property 4: 经验更新正确性**
    - **Property 5: 经验去重幂等性**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.6**

- [x] 2. 检查点 - 确保存储层测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 3. 经验匹配器实现
  - [x] 3.1 在 `server/src/experience-matcher.ts` 中实现 matchExperiences 函数
    - 实现相关性分数计算逻辑：题材完全匹配(+100)、部分匹配(+60)、受众匹配(+30)、通用(+10)
    - 实现排序逻辑：按相关性分数降序，同分按质量分数降序
    - 实现质量阈值过滤（默认40分）和引用次数上限降级（默认50次，相关性×0.5）
    - 支持 MatchOptions 参数（minScore、maxReferenceCount、limit）
    - _Requirements: 3.1, 3.2, 4.2, 4.3_

  - [ ]* 3.2 编写 ExperienceMatcher 的属性测试
    - **Property 6: 经验匹配排序正确性**
    - **Property 10: 低质量经验过滤**
    - **Property 11: 高引用经验优先级降级**
    - **Validates: Requirements 3.1, 3.2, 4.2, 4.3**

- [x] 4. 经验注入器实现
  - [x] 4.1 在 `server/src/experience-injector.ts` 中实现 buildInjectionContext 函数
    - 按 targetAgent 参数路由经验类型：mentor 接收 error_pattern + genre_rule，humanity 接收 success_pattern + audience_rule
    - 实现 token 估算逻辑（中文约1.5字符/token）和预算截断
    - 格式化为编号列表文本
    - _Requirements: 3.3, 3.4, 3.5_

  - [x] 4.2 实现 injectForLoopMode 和 injectForArenaMode 函数
    - injectForLoopMode：调用 matchExperiences + buildInjectionContext，返回增强后的 LoopConfig（填充 mentorContext 和 humanityContext）
    - injectForArenaMode：同理，返回 { mentorContext, humanityContext } 对象
    - 注入成功后调用 incrementReferenceCount 递增引用计数
    - _Requirements: 3.3, 3.6, 3.7_

  - [ ]* 4.3 编写 ExperienceInjector 的属性测试
    - **Property 7: 经验注入类型路由正确性**
    - **Property 8: Token预算不变量**
    - **Property 9: 引用计数递增正确性**
    - **Validates: Requirements 3.3, 3.4, 3.5, 3.6, 3.7**

- [x] 5. 检查点 - 确保匹配器和注入器测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [x] 6. 经验提取器实现
  - [x] 6.1 在 `server/src/experience-extractor.ts` 中实现 extractFromLoopProject 函数
    - 从 screenplay_projects 表读取项目数据和闭环迭代记录
    - 构建 LLM 提取 prompt，调用 chatCompletionJSON 提炼结构化经验
    - 基于项目 finalScores 计算质量分数
    - 调用 ExperienceStore 存储经验（含去重逻辑）
    - _Requirements: 1.1, 1.4, 4.1_

  - [x] 6.2 实现 extractFromArenaProject 函数
    - 从 arena_sessions、arena_candidates、arena_reviews、arena_funnel_scores 表读取竞技数据
    - 构建 LLM 提取 prompt，分析高分/低分候选方案
    - 复用 6.1 的质量分数计算和存储逻辑
    - _Requirements: 1.2, 1.4, 4.1_

  - [x] 6.3 实现统一入口 extractExperiences 函数
    - 自动判断项目模式（loop/arena），调用对应的提取函数
    - 实现 LLM 调用失败时的降级处理（try-catch，记录日志，返回部分结果）
    - _Requirements: 1.3, 1.5_

  - [ ]* 6.4 编写经验提取器的单元测试
    - 测试提取结果的结构完整性（Property 1 的具体示例）
    - 测试 LLM 调用失败时的降级处理
    - 测试手动触发未完成项目的提取
    - **Property 1: 经验提取结果结构完整性**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 4.1**

- [x] 7. 接入现有系统
  - [x] 7.1 修改 `server/src/screenplay-creator.ts`，在闭环创作流程中集成经验注入
    - 在 generateCreativePlan / generateCharacters / generateDirectory / generateEpisode 等函数中，当 loopMode 启用时调用 injectForLoopMode 增强 LoopConfig
    - _Requirements: 3.3_

  - [x] 7.2 修改 `server/src/arena-engine.ts`，在竞技模式中集成经验注入
    - 在 arenaLoopRefine 调用前，调用 injectForArenaMode 获取经验context并合并到 extractLoopConfig 的结果中
    - _Requirements: 3.6_

  - [x] 7.3 在项目完成时自动触发经验提取
    - 在闭环模式的最终完成回调中调用 extractExperiences
    - 在竞技模式的 startArenaCreation 完成回调中调用 extractExperiences
    - 提取过程异步执行，不阻塞主流程
    - _Requirements: 1.1, 1.2_

- [x] 8. 经验管理API路由
  - [x] 8.1 创建 `server/src/experience-routes.ts`，实现 REST API 路由
    - GET /api/experiences - 列表（支持 query 参数筛选）
    - GET /api/experiences/stats - 统计信息
    - GET /api/experiences/:id - 详情
    - PUT /api/experiences/:id - 更新
    - DELETE /api/experiences/:id - 删除
    - POST /api/experiences/extract/:projectId - 手动触发提取
    - 错误处理：404 / 400 状态码
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 8.2 在 `server/src/index.ts` 中注册经验管理路由
    - 添加 `app.use('/api/experiences', experienceRoutes)` 
    - 在 initDB 调用链中确保 experiences 表已创建
    - _Requirements: 5.1_

  - [ ]* 8.3 编写 API 路由的单元测试
    - 测试各端点的基本功能
    - 测试 404 错误处理
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 9. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速MVP开发
- 每个任务引用了具体的需求编号以确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界条件
