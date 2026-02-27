# 角色三视图生成功能迁移说明

## 迁移概述

从 [moyin-creator](https://github.com/MemeCalculate/moyin-creator) 项目成功移植了专业的角色设定图生成系统。

## 新增文件

### 前端
1. **src/constants/visual-styles.ts** - 视觉风格预设系统
   - 8种预设风格（3D玄幻、3D美式、3D渲染2D、2D动画、2D少女漫画、2D水墨、真人电影、真人时尚）
   - 完整的 prompt 和 negativePrompt 配置
   - 风格查询和管理函数

2. **src/components/CharacterSheetGenerator.tsx** - 角色设定图生成器
   - 支持三视图、表情设定、比例设定、动作设定
   - 预览确认机制
   - 智能 Prompt 构建

3. **src/components/StylePicker.tsx** - 风格选择器组件
   - 可复用的风格选择UI
   - 按分类展示风格
   - 支持禁用状态

### 服务端
1. **POST /api/generate-character-sheet** - 新增API端点
   - 接收 prompt 和 negativePrompt
   - 调用即梦API生成1:1方形设定图
   - 自动保存到本地 `data/images/character-sheets/`

### 文档
1. **docs/CHARACTER_SHEET_GENERATION.md** - 功能使用说明
2. **docs/MIGRATION_CHARACTER_SHEET.md** - 本迁移文档

## 修改文件

### src/components/GlobalCharactersPanel.tsx
- 导入 CharacterSheetGenerator 组件
- 添加 `generatingCharId` 状态管理
- 添加 `handleGenerateSheet` 和 `handleSaveSheet` 方法
- 在角色卡片中添加"生成设定图"按钮（图片图标）
- 点击后切换到设定图生成模式

### server/src/image-generator.ts
- `generateImage` 函数新增 `negativePrompt` 参数支持
- 负面提示词会附加到完整 prompt 中

### server/src/index.ts
- 新增 `/api/generate-character-sheet` 路由
- 处理角色设定图生成请求
- 自动下载并保存到本地

## 核心改进

### 旧版 vs 新版对比

| 功能 | 旧版 | 新版 |
|------|------|------|
| 生成内容 | 3个简单角度 | 三视图+表情+比例+动作（可选） |
| 风格系统 | 9个简单预设 | 8个专业风格（含完整prompt） |
| Prompt构建 | 简单拼接 | 专业的分层构建策略 |
| 预览确认 | 无 | 有（避免浪费） |
| 负面提示词 | 无 | 有（提升质量） |
| 用户体验 | 基础 | 专业 |

### Prompt 构建策略

新版采用分层构建：
```
[基础描述] + [内容元素] + [布局要求] + [风格tokens] + [质量控制]
```

示例：
```
professional character design sheet for "小明", 
一位年轻的剑客，黑色长发，蓝色眼睛，深蓝色武士服, 
three-view turnaround (front view, side view, back view), 
expression sheet with multiple facial expressions, 
character reference sheet layout, white background, clean presentation, 
best quality, masterpiece, 8k, Genshin Impact style, cel shaded 3D, 
detailed illustration, concept art, character model sheet
```

## 使用方法

1. 在全局角色面板创建角色
2. Hover 角色卡片，点击"生成设定图"按钮（图片图标）
3. 配置：
   - 完善角色描述
   - 选择视觉风格
   - 勾选需要的设定图内容
4. 点击"生成角色设定图"
5. 预览满意后点击"保存设定图"

## 技术亮点

1. **模块化设计**：组件、风格、API完全解耦
2. **可复用组件**：StylePicker 可在其他地方使用
3. **类型安全**：完整的 TypeScript 类型定义
4. **用户友好**：预览确认机制，避免浪费生成次数
5. **风格一致性**：统一的风格系统保证项目内一致性

## 后续优化建议

1. 添加更多风格预设（像素风、水彩风等）
2. 支持自定义风格配置
3. 批量生成多个角色的设定图
4. 添加风格迁移功能
5. 支持角色变体生成（不同服装、表情等）
6. 集成到项目工作流中（自动为剧本角色生成）

## 注意事项

- 需要配置有效的 sessionId
- 生成的图片保存在 `data/images/character-sheets/` 目录
- 通过 `/api/images/` 路由访问本地图片
- 负面提示词通过在 prompt 中添加 "Negative prompt: ..." 实现
