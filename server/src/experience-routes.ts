// 经验管理 REST API 路由
// 复用 Express Router 模式，提供经验的 CRUD 和提取触发端点

import { Router, type Request, type Response } from 'express';
import {
  listExperiences,
  getExperienceById,
  updateExperience,
  deleteExperience,
  getExperienceStats,
  type ExperienceFilter,
} from './experience-store.js';
import { extractExperiences } from './experience-extractor.js';

const router = Router();

// GET / — 经验列表（支持 query 参数筛选：type, genre, audience, minScore）
router.get('/', (req: Request, res: Response) => {
  try {
    const filter: ExperienceFilter = {};
    if (req.query.type) {
      const t = String(req.query.type);
      const validTypes = ['error_pattern', 'success_pattern', 'genre_rule', 'audience_rule'];
      if (!validTypes.includes(t)) {
        return res.status(400).json({ error: `无效的 type 参数，可选值: ${validTypes.join(', ')}` });
      }
      filter.type = t as ExperienceFilter['type'];
    }
    if (req.query.genre) filter.genre = String(req.query.genre);
    if (req.query.audience) filter.audience = String(req.query.audience);
    if (req.query.minScore) {
      const score = Number(req.query.minScore);
      if (isNaN(score)) {
        return res.status(400).json({ error: 'minScore 必须为数字' });
      }
      filter.minScore = score;
    }

    const experiences = listExperiences(Object.keys(filter).length > 0 ? filter : undefined);
    res.json({ experiences });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '获取经验列表失败' });
  }
});

// GET /stats — 经验库统计信息（必须在 /:id 之前注册，避免路由冲突）
router.get('/stats', (_req: Request, res: Response) => {
  try {
    const stats = getExperienceStats();
    res.json(stats);
  } catch (err: any) {
    res.status(500).json({ error: err.message || '获取统计信息失败' });
  }
});

// GET /:id — 单条经验详情
router.get('/:id', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const experience = getExperienceById(id);
    if (!experience) {
      return res.status(404).json({ error: `经验 ${id} 不存在` });
    }
    res.json(experience);
  } catch (err: any) {
    res.status(500).json({ error: err.message || '获取经验详情失败' });
  }
});

// PUT /:id — 更新经验的可编辑字段
router.put('/:id', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = getExperienceById(id);
    if (!existing) {
      return res.status(404).json({ error: `经验 ${id} 不存在` });
    }

    const body = req.body;
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      return res.status(400).json({ error: '请求体不能为空' });
    }

    updateExperience(id, body);
    const updated = getExperienceById(id);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message || '更新经验失败' });
  }
});

// DELETE /:id — 删除经验
router.delete('/:id', (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = getExperienceById(id);
    if (!existing) {
      return res.status(404).json({ error: `经验 ${id} 不存在` });
    }

    deleteExperience(id);
    res.json({ message: `经验 ${id} 已删除` });
  } catch (err: any) {
    res.status(500).json({ error: err.message || '删除经验失败' });
  }
});

// POST /extract/:projectId — 手动触发指定项目的经验提取
router.post('/extract/:projectId', async (req: Request, res: Response) => {
  try {
    const projectId = String(req.params.projectId);
    if (!projectId) {
      return res.status(400).json({ error: 'projectId 不能为空' });
    }

    const experiences = await extractExperiences(projectId);
    res.json({ projectId, extracted: experiences.length, experiences });
  } catch (err: any) {
    console.error(`[experience-routes] 经验提取失败 (projectId=${req.params.projectId}):`, err);
    res.status(500).json({ error: err.message || '经验提取失败' });
  }
});

export default router;
