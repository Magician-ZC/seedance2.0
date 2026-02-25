---
inclusion: auto
---

# Seedance 视频制作工作流

本项目是一个整合了三个开源项目的 AI 视频制作平台：

## 项目结构

- `seedance2.0/` — 主项目，React + Express Web 应用（已改造为 TypeScript）
  - `server/src/` — 后端 TypeScript 源码（WebSocket + REST API）
  - `src/` — 前端 React 源码（i18n + 历史记录 + 批量生成）
- `Seedance2-Storyboard-Generator/` — 剧本和分镜生成 Skill
- `Seedance2-skill/` — 创意质量审核和优化 Skill

## 开发命令

```bash
# 安装依赖
cd seedance2.0 && npm run install:all

# 开发模式
npm run dev

# 运行测试
npm run test

# 代码检查
npm run lint

# 格式化
npm run format

# 构建
npm run build
```

## 技术栈

- 前端: React 19 + TypeScript + Vite + Tailwind CSS + i18next
- 后端: Express + TypeScript (tsx) + WebSocket (ws) + Playwright
- 测试: Vitest + Playwright
- 代码规范: ESLint 9 (flat config) + Prettier
