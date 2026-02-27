# 角色三视图生成完整工作流

## 整体架构

```
用户操作 → 前端组件 → 服务端API → 图片生成器 → 本地存储 → 分镜参考
```

## 两种使用场景

### 场景1：全局角色面板（独立创建）

**适用于**：独立创建角色，不属于任何项目

**流程**：
1. 用户在全局角色面板点击 "+" 创建角色
2. 填写角色名称和描述
3. Hover 角色卡片，点击"生成设定图"按钮
4. 进入 `CharacterSheetGenerator` 组件
5. 配置风格和内容，点击生成
6. 预览确认后保存

**API调用**：
```
POST /api/generate-character-sheet
{
  "prompt": "完整的设定图prompt",
  "negativePrompt": "负面提示词",
  "sessionId": "用户会话ID"
}
```

**存储位置**：`data/images/character-sheets/`

---

### 场景2：项目工作台（批量生成）

**适用于**：项目中的角色，需要用于后续分镜生成

**流程**：
1. 用户在项目工作台的"角色"标签页
2. 点击"批量生成角色图"按钮
3. 系统自动为所有未确认的角色生成设定图
4. 每个角色生成：
   - 1张三视图+表情设定图（作为主图）
   - 3张单独角度图（正面、侧面、背面）
5. 自动确认并进入下一阶段

**API调用**：
```
POST /api/drama/:id/generate-character-images
{
  "sessionId": "用户会话ID",
  "characterId": "角色ID"
}
```

**生成内容**：
- `profileImages.main`: 三视图+表情设定图（1024x1024）
- `profileImages.front`: 正面单独图
- `profileImages.side`: 侧面单独图
- `profileImages.back`: 背面单独图

**存储位置**：`data/images/{项目ID}/characters/{角色名}/`

---

## 分镜参考图使用策略

在生成分镜的参考图时（`collectReferenceImages` 函数），系统会智能选择角色图片：

### 优先级策略

1. **首选**：`profileImages.front`（正面图）- 最常用的角色展示角度
2. **补充**：`profileImages.side`（侧面图）- 提供侧面参考
3. **补充**：`profileImages.back`（背面图）- 提供背面参考
4. **降级**：`profileImages.main`（主设定图）- 包含三视图的完整设定
5. **兜底**：`imageUrls[0]`（旧版图片）- 兼容旧数据

### 组合策略

```typescript
// 场景图 + 角色图组合
if (有场景图) {
  参考图 = [1张场景图, 最多4张角色图（正面+侧面+背面）]
} else {
  参考图 = [最多5张角色图]
}
```

### 为什么这样设计？

1. **正面图优先**：大多数分镜需要角色正面展示
2. **多角度补充**：侧面和背面图提供完整的角色形象参考
3. **避免重复**：不重复添加同一角色的多张图
4. **数量控制**：最多5张参考图，避免影响生成质量

---

## 数据结构

### CharacterInfo 扩展

```typescript
interface CharacterInfo {
  // ... 其他字段
  profileImages?: {
    main?: string;        // 主设定图（三视图+表情）
    front?: string;       // 正面单独图
    side?: string;        // 侧面单独图
    back?: string;        // 背面单独图
    costume?: string;     // 服装细节（可选）
    props?: string;       // 道具细节（可选）
    expressions?: string; // 表情特写（可选）
  };
  imageUrls: string[];    // 所有图片URL（兼容旧版）
}
```

---

## Prompt 构建详解

### buildCharacterSheetPrompt 函数

**输入参数**：
- `characterName`: 角色名称
- `description`: 角色描述
- `selectedElements`: 选中的设定图元素
- `stylePrompt`: 风格提示词
- `isRealistic`: 是否为真人风格

**构建步骤**：

1. **基础描述**
   - 真人：`professional character reference for "{name}", {desc}, real person`
   - 动画：`professional character design sheet for "{name}", {desc}`

2. **内容元素拼接**
   - 三视图：`three-view turnaround (front view, side view, back view)`
   - 表情：`expression sheet with multiple facial expressions...`
   - 比例：`body proportion reference, height chart...`
   - 动作：`pose sheet with various action poses...`

3. **布局和质量**
   - `character reference sheet layout`
   - `white background, clean presentation`

