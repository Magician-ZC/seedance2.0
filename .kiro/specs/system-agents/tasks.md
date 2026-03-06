# 实现计划：系统Agent

## 概述

在现有Agent仓库中新增"系统Agent"功能，包括：静态数据定义、导航扩展、面板组件开发。采用纯前端方案，复用现有UI模式。

## 任务

- [x] 1. 创建系统Agent静态数据模块
  - [x] 1.1 创建 `src/constants/system-agents-data.ts`，定义 `SystemAgent` 接口和 `SYSTEM_AGENTS` 常量数组
    - 定义接口字段：id, name, genre, tone, description, systemPrompt
    - 填充10个编剧风格Agent的完整数据（包含完整的system_prompt提示词）
    - _Requirements: 2.1, 2.2, 2.3_
  - [ ]* 1.2 编写属性测试验证系统Agent数据完整性
    - **Property 1: 系统Agent数据完整性**
    - **Validates: Requirements 2.1, 3.2, 5.2**

- [x] 2. 扩展侧边栏导航
  - [x] 2.1 修改 `src/components/Sidebar.tsx`
    - 在 `NavTab` 类型中新增 `'systemAgents'`
    - 新增 `ShieldIcon` 图标组件
    - 在 `AGENT_SUB_NAV` 数组中添加系统Agent菜单项
    - 更新 `isAgentTab` 判断逻辑包含 `'systemAgents'`
    - _Requirements: 1.1, 1.2, 1.3_
  - [x] 2.2 修改 `src/App.tsx`
    - 导入 `SystemAgentPanel` 组件
    - 在面板条件渲染中添加 `systemAgents` 分支
    - _Requirements: 1.2_

- [x] 3. 实现系统Agent面板组件
  - [x] 3.1 创建 `src/components/SystemAgentPanel.tsx`
    - 从 `system-agents-data.ts` 导入静态数据
    - 实现卡片网格布局，复用AgentStorePanel的视觉风格
    - 实现风格/语调筛选功能，复用FilterBar组件
    - 实现筛选结果计数和清除筛选按钮
    - 支持i18n中英文切换
    - _Requirements: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4, 8.1, 8.2_
  - [x] 3.2 实现侧滑详情面板
    - 点击卡片打开详情面板，显示完整Agent信息
    - 显示"复制Prompt"按钮，点击复制systemPrompt到剪贴板
    - 不显示删除/编辑按钮（只读模式）
    - 点击外部区域或关闭按钮关闭面板
    - _Requirements: 5.1, 5.2, 5.3, 6.1, 6.2, 7.1, 7.2_
  - [ ]* 3.3 编写属性测试验证筛选正确性
    - **Property 2: 筛选正确性**
    - **Validates: Requirements 4.2, 4.3**

- [x] 4. 检查点 - 确保所有功能正常
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速MVP
- 每个任务引用了具体的需求编号以确保可追溯性
- 系统Agent数据为纯前端静态常量，无需后端API改动
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
