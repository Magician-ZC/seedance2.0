# 需求文档：系统Agent

## 简介

在现有的Agent仓库中增加"系统Agent"子菜单，预置10个编剧风格提示词作为系统Agent。系统Agent是只读的、不可删除的预置资源，用户可以浏览、查看详情并复制其Prompt用于创作。与用户通过工厂训练出来的作者Agent不同，系统Agent由系统内置提供，不依赖数据库存储。

## 术语表

- **System_Agent_Panel**：系统Agent面板，展示所有预置系统Agent的卡片式UI界面
- **System_Agent**：系统预置的编剧风格Agent，包含名称、风格、描述和完整的system_prompt
- **Sidebar**：侧边栏导航组件，包含Agent仓库分组及其子菜单
- **Agent_Store**：Agent仓库，侧边栏中的可展开分组，包含作者仓库、群演仓库和系统Agent三个子菜单
- **NavTab**：导航标签类型，用于标识当前激活的面板

## 需求

### 需求 1：侧边栏导航扩展

**用户故事：** 作为用户，我希望在Agent仓库的子菜单中看到"系统Agent"选项，以便我能快速访问预置的编剧风格Agent。

#### 验收标准

1. WHEN 用户展开Agent仓库分组, THE Sidebar SHALL 显示三个子菜单项：作者仓库、群演仓库和系统Agent
2. WHEN 用户点击"系统Agent"子菜单, THE Sidebar SHALL 将该菜单项高亮为激活状态，并切换主面板为System_Agent_Panel
3. WHEN "系统Agent"子菜单处于激活状态, THE Sidebar SHALL 在该菜单项左侧显示绿色激活指示条

### 需求 2：系统Agent数据定义

**用户故事：** 作为开发者，我希望系统Agent的数据以静态常量形式定义在前端代码中，以便无需数据库即可加载预置Agent。

#### 验收标准

1. THE System_Agent SHALL 包含以下字段：id、name、genre、tone、description和system_prompt
2. THE System_Agent SHALL 预置10个编剧风格Agent数据，每个Agent包含完整的风格提示词
3. WHEN 应用启动时, THE System_Agent_Panel SHALL 从静态常量中加载所有预置Agent数据，无需网络请求

### 需求 3：系统Agent面板展示

**用户故事：** 作为用户，我希望系统Agent面板以卡片式布局展示所有预置Agent，以便我能直观地浏览和选择。

#### 验收标准

1. WHEN System_Agent_Panel 加载完成, THE System_Agent_Panel SHALL 以卡片网格布局展示所有预置系统Agent
2. WHEN 展示Agent卡片时, THE System_Agent_Panel SHALL 在每张卡片上显示Agent的名称、风格标签、语调标签和简要描述
3. THE System_Agent_Panel SHALL 采用与AgentStorePanel一致的视觉风格，包括卡片圆角、背景色、边框和悬停效果

### 需求 4：系统Agent风格筛选

**用户故事：** 作为用户，我希望能按风格和语调筛选系统Agent，以便快速找到符合需求的编剧风格。

#### 验收标准

1. WHEN System_Agent_Panel 加载完成, THE System_Agent_Panel SHALL 在卡片网格上方显示风格和语调筛选栏
2. WHEN 用户选择某个风格筛选项, THE System_Agent_Panel SHALL 仅显示匹配该风格的Agent卡片
3. WHEN 用户选择某个语调筛选项, THE System_Agent_Panel SHALL 仅显示匹配该语调的Agent卡片
4. WHEN 筛选条件激活时, THE System_Agent_Panel SHALL 显示筛选结果计数和"清除筛选"按钮

### 需求 5：系统Agent详情查看

**用户故事：** 作为用户，我希望点击系统Agent卡片后能查看其完整详情，以便了解该Agent的风格指令和提示词内容。

#### 验收标准

1. WHEN 用户点击某个系统Agent卡片, THE System_Agent_Panel SHALL 打开一个侧滑详情面板，显示该Agent的完整信息
2. WHEN 详情面板打开时, THE System_Agent_Panel SHALL 显示Agent的名称、风格、语调、描述和完整的system_prompt
3. WHEN 用户点击详情面板外部区域或关闭按钮, THE System_Agent_Panel SHALL 关闭详情面板

### 需求 6：系统Agent Prompt复制

**用户故事：** 作为用户，我希望能一键复制系统Agent的Prompt，以便将其用于我的创作流程。

#### 验收标准

1. WHEN 详情面板打开时, THE System_Agent_Panel SHALL 显示"复制Prompt"按钮
2. WHEN 用户点击"复制Prompt"按钮, THE System_Agent_Panel SHALL 将该Agent的system_prompt复制到系统剪贴板

### 需求 7：系统Agent不可删除

**用户故事：** 作为用户，我希望系统Agent是只读的预置资源，以确保这些编剧风格始终可用。

#### 验收标准

1. THE System_Agent_Panel SHALL 不显示任何删除按钮或删除操作入口
2. WHEN 展示系统Agent卡片和详情时, THE System_Agent_Panel SHALL 不提供编辑或修改功能

### 需求 8：国际化支持

**用户故事：** 作为用户，我希望系统Agent面板支持中英文切换，以便在不同语言环境下使用。

#### 验收标准

1. WHEN 应用语言设置为中文时, THE System_Agent_Panel SHALL 以中文显示所有界面文本（菜单名、按钮文字、空状态提示等）
2. WHEN 应用语言设置为英文时, THE System_Agent_Panel SHALL 以英文显示所有界面文本
