# 需求文档：Agent经验累积系统

## 简介

Agent经验累积系统为Seedance 2.0多Agent剧本创作系统提供跨项目的经验记忆能力。系统从历史创作数据中自动提取有价值的经验（高频错误模式、高分方案特征、题材特定创作规律等），将经验持久化存储到SQLite数据库，并在新项目创作时智能匹配并注入相关经验到Agent的context中，从而让Agent在每次创作中都能利用历史积累的知识，持续提升创作质量。

## 术语表

- **Experience（经验）**：从历史创作数据中提取的结构化知识条目，包含经验类型、适用维度、内容摘要和来源信息
- **ExperienceExtractor（经验提取器）**：负责分析历史创作数据并提取经验的模块，调用LLM对闭环迭代记录和竞技评审数据进行分析
- **ExperienceStore（经验存储）**：SQLite中的经验持久化存储层，提供经验的CRUD操作
- **ExperienceMatcher（经验匹配器）**：根据项目配置（题材、受众等维度）从经验库中检索相关经验的模块
- **ExperienceInjector（经验注入器）**：将匹配到的经验格式化并注入到Agent的systemPrompt中的模块，复用已有的extraContext参数
- **LoopIteration（闭环迭代）**：导师Agent、人性Agent、中枢Agent对创作内容进行审阅和裁决的一轮完整流程
- **ArenaSession（竞技会话）**：竞技模式下百Agent竞争淘汰的一次完整创作过程
- **QualityScore（质量分数）**：经验条目的质量评分，用于过滤低质量经验，范围0-100
- **TokenBudget（Token预算）**：注入经验时允许消耗的最大token数量，防止prompt无限膨胀

## 需求

### 需求1：经验提取

**用户故事：** 作为系统运维者，我希望系统能从已完成的创作项目中自动提取有价值的经验，以便这些经验能被后续项目复用。

#### 验收标准

1. WHEN 一个闭环创作项目完成（所有分集生成完毕）时，THE ExperienceExtractor SHALL 自动分析该项目的闭环迭代记录（LoopIteration数据），提取出导师Agent和人性Agent的高频反馈模式、中枢Agent的裁决规律
2. WHEN 一个竞技模式项目完成时，THE ExperienceExtractor SHALL 自动分析该项目的竞技评审数据（arena_reviews、arena_funnel_scores），提取出高分候选方案的共性特征和低分方案的常见问题
3. WHEN 用户手动触发经验提取时，THE ExperienceExtractor SHALL 对指定项目执行经验提取流程，即使该项目尚未完成
4. THE ExperienceExtractor SHALL 为每条提取的经验生成结构化数据，包含：经验类型（error_pattern/success_pattern/genre_rule/audience_rule）、适用题材列表、适用受众、经验内容摘要、来源项目ID、质量分数
5. IF 经验提取过程中LLM调用失败，THEN THE ExperienceExtractor SHALL 记录错误日志并跳过当前提取步骤，保留已成功提取的经验条目

### 需求2：经验存储

**用户故事：** 作为系统运维者，我希望提取的经验能被持久化存储并支持管理操作，以便维护经验库的质量。

#### 验收标准

1. THE ExperienceStore SHALL 将经验条目持久化存储到SQLite数据库的experiences表中
2. THE ExperienceStore SHALL 为每条经验存储以下字段：唯一ID、经验类型、适用题材列表（JSON数组）、适用受众、经验内容摘要、来源项目ID、来源模式（loop/arena）、质量分数、引用次数、创建时间、更新时间
3. WHEN 用户请求查看经验列表时，THE ExperienceStore SHALL 返回经验列表，支持按类型、题材、受众、质量分数进行筛选
4. WHEN 用户请求编辑一条经验时，THE ExperienceStore SHALL 更新该经验的内容摘要、适用题材、适用受众、质量分数字段
5. WHEN 用户请求删除一条经验时，THE ExperienceStore SHALL 从数据库中移除该经验条目
6. WHEN 同一来源项目重复提取经验时，THE ExperienceStore SHALL 基于来源项目ID进行去重，更新已有经验而非创建重复条目

### 需求3：经验匹配与注入

**用户故事：** 作为创作者，我希望新项目创作时系统能自动注入相关的历史经验，以便Agent能利用过往知识提升创作质量。

#### 验收标准

1. WHEN 闭环创作模式启动时，THE ExperienceMatcher SHALL 根据项目的ScreenplayConfig（题材genres、受众audience）从经验库中检索匹配的经验条目
2. THE ExperienceMatcher SHALL 按以下优先级排序匹配结果：题材完全匹配 > 题材部分匹配 > 受众匹配 > 通用经验，同优先级内按质量分数降序排列
3. WHEN 匹配到相关经验时，THE ExperienceInjector SHALL 将经验格式化为文本，通过LoopConfig的mentorContext和humanityContext字段注入到对应Agent的systemPrompt中
4. THE ExperienceInjector SHALL 将error_pattern和genre_rule类型的经验注入到导师Agent的mentorContext中，将success_pattern和audience_rule类型的经验注入到人性Agent的humanityContext中
5. THE ExperienceInjector SHALL 控制注入的经验总token数不超过配置的TokenBudget（默认2000 tokens），超出时按优先级截断低优先级经验
6. WHEN 竞技模式启动时，THE ExperienceInjector SHALL 将匹配的经验注入到竞技引擎的arenaLoopRefine闭环配置中
7. WHEN 经验被成功注入到某个项目时，THE ExperienceStore SHALL 递增该经验条目的引用次数

### 需求4：经验质量控制

**用户故事：** 作为系统运维者，我希望经验库有质量控制机制，以便避免低质量经验污染Agent的创作能力。

#### 验收标准

1. THE ExperienceExtractor SHALL 在提取经验时为每条经验计算质量分数（0-100），基于来源项目的最终评分（闭环模式的finalScores、竞技模式的weighted_total）
2. WHEN 经验的质量分数低于配置的最低阈值（默认40分）时，THE ExperienceStore SHALL 将该经验标记为低质量，ExperienceMatcher在匹配时默认排除低质量经验
3. WHEN 经验的引用次数超过配置的上限（默认50次）时，THE ExperienceMatcher SHALL 降低该经验的匹配优先级，避免过度依赖单条经验
4. THE ExperienceStore SHALL 支持用户手动调整经验的质量分数，覆盖自动计算的分数

### 需求5：经验管理API

**用户故事：** 作为前端开发者，我希望有完整的REST API来管理经验数据，以便在前端界面中展示和操作经验库。

#### 验收标准

1. THE 经验管理API SHALL 提供 GET /api/experiences 端点，返回经验列表，支持query参数筛选（type、genre、audience、minScore）
2. THE 经验管理API SHALL 提供 GET /api/experiences/:id 端点，返回单条经验的详细信息
3. THE 经验管理API SHALL 提供 PUT /api/experiences/:id 端点，更新经验的可编辑字段
4. THE 经验管理API SHALL 提供 DELETE /api/experiences/:id 端点，删除指定经验
5. THE 经验管理API SHALL 提供 POST /api/experiences/extract/:projectId 端点，手动触发指定项目的经验提取
6. THE 经验管理API SHALL 提供 GET /api/experiences/stats 端点，返回经验库的统计信息（总数、按类型分布、按题材分布、平均质量分数）
7. IF 请求的经验ID不存在，THEN THE 经验管理API SHALL 返回404状态码和描述性错误信息