4. **风格应用**
   - 添加风格的完整 prompt tokens
   - 例如：`best quality, masterpiece, 8k, Genshin Impact style...`

5. **风格约束**
   - 真人：`photorealistic, real human, NOT anime, NOT cartoon...`
   - 动画：`detailed illustration, concept art, character model sheet`

**输出示例**：
```
professional character design sheet for "林晚秋", 
18岁高中女生，黑色长直发，棕色眼睛，白色校服配格子裙，黑框眼镜，文静优雅, 
three-view turnaround (front view, side view, back view), 
expression sheet with multiple facial expressions (happy, sad, angry, surprised, neutral), 
character reference sheet layout, white background, clean presentation, 
best quality, masterpiece, 8k, Genshin Impact style, cel shaded 3D, 
anime style 3d rendering, clean lines, vibrant anime colors, 2.5d, toon shading, 
detailed illustration, concept art, character model sheet
```

---

## 风格映射

项目中的简单风格名称会映射到专业的 style tokens：

| 项目风格 | Style Tokens | 类型 |
|---------|--------------|------|
| 都市言情 | cinematic photography, professional portrait | 真人 |
| 水墨武侠风格 | Chinese ink painting style, wuxia aesthetic | 2D |
| 三渲二 | Genshin Impact style, cel shaded 3D | 3D |
| 怀旧胶片 | vintage film photography, retro aesthetic | 真人 |
| 女频漫画 | shoujo manga style, delicate lineart | 2D |
| 吉卜力 | Studio Ghibli style, hand-drawn animation | 2D |
| 3D国创 | Chinese 3D animation, Unreal Engine style | 3D |
| JoJo | JoJo bizarre adventure style, dramatic poses | 2D |

---

## 进度广播

通过 WebSocket 实时广播生成进度：

```typescript
// 阶段1：生成设定图
broadcast('processing', { 
  phase: 'sheet', 
  done: 0, 
  total: 3, 
  msg: '生成角色设定图（三视图+表情）...' 
});

// 阶段2：生成单独角度图
broadcast('processing', { 
  phase: 'detail', 
  done: 1, 
  total: 3, 
  msg: '生成正面图...' 
});

// 完成
broadcast('done', { 
  phase: 'done', 
  done: 3, 
  total: 3, 
  imageUrls: [...],
  profileImages: {...} 
});
```

前端通过 WebSocket 监听进度，实时更新UI。

---

## 错误处理

### 生成失败
- 单个角度生成失败不影响其他角度
- 至少保证主设定图生成成功
- 失败时记录日志并继续

### 下载失败
- 自动重试1次（延迟2秒）
- 重试失败则跳过该图片
- 不阻塞整体流程

### 图片过期
- 在批量生成视频前检查图片有效性
- 过期图片会提示用户重新生成
- 通过 `ensureLocalImages` 函数处理

---

## 性能优化

1. **并发控制**：批量生成时控制并发数（默认2个角色同时生成）
2. **渐进式生成**：先生成主设定图，再生成单独角度
3. **本地缓存**：图片下载到本地，避免重复下载
4. **智能选择**：分镜参考图只选择必要的角度，不全部使用

---

## 测试建议

### 单元测试
- `buildCharacterSheetPrompt` 函数的 prompt 构建逻辑
- 风格映射的正确性
- 图片URL的格式转换

### 集成测试
1. 创建测试项目
2. 添加测试角色
3. 批量生成角色图
4. 验证 profileImages 结构
5. 生成分镜参考图
6. 检查参考图是否正确使用三视图

### 手动测试
1. 在全局角色面板创建角色并生成设定图
2. 在项目工作台批量生成角色图
3. 检查生成的图片质量
4. 验证分镜生成时是否使用了正确的角色图
5. 测试不同风格的效果

---

## 未来扩展

### 短期
- [ ] 添加更多风格预设（像素风、水彩风等）
- [ ] 支持自定义风格配置
- [ ] 优化 prompt 构建策略

### 中期
- [ ] 角色变体生成（不同服装、表情）
- [ ] 风格迁移功能
- [ ] 批量导出角色设定图

### 长期
- [ ] AI 自动评分选择最佳角度
- [ ] 角色一致性检测
- [ ] 多角色组合设定图
- [ ] 3D 模型生成集成
