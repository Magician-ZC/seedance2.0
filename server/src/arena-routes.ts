import { Router, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import {
  scoreScreenplay,
  battleScreenplays,
  startTournament,
  getLeaderboard,
  getScreenplayHistory,
  getArenaScreenplays,
  generateEvolutionPlan,
  executeEvolution,
  getELO,
} from './arena-service.js';

const router = Router();

// GET /screenplays — 已完成剧本列表
router.get('/screenplays', (_req: Request, res: Response) => {
  try {
    const screenplays = getArenaScreenplays();
    res.json({ screenplays });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /score — 剧本评分
router.post('/score', async (req: Request, res: Response) => {
  try {
    const { screenplayId, mode, roleKey } = req.body;
    if (!screenplayId) return res.status(400).json({ error: 'screenplayId 必填' });
    if (!mode || !['single', 'panel'].includes(mode))
      return res.status(400).json({ error: 'mode 必须为 single 或 panel' });
    if (mode === 'single' && !roleKey)
      return res.status(400).json({ error: '单角色模式必须指定 roleKey' });

    const result = await scoreScreenplay(screenplayId, mode, roleKey);
    res.json(result);
  } catch (err: any) {
    console.error('[arena] /score 评分失败:', err);
    res.status(500).json({ error: err.message || '评分服务内部错误' });
  }
});

// POST /battle — 1v1 对战
router.post('/battle', async (req: Request, res: Response) => {
  try {
    const { screenplayIdA, screenplayIdB } = req.body;
    if (!screenplayIdA || !screenplayIdB)
      return res.status(400).json({ error: '需要两个剧本 ID' });
    if (screenplayIdA === screenplayIdB)
      return res.status(400).json({ error: '不能与自己对战' });

    // ELO 差距提示（不阻止对战）
    const eloA = getELO(screenplayIdA);
    const eloB = getELO(screenplayIdB);
    const eloGapWarning = Math.abs(eloA - eloB) > 400;

    const result = await battleScreenplays(screenplayIdA, screenplayIdB);
    res.json({ ...result, eloGapWarning });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /tournament — 启动锦标赛
router.post('/tournament', async (req: Request, res: Response) => {
  try {
    const { screenplayIds, format } = req.body;
    if (!Array.isArray(screenplayIds) || screenplayIds.length < 3)
      return res.status(400).json({ error: '至少需要 3 个剧本' });
    if (!format || !['elimination', 'round-robin'].includes(format))
      return res.status(400).json({ error: 'format 必须为 elimination 或 round-robin' });

    const taskId = crypto.randomUUID();
    // 异步执行锦标赛，立即返回 taskId
    startTournament(screenplayIds, format, taskId).catch((err) => {
      console.error('[arena] 锦标赛执行失败:', err.message);
    });

    res.json({ taskId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /leaderboard — ELO 排行榜
router.get('/leaderboard', (_req: Request, res: Response) => {
  try {
    const leaderboard = getLeaderboard();
    res.json({ leaderboard });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /evolve/plan — 生成进化方案（必须在 /evolve 之前注册，避免路由冲突）
router.post('/evolve/plan', async (req: Request, res: Response) => {
  try {
    const { loserId, winnerId, battleId } = req.body;
    if (!loserId || !winnerId || !battleId)
      return res.status(400).json({ error: 'loserId, winnerId, battleId 必填' });

    const plan = await generateEvolutionPlan(loserId, winnerId, battleId);
    res.json(plan);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /evolve — 执行进化
router.post('/evolve', async (req: Request, res: Response) => {
  try {
    const { loserId, winnerId, selectedElements, evolutionType } = req.body;
    if (!loserId || !winnerId)
      return res.status(400).json({ error: 'loserId 和 winnerId 必填' });
    if (!Array.isArray(selectedElements) || selectedElements.length === 0)
      return res.status(400).json({ error: 'selectedElements 不能为空' });

    const result = await executeEvolution(loserId, winnerId, selectedElements, evolutionType);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /history/:screenplayId — 对战历史+进化谱系
router.get('/history/:screenplayId', (req: Request, res: Response) => {
  try {
    const screenplayId = req.params.screenplayId as string;
    const history = getScreenplayHistory(screenplayId);
    res.json(history);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
