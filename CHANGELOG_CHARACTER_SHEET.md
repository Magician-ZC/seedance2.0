# 角色三视图生成功能更新日志

## 版本 2.0 - 专业角色设定图系统

### 新增功能

#### 1. 视觉风格系统
- 新增 8 种专业风格预设（3D玄幻、3D美式、3D渲染2D、2D动画、2D少女漫画、2D水墨、真人电影、真人时尚）
- 每种风格包含完整的 prompt 和 negativePrompt 配置
- 支持按分类浏览和选择风格

#### 2. 角色设定图生成器
- 支持多种设定图内容：三视图、表情设定、比例设定、动作设定
- 用户可自由组合需要的内容
- 专业的 Prompt 构建策略
- 预览确认机制，避免浪费生成次数

#### 3. 批量生成集成
- 项目工作台的批量生成自动使用新的三视图生成
- 每个角色生成：
  - 1张完整设定图（三视图+表情）
  - 3张单独角度图（正面、侧面、背面）
- 自动保存到项目目录

#### 4. 分镜参考图优化
- 智能选择角色图片角度
- 优先使用正面图，补充侧面和背面
- 提供更完整的角色形象参考

### 技术改进

#### 前端
- 新增 `src/constants/visual-styles.ts` - 统一风格管理
- 新增 `src/components/CharacterSheetGenerator.tsx` - 设定图生成器
- 新增 `src/components/StylePicker.tsx` - 可复用风格选择器
- 优化 `src/components/GlobalCharactersPanel.tsx` - 集成设定图生成

#### 服务端
- 新增 `POST /api/generate-character-sheet` - 独立设定图生成API
- 优化 `POST /api/drama/:id/generate-character-images` - 使用新的三视图生成
- 新增 `generateCharacterSheetImage` 函数 - 专业设定图生成
- 优化 `collectReferenceImages` 函数 - 智能选择角色角度

### 破坏性变更

无。完全向后兼容，旧版数据结构继续支持。

### 迁移指南

现有项目无需迁移，新功能自动生效：
- 旧角色的 `imageUrls` 继续可用
- 新生成的角色会使用 `profileImages` 结构
- 分镜参考图会优先使用新结构，降级使用旧结构

### 已知问题

无

### 下一步计划

- 添加更多风格预设
- 支持自定义风格配置
- 角色变体生成
- AI 自动评分选择最佳角度
