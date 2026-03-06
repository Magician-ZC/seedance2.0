// 后端主入口 - TypeScript 重构版
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import http from 'http';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { generateSeedanceVideo } from './video-generator.js';
import browserService from './browser-service.js';
import { wsManager } from './ws-manager.js';
import { FAKE_HEADERS } from './utils.js';
import type { TaskInfo, ModelKey, HistoryRecord } from './types.js';
import { DEFAULT_PRESETS } from './types.js';
import { loadWords, checkText, sanitizeText, addManualWords, removeWord, getWordsDetail, learnFromFailure, confirmLearnedWord } from './sensitive-words.js';
import {
  createProject, getProject, updateProject, listProjects, removeProject,
  analyzeNovel, transformCopyright, generateScript, confirmCharacter,
  getProjectLogs, batchGenerateVideos, optimizeScripts,
  batchGenerateRefImages, refreshVisualPrompts, refreshTitleAndSummary, updateCharacterRefImage, optimizeSingleEpisode,
  generateEpisodeRefImages, regenerateEpisodeShots, getProjectImageSubDir, updateCharacterFields, updateLocationFields,
  repairProjectImages,
  extractCharacterAgents,
  type CharacterInfo, type LocationInfo,
} from './novel-to-drama.js';
import { generateImage, generateCharacterMainImages, generateCharacterDetailImages, generateCharacterSheetImage, downloadImageToLocal, deleteLocalImage, isLocalImageUrl, localUrlToFilename, httpsDownload, type ProfileImageType } from './image-generator.js';
import { initDB, saveLLMConfig as saveLLMConfigToDB, loadLLMConfigFromDB, saveVisionLLMConfig as saveVisionConfigToDB, loadVisionLLMConfigFromDB, saveExtraLLMConfigs as saveExtraConfigsToDB, loadExtraLLMConfigsFromDB, insertAgent as insertAgentStore, listAgents as listAgentStore, getAgentById as getAgentStoreById, deleteAgent as deleteAgentStore, listCharacterAgents, getCharacterAgentById, deleteCharacterAgent, updateCharacterAgent, insertCharacterAgent, type AgentStoreRow, type CharacterAgentRow } from './db-service.js';
import { getLLMConfig, updateLLMConfig, getVisionLLMConfig, updateVisionLLMConfig, hasVisionConfig, getExtraConfigs, setExtraConfigs, isNSFWEnabled, setNSFWEnabled, loadNSFWFromDB, type LLMConfig } from './llm-service.js';
import { autoSelectBestImage } from './vision-validator.js';
import {
  createScreenplay, getScreenplay, updateScreenplay, listScreenplays, removeScreenplay,
  generateCreativePlan, generateCharacters, generateDirectory,
  generateEpisode, generateEpisodeBatch, retryFailedEpisodes, reviewEpisode, exportScreenplay, getGenreList,
  loadScreenplayProjectsFromDB, analyzeReferenceNovel, generateSubmissionMaterials,
} from './screenplay-creator.js';
import {
  createFactory, getFactory, updateFactory, listFactories, removeFactory,
  parseNovelDNA, generateInitialAgents, runEvolutionRound, mutateAndBreed,
  runFullEvolution, exportFinalAgent, requestStop, restoreFactories,
  buildFactoryCharacterPrompt, retryProtagonistExtraction, type FactoryProtagonist,
} from './agent-factory.js';
import arenaRoutes from './arena-routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const DEFAULT_SESSION_ID = process.env.VITE_DEFAULT_SESSION_ID || '';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 静态文件服务：本地角色图片
app.use('/api/images', express.static(path.join(__dirname, '../../data/images')));

// 角斗场 API 路由
app.use('/api/arena', arenaRoutes);

// 启动时加载敏感词库
loadWords();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ============================================================
// 任务管理
// ============================================================
const tasks = new Map<string, TaskInfo>();
let taskCounter = 0;

function createTaskId(): string {
  return `task_${++taskCounter}_${Date.now()}`;
}

// 定期清理过期任务
setInterval(() => {
  const now = Date.now();
  for (const [id, task] of tasks) {
    if (now - task.startTime > 30 * 60 * 1000) tasks.delete(id);
  }
}, 60000);

// 带 WebSocket 广播的进度更新（供外部模块调用）
export function updateTaskProgress(taskId: string, progress: string): void {
  const task = tasks.get(taskId);
  if (task) {
    task.progress = progress;
    wsManager.broadcast(taskId, task);
  }
}

// ============================================================
// 历史记录 (内存存储，前端也有 localStorage 备份)
// ============================================================
const historyRecords: HistoryRecord[] = [];
const MAX_HISTORY = 100;

function addHistory(record: HistoryRecord): void {
  historyRecords.unshift(record);
  if (historyRecords.length > MAX_HISTORY) historyRecords.pop();
}

// ============================================================
// API 路由
// ============================================================

// POST /api/generate-video - 提交视频生成任务
app.post('/api/generate-video', upload.array('files', 5), async (req, res) => {
  const startTime = Date.now();
  try {
    const { prompt, ratio, duration, sessionId, model, autoGenImage } = req.body;
    const files = req.files as Express.Multer.File[];
    const authToken = sessionId || DEFAULT_SESSION_ID;
    if (!authToken) return res.status(401).json({ error: '未配置 Session ID，请在设置中填写' });

    // 敏感词检查
    const sensitiveHits = checkText(prompt || '');
    if (sensitiveHits.length > 0) {
      return res.status(400).json({
        error: `提示词包含敏感词: ${sensitiveHits.join(', ')}。请修改后重试。`,
        sensitiveWords: sensitiveHits,
      });
    }

    // 参考图片不再是必填：如果没有图片且 autoGenImage=true，自动生成
    let actualFiles = files;
    if (!Array.isArray(files) || files.length === 0) {
      if (autoGenImage === 'true' && prompt) {
        // 自动生成参考图
        try {
          console.log(`[auto-image] 无参考图，自动生成中...`);
          const genResults = await generateImage(prompt, authToken, { width: 1280, height: 720, count: 1 });
          if (genResults.length > 0) {
            // 下载生成的图片到内存作为 file
            const imgBuffer = await httpsDownload(genResults[0].imageUrl);
            actualFiles = [{
              fieldname: 'files', originalname: 'auto-generated.jpg',
              encoding: '7bit', mimetype: 'image/jpeg',
              buffer: imgBuffer, size: imgBuffer.length,
            } as Express.Multer.File];
            console.log(`[auto-image] 自动生成参考图成功 (${imgBuffer.length} bytes)`);
          }
        } catch (err) {
          console.error(`[auto-image] 自动生成失败: ${(err as Error).message}`);
          return res.status(400).json({ error: `自动生成参考图失败: ${(err as Error).message}` });
        }
      } else if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ error: 'Seedance 2.0 需要至少上传一张参考图片，或开启自动生成' });
      }
    }

    const taskId = createTaskId();
    const task: TaskInfo = {
      id: taskId, status: 'processing', progress: '正在准备...', startTime,
      result: null, error: null, prompt, model: (model || 'seedance-2.0') as ModelKey,
      ratio: ratio || '4:3', duration: parseInt(duration) || 4,
    };
    tasks.set(taskId, task);

    console.log(`\n========== [${taskId}] 收到视频生成请求 ==========`);
    console.log(`  prompt: ${(prompt || '').substring(0, 80)}${(prompt || '').length > 80 ? '...' : ''}`);
    console.log(`  model: ${model || 'seedance-2.0'}, ratio: ${ratio || '4:3'}, duration: ${duration || 4}秒`);
    console.log(`  files: ${actualFiles.length}张`);

    res.json({ taskId });

    // 后台执行，通过 WebSocket 推送进度
    const originalProgress = task.progress;
    const progressInterval = setInterval(() => {
      if (task.progress !== originalProgress) wsManager.broadcast(taskId, task);
    }, 1000);

    generateSeedanceVideo(taskId, {
      prompt, ratio: ratio || '4:3', duration: parseInt(duration) || 4,
      files: actualFiles, sessionId: authToken, model: model || 'seedance-2.0',
    }, tasks)
      .then((videoUrl) => {
        clearInterval(progressInterval);
        task.status = 'done';
        task.result = { created: Math.floor(Date.now() / 1000), data: [{ url: videoUrl, revised_prompt: prompt || '' }] };
        wsManager.broadcast(taskId, task);
        addHistory({
          id: crypto.randomUUID(), taskId, prompt: prompt || '', model: (model || 'seedance-2.0') as ModelKey,
          ratio: ratio || '4:3', duration: parseInt(duration) || 4, videoUrl, createdAt: Date.now(), status: 'done',
        });
        console.log(`========== [${taskId}] ✅ 视频生成成功 (${((Date.now() - startTime) / 1000).toFixed(1)}秒) ==========\n`);
      })
      .catch((err: Error) => {
        clearInterval(progressInterval);
        task.status = 'error';
        task.error = err.message || '视频生成失败';
        wsManager.broadcast(taskId, task);
        // 如果是内容过滤错误，自动学习敏感词
        if (err.message?.includes('内容被过滤') || err.message?.includes('过滤')) {
          learnFromFailure(prompt || '');
        }
        addHistory({
          id: crypto.randomUUID(), taskId, prompt: prompt || '', model: (model || 'seedance-2.0') as ModelKey,
          ratio: ratio || '4:3', duration: parseInt(duration) || 4, videoUrl: '', createdAt: Date.now(), status: 'error', error: err.message,
        });
        console.error(`========== [${taskId}] ❌ 视频生成失败 (${((Date.now() - startTime) / 1000).toFixed(1)}秒): ${err.message} ==========\n`);
      });
  } catch (error: unknown) {
    console.error(`请求处理错误: ${(error as Error).message}`);
    if (!res.headersSent) res.status(500).json({ error: (error as Error).message || '服务器内部错误' });
  }
});

// POST /api/batch-generate - 批量生成
app.post('/api/batch-generate', upload.array('files', 25), async (req, res) => {
  try {
    const { tasks: batchTasks, sessionId } = req.body;
    const parsedTasks = JSON.parse(batchTasks || '[]') as Array<{ prompt: string; model: string; ratio: string; duration: number; fileIndices: number[] }>;
    const files = req.files as Express.Multer.File[];
    const authToken = sessionId || DEFAULT_SESSION_ID;
    if (!authToken) return res.status(401).json({ error: '未配置 Session ID' });

    const taskIds: string[] = [];
    for (const bt of parsedTasks) {
      const taskId = createTaskId();
      const taskFiles = (bt.fileIndices || []).map((i: number) => files[i]).filter(Boolean);
      if (taskFiles.length === 0) continue;

      const task: TaskInfo = {
        id: taskId, status: 'processing', progress: '排队中...', startTime: Date.now(),
        result: null, error: null, prompt: bt.prompt, model: (bt.model || 'seedance-2.0') as ModelKey,
        ratio: bt.ratio || '4:3', duration: bt.duration || 4,
      };
      tasks.set(taskId, task);
      taskIds.push(taskId);

      // 串行执行避免并发过高
      generateSeedanceVideo(taskId, {
        prompt: bt.prompt, ratio: bt.ratio || '4:3', duration: bt.duration || 4,
        files: taskFiles, sessionId: authToken, model: bt.model || 'seedance-2.0',
      }, tasks)
        .then((videoUrl) => {
          task.status = 'done';
          task.result = { created: Math.floor(Date.now() / 1000), data: [{ url: videoUrl, revised_prompt: bt.prompt }] };
          wsManager.broadcast(taskId, task);
        })
        .catch((err: Error) => {
          task.status = 'error';
          task.error = err.message;
          wsManager.broadcast(taskId, task);
        });
    }
    res.json({ taskIds });
  } catch (error: unknown) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// GET /api/task/:taskId - 轮询任务状态 (兼容旧版前端)
app.get('/api/task/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  const elapsed = Math.floor((Date.now() - task.startTime) / 1000);
  if (task.status === 'done') {
    res.json({ status: 'done', elapsed, result: task.result });
    setTimeout(() => tasks.delete(task.id), 300000);
    return;
  }
  if (task.status === 'error') {
    res.json({ status: 'error', elapsed, error: task.error });
    setTimeout(() => tasks.delete(task.id), 300000);
    return;
  }
  res.json({ status: 'processing', elapsed, progress: task.progress });
});

// GET /api/history - 获取历史记录
app.get('/api/history', (_req, res) => {
  res.json({ records: historyRecords });
});

// DELETE /api/history/:id - 删除历史记录
app.delete('/api/history/:id', (req, res) => {
  const idx = historyRecords.findIndex((r) => r.id === req.params.id);
  if (idx >= 0) historyRecords.splice(idx, 1);
  res.json({ success: true });
});

// GET /api/presets - 获取预设模板
app.get('/api/presets', (_req, res) => {
  res.json({ presets: DEFAULT_PRESETS });
});

// ============================================================
// 敏感词 API
// ============================================================

// GET /api/sensitive-words - 获取敏感词库
app.get('/api/sensitive-words', (_req, res) => {
  res.json(getWordsDetail());
});

// POST /api/sensitive-words/check - 检查文本中的敏感词
app.post('/api/sensitive-words/check', (req, res) => {
  const { text } = req.body;
  const hits = checkText(text || '');
  res.json({ hits, clean: hits.length === 0 });
});

// POST /api/sensitive-words/sanitize - 替换文本中的敏感词
app.post('/api/sensitive-words/sanitize', (req, res) => {
  const { text } = req.body;
  const result = sanitizeText(text || '');
  res.json(result);
});

// POST /api/sensitive-words/add - 手动添加敏感词
app.post('/api/sensitive-words/add', (req, res) => {
  const { words } = req.body;
  if (!Array.isArray(words)) return res.status(400).json({ error: 'words 必须是数组' });
  const added = addManualWords(words);
  res.json({ added, total: getWordsDetail().total });
});

// DELETE /api/sensitive-words/:word - 删除敏感词
app.delete('/api/sensitive-words/:word', (req, res) => {
  const removed = removeWord(decodeURIComponent(req.params.word));
  res.json({ removed });
});

// POST /api/sensitive-words/confirm - 确认候选敏感词
app.post('/api/sensitive-words/confirm', (req, res) => {
  const { word } = req.body;
  const confirmed = confirmLearnedWord(word);
  res.json({ confirmed });
});

// ============================================================
// 角色设定图生成 API
// ============================================================

// POST /api/generate-character-sheet - 生成角色设定图（三视图等）
app.post('/api/generate-character-sheet', async (req, res) => {
  try {
    const { prompt, negativePrompt, sessionId } = req.body;
    const authToken = sessionId || DEFAULT_SESSION_ID;
    
    if (!authToken) {
      return res.status(401).json({ error: '未配置 Session ID' });
    }
    
    if (!prompt) {
      return res.status(400).json({ error: '缺少 prompt 参数' });
    }

    // 构建完整的生成提示词（包含负面提示词）
    const fullPrompt = negativePrompt 
      ? `${prompt}. Negative prompt: ${negativePrompt}`
      : prompt;

    console.log('[CharacterSheet] 生成角色设定图:', fullPrompt.substring(0, 100) + '...');

    // 调用图片生成服务（1:1 方形画布，适合角色设定图）
    const results = await generateImage(fullPrompt, authToken, {
      width: 1024,
      height: 1024,
      count: 1,
      style: '', // 风格已包含在 prompt 中
    });

    if (results.length === 0) {
      throw new Error('生成失败，未返回图片');
    }

    // 下载到本地
    const localFilename = await downloadImageToLocal(
      results[0].imageUrl,
      authToken,
      'char_sheet',
      'character-sheets'
    );

    const localUrl = `/api/images/${localFilename}`;
    console.log('[CharacterSheet] 设定图已保存:', localUrl);

    res.json({
      success: true,
      imageUrl: localUrl,
      originalUrl: results[0].imageUrl,
    });
  } catch (error) {
    console.error('[CharacterSheet] 生成失败:', error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : '生成失败' 
    });
  }
});

// ============================================================
// LLM 配置 API
// ============================================================

app.get('/api/llm-config', (_req, res) => {
  const config = getLLMConfig();
  res.json({ ...config, apiKey: config.apiKey ? '***' : '' }); // 隐藏 key
});

app.post('/api/llm-config', (req, res) => {
  const { provider, apiKey, apiUrl, model, maxTokens, temperature } = req.body;
  updateLLMConfig({ provider, apiKey, apiUrl, model, maxTokens, temperature });
  // 持久化到数据库
  saveLLMConfigToDB({ provider, apiKey, apiUrl, model, maxTokens, temperature });
  res.json({ success: true });
});

// Vision LLM 配置（AI 图片审查）
app.get('/api/llm-config/vision', (_req, res) => {
  const config = getVisionLLMConfig();
  res.json({ ...config, apiKey: config.apiKey ? '***' : '', configured: hasVisionConfig() });
});

app.post('/api/llm-config/vision', (req, res) => {
  const { provider, apiKey, apiUrl, model, maxTokens, temperature } = req.body;
  updateVisionLLMConfig({ provider, apiKey, apiUrl, model, maxTokens, temperature });
  saveVisionConfigToDB({ provider, apiKey, apiUrl, model, maxTokens, temperature });
  res.json({ success: true });
});

// 额外 LLM 配置池（多 API Key 并发）
app.get('/api/llm-config/extra', (_req, res) => {
  const configs = getExtraConfigs().map(c => ({ ...c, apiKey: c.apiKey ? '***' : '' }));
  res.json({ configs });
});

app.post('/api/llm-config/extra', (req, res) => {
  const { configs } = req.body as { configs: LLMConfig[] };
  if (!Array.isArray(configs)) return res.status(400).json({ error: '无效配置' });
  setExtraConfigs(configs);
  saveExtraConfigsToDB(configs.map(c => ({ ...c })));
  res.json({ success: true });
});

// NSFW 模式开关
app.get('/api/nsfw', (_req, res) => {
  res.json({ enabled: isNSFWEnabled() });
});

app.post('/api/nsfw', (req, res) => {
  const { enabled } = req.body;
  setNSFWEnabled(!!enabled);
  res.json({ success: true, enabled: isNSFWEnabled() });
});

// POST /api/llm-test - 测试 LLM 连接
app.post('/api/llm-test', async (_req, res) => {
  const { chatCompletion } = await import('./llm-service.js');
  const result = await chatCompletion('你是一个测试助手。', '请回复"连接成功"四个字。');
  res.json({
    success: result.success,
    duration: result.duration?.toFixed(1),
    error: result.error,
    preview: result.content?.substring(0, 100),
  });
});

// ============================================================
// 小说转短剧 API（LLM 直接调用版）
// ============================================================

// POST /api/drama/create - 创建短剧项目
app.post('/api/drama/create', (req, res) => {
  const { targetEpisodes = 20, style = '水墨武侠风格', ratio = '16:9', episodeDuration = 15 } = req.body;
  const id = crypto.randomUUID();
  const project = createProject(id, targetEpisodes, style, ratio, episodeDuration);
  res.json({ project });
});

// GET /api/drama/list - 列出所有短剧项目
app.get('/api/drama/list', (_req, res) => {
  res.json({ projects: listProjects() });
});

// GET /api/drama/:id - 获取项目详情
app.get('/api/drama/:id', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  res.json({ project });
});

// DELETE /api/drama/:id - 删除项目
app.delete('/api/drama/:id', (req, res) => {
  removeProject(req.params.id);
  res.json({ success: true });
});

// GET /api/drama/:id/logs - 获取项目 LLM 调用日志
app.get('/api/drama/:id/logs', (req, res) => {
  res.json({ logs: getProjectLogs(req.params.id) });
});

// POST /api/drama/:id/analyze - 第1步：LLM 自动分析小说（支持 JSON body 或文件上传）
// JSON body: { novelText: "..." }
// 文件上传: multipart/form-data, field name "novel"
const novelUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
app.post('/api/drama/:id/analyze', novelUpload.single('novel'), async (req, res) => {
  // 从 JSON body 或上传文件获取小说文本
  let novelText = '';
  if (req.file) {
    novelText = req.file.buffer.toString('utf-8');
    console.log(`[drama] 通过文件上传接收小说: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB, ${novelText.length} 字)`);
  } else if (typeof req.body?.novelText === 'string') {
    novelText = req.body.novelText;
  }
  if (!novelText) return res.status(400).json({ error: '请提供小说文本或上传 .txt 文件' });

  const projectId = req.params.id as string;
  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  const progressTaskId = `analyze_${projectId}`;
  // 短文本（< 5万字）同步处理，长文本异步处理
  if (novelText.length < 50000) {
    const result = await analyzeNovel(projectId, novelText);
    if (!result.success) return res.status(500).json({ error: result.error });
    res.json({ project: result.project });
  } else {
    // 长文本：立即返回，后台异步处理
    res.json({ async: true, progressTaskId, message: `小说 ${(novelText.length / 10000).toFixed(1)} 万字，正在后台分析...` });

    // 后台执行（novelText 传入后由 analyzeNovel 内部处理，不再长期持有引用）
    analyzeNovel(projectId, novelText, (step, detail) => {
      const task: TaskInfo = {
        id: progressTaskId, status: 'processing', progress: `[${step}] ${detail}`,
        startTime: Date.now(), result: null, error: null,
      };
      wsManager.broadcast(progressTaskId, task);
    }).then((result) => {
      const task: TaskInfo = {
        id: progressTaskId,
        status: result.success ? 'done' : 'error',
        progress: result.success ? '分析完成' : '',
        startTime: Date.now(), result: null,
        error: result.success ? null : (result.error || '分析失败'),
      };
      wsManager.broadcast(progressTaskId, task);
    });
  }
});

// POST /api/drama/:id/copyright - 第2步：LLM 自动版权改造
app.post('/api/drama/:id/copyright', async (req, res) => {
  const result = await transformCopyright(req.params.id);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ project: result.project });
});

// POST /api/drama/:id/refresh-prompts - 刷新 visualPrompt
app.post('/api/drama/:id/refresh-prompts', async (req, res) => {
  const result = await refreshVisualPrompts(req.params.id);
  if (!result.success) return res.status(500).json({ error: result.error });
  const project = getProject(req.params.id);
  res.json({ success: true, project });
});

// POST /api/drama/:id/refresh-summary - 重新生成标题和摘要
app.post('/api/drama/:id/refresh-summary', async (req, res) => {
  const result = await refreshTitleAndSummary(req.params.id);
  if (!result.success) return res.status(500).json({ error: result.error });
  const project = getProject(req.params.id);
  res.json({ success: true, project });
});

// POST /api/drama/:id/generate-character-images - 角色档案图生成（新版：专业三视图设定图）
app.post('/api/drama/:id/generate-character-images', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const { sessionId, characterId } = req.body;
  const authToken = sessionId || DEFAULT_SESSION_ID;
  if (!authToken) return res.status(401).json({ error: '未配置 Session ID' });

  const character = project.novel.characters.find((c: CharacterInfo) => c.id === characterId);
  if (!character) return res.status(404).json({ error: '角色不存在' });

  const taskId = `charimg_${req.params.id}_${characterId}`;
  res.json({ taskId, characterId });

  // 辅助：下载图片到本地（带重试）
  const downloadWithRetry = async (imageUrl: string, prefix: string): Promise<string | null> => {
    const subDir = getProjectImageSubDir(project, 'characters', character.newName);
    try {
      const filename = await downloadImageToLocal(imageUrl, authToken, prefix, subDir);
      return `/api/images/${filename}`;
    } catch (err) {
      console.log(`[image-gen] 下载失败: ${(err as Error).message}，重试...`);
      try {
        await new Promise(r => setTimeout(r, 2000));
        const filename = await downloadImageToLocal(imageUrl, authToken, prefix, subDir);
        return `/api/images/${filename}`;
      } catch { return null; }
    }
  };

  // 辅助：广播进度
  const broadcast = (status: string, progress: Record<string, unknown>) => {
    wsManager.broadcast(taskId, {
      id: taskId, status, startTime: Date.now(), result: null, error: null,
      progress: JSON.stringify({ characterId, ...progress }),
    } as TaskInfo);
  };

  (async () => {
    const projectId = req.params.id;
    
    // === 新版：生成专业角色设定图（包含三视图） ===
    broadcast('processing', { phase: 'sheet', done: 0, total: 3, msg: '生成角色设定图（三视图+表情）...' });
    updateCharacterFields(projectId, characterId, { profileStatus: 'main_generating' });

    // 生成包含三视图和表情的设定图
    const sheetImage = await generateCharacterSheetImage(
      character.newName,
      character.description,
      project.style,
      authToken,
      character.visualPrompt,
      character.refImageUrl,
      ['three-view', 'expressions'], // 默认生成三视图+表情
    );

    // 下载设定图到本地
    const sheetLocalUrl = await downloadWithRetry(sheetImage.imageUrl, `char_${characterId}_sheet`);
    if (!sheetLocalUrl) throw new Error('设定图下载失败');

    broadcast('processing', { phase: 'detail', done: 1, total: 3, msg: '生成单独角度参考图...' });
    updateCharacterFields(projectId, characterId, { profileStatus: 'detail_generating' });

    // === 生成单独的正面、侧面、背面图（用于分镜参考） ===
    const detailTypes: ProfileImageType[] = ['front', 'side', 'back'];
    const profileImages: Record<string, string> = { main: sheetLocalUrl };
    const allImageUrls: string[] = [sheetLocalUrl];

    for (let i = 0; i < detailTypes.length; i++) {
      const type = detailTypes[i];
      const typeLabels: Record<string, string> = { front: '正面', side: '侧面', back: '背面' };
      
      broadcast('processing', { 
        phase: 'detail', 
        done: i + 2, 
        total: 3, 
        msg: `生成${typeLabels[type] || '细节'}图...` 
      });

      try {
        const detailResults = await generateCharacterDetailImages(
          character.newName,
          character.description,
          project.style,
          authToken,
          character.visualPrompt,
          [type],
        );

        if (detailResults.length > 0 && detailResults[0].images.length > 0) {
          const url = await downloadWithRetry(
            detailResults[0].images[0].imageUrl, 
            `char_${characterId}_${type}`
          );
          if (url) {
            profileImages[type] = url;
            allImageUrls.push(url);
          }
        }
      } catch (err) {
        console.error(`[image-gen] ${typeLabels[type]}图生成失败: ${(err as Error).message}`);
        // 继续生成其他角度
      }
    }

    // 最终更新：标记完成并确认
    updateCharacterFields(projectId, characterId, {
      imageUrls: allImageUrls,
      profileImages,
      profileStatus: 'done',
      confirmed: true,
    });

    // 检查是否所有主角/配角都已确认
    const freshProject = getProject(projectId);
    if (freshProject) {
      const mainChars = freshProject.novel.characters.filter((c: CharacterInfo) => c.role !== 'minor');
      const allConfirmed = mainChars.every((c: CharacterInfo) => c.confirmed);
      if (allConfirmed) updateProject(projectId, { status: 'scripting' });
    }

    broadcast('done', { phase: 'done', done: 3, total: 3, imageUrls: allImageUrls, profileImages });
  })().catch((err: Error) => {
    updateCharacterFields(req.params.id, characterId, { profileStatus: 'idle' });
    wsManager.broadcast(taskId, {
      id: taskId, status: 'error', startTime: Date.now(), result: null, error: err.message,
      progress: JSON.stringify({ characterId }),
    } as TaskInfo);
  });
});

// POST /api/drama/:id/confirm-character - 确认角色
app.post('/api/drama/:id/confirm-character', (req, res) => {
  const { characterId, selectedImageUrls } = req.body;

  // 确认前获取角色的所有图片，用于清理未选中的
  const projectBefore = getProject(req.params.id);
  const charBefore = projectBefore?.novel.characters.find((c: CharacterInfo) => c.id === characterId);
  const allUrls = charBefore?.imageUrls || [];

  const result = confirmCharacter(req.params.id, characterId, selectedImageUrls);
  if (!result.success) return res.status(400).json({ error: result.error });

  // 删除未选中的本地图片
  if (selectedImageUrls && Array.isArray(selectedImageUrls)) {
    const selectedSet = new Set(selectedImageUrls);
    for (const url of allUrls) {
      if (!selectedSet.has(url) && isLocalImageUrl(url)) {
        deleteLocalImage(localUrlToFilename(url));
      }
    }
  }

  res.json({ confirmed: true, allConfirmed: result.allConfirmed, characterId });
});

// POST /api/drama/:id/confirm-location-image - 确认场景图（从候选中选1张）
app.post('/api/drama/:id/confirm-location-image', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const { locationId, selectedImageUrl } = req.body;
  const loc = project.novel.locations.find((l: LocationInfo) => l.id === locationId);
  if (!loc) return res.status(404).json({ error: '场景不存在' });

  const allUrls = loc.imageUrls || [];
  updateLocationFields(req.params.id, locationId, { imageUrl: selectedImageUrl, imageUrls: undefined });

  // 删除未选中的本地图片
  for (const url of allUrls) {
    if (url !== selectedImageUrl && isLocalImageUrl(url)) {
      deleteLocalImage(localUrlToFilename(url));
    }
  }

  res.json({ success: true, locationId });
});

// POST /api/drama/:id/repair-images - 从磁盘扫描恢复丢失的图片关联
app.post('/api/drama/:id/repair-images', (req, res) => {
  const result = repairProjectImages(req.params.id);
  res.json(result);
});

// POST /api/drama/:id/upload-char-ref-image - 上传角色参考图
const charRefUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
app.post('/api/drama/:id/upload-char-ref-image', charRefUpload.single('file'), async (req, res) => {
  const projectId = req.params.id as string;
  const project = getProject(projectId);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const characterId = String(req.body?.characterId || '');
  if (!characterId) return res.status(400).json({ error: '缺少 characterId' });
  if (!req.file) return res.status(400).json({ error: '缺少图片文件' });

  const character = project.novel.characters.find((c: CharacterInfo) => c.id === characterId);
  if (!character) return res.status(404).json({ error: '角色不存在' });

  try {
    // 保存到本地 data/images/{projectId}/characters/
    const filename = `charref_${characterId}_${crypto.randomUUID().substring(0, 8)}.jpg`;
    const subDir = `${projectId}/characters`;
    const imagesDir = path.join(__dirname, '../../data/images', subDir);
    if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });
    fs.writeFileSync(path.join(imagesDir, filename), req.file.buffer);
    const localUrl = `/api/images/${subDir}/${filename}`;

    // 删除旧参考图
    const oldRef = (character as CharacterInfo & { refImageUrl?: string }).refImageUrl;
    if (oldRef && isLocalImageUrl(oldRef)) deleteLocalImage(localUrlToFilename(oldRef));

    // 更新角色数据
    updateCharacterRefImage(projectId, characterId, localUrl);
    res.json({ success: true, refImageUrl: localUrl });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/drama/:id/remove-char-ref-image - 删除角色参考图
app.post('/api/drama/:id/remove-char-ref-image', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const { characterId } = req.body;
  const character = project.novel.characters.find((c: CharacterInfo) => c.id === characterId);
  if (!character) return res.status(404).json({ error: '角色不存在' });

  const oldRef = (character as CharacterInfo & { refImageUrl?: string }).refImageUrl;
  if (oldRef && isLocalImageUrl(oldRef)) deleteLocalImage(localUrlToFilename(oldRef));
  updateCharacterRefImage(req.params.id, characterId, undefined);
  res.json({ success: true });
});

// POST /api/drama/:id/generate-location-image - 生成场景图（异步+WebSocket进度）
app.post('/api/drama/:id/generate-location-image', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const { sessionId, locationId } = req.body;
  const authToken = sessionId || DEFAULT_SESSION_ID;
  if (!authToken) return res.status(401).json({ error: '未配置 Session ID' });

  const location = project.novel.locations.find((l: LocationInfo) => l.id === locationId);
  if (!location) return res.status(404).json({ error: '场景不存在' });

  const taskId = `locimg_${req.params.id}_${locationId}`;
  res.json({ taskId, locationId });

  // 后台异步生成（优先使用 baseVisualPrompt 保证场景一致性）
  const prompt = location.baseVisualPrompt || location.visualPrompt || `${project.style}, ${location.description}`;
  generateImage(prompt, authToken, { width: 1280, height: 720, count: 4, style: project.style })
    .then(async (images) => {
      if (images.length > 0) {
        const projectId = req.params.id;
        // 下载所有图片到本地
        const localUrls: string[] = [];
        for (let idx = 0; idx < images.length; idx++) {
          try {
            const filename = await downloadImageToLocal(images[idx].imageUrl, authToken, `loc_${locationId}_${idx}`, getProjectImageSubDir(project, 'locations', location.newName));
            localUrls.push(`/api/images/${filename}`);
          } catch (err) {
            console.log(`[image-gen] 下载场景图 ${idx} 失败: ${(err as Error).message}，重试...`);
            try {
              await new Promise(r => setTimeout(r, 2000));
              const filename = await downloadImageToLocal(images[idx].imageUrl, authToken, `loc_${locationId}_${idx}`, getProjectImageSubDir(project, 'locations', location.newName));
              localUrls.push(`/api/images/${filename}`);
            } catch {
              console.log(`[image-gen] 场景图 ${idx} 下载最终失败，跳过`);
            }
          }
        }
        if (localUrls.length === 0) throw new Error('所有场景图下载失败');

        // 从 DB 读取最新数据来删除旧图片（避免用旧快照）
        const freshProject = getProject(projectId);
        const freshLoc = freshProject?.novel.locations.find((l: LocationInfo) => l.id === locationId);
        if (freshLoc?.imageUrl && isLocalImageUrl(freshLoc.imageUrl)) {
          deleteLocalImage(localUrlToFilename(freshLoc.imageUrl));
        }
        if (freshLoc?.imageUrls) {
          for (const oldUrl of freshLoc.imageUrls) {
            if (isLocalImageUrl(oldUrl)) deleteLocalImage(localUrlToFilename(oldUrl));
          }
        }

        // 自动评分选择最佳场景图
        let bestUrl: string | undefined;
        try {
          console.log(`[vision] 开始自动评分场景 "${location.newName}" 的 ${localUrls.length} 张图片...`);
          const result = await autoSelectBestImage(
            'location', location.newName, location.description,
            location.baseVisualPrompt || location.visualPrompt || '', localUrls,
          );
          bestUrl = result.bestUrl;
          console.log(`[vision] 场景 "${location.newName}" 自动确认: ${bestUrl} (${result.scores[0]?.score || 'N/A'}分, ${result.scores[0]?.reason || ''})`);
        } catch (err) {
          console.log(`[vision] 场景自动评分失败，保留手动选择: ${(err as Error).message}`);
        }

        // 原子更新场景字段
        updateLocationFields(projectId, locationId, {
          imageUrls: localUrls,
          imageUrl: bestUrl,
        });

        const doneTask: TaskInfo = {
          id: taskId, status: 'done', startTime: Date.now(), result: null, error: null,
          progress: JSON.stringify({ locationId, imageUrls: localUrls }),
        };
        wsManager.broadcast(taskId, doneTask);
      }
    })
    .catch((err: Error) => {
      const errTask: TaskInfo = {
        id: taskId, status: 'error', startTime: Date.now(), result: null, error: err.message,
        progress: JSON.stringify({ locationId }),
      };
      wsManager.broadcast(taskId, errTask);
    });
});

// POST /api/drama/:id/generate-script - 第3步：LLM 自动生成分镜脚本（异步+WebSocket进度）
app.post('/api/drama/:id/generate-script', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  // 敏感词检查
  const allNames = [
    ...project.novel.characters.map((c: CharacterInfo) => c.newName),
    ...project.novel.locations.map(l => l.newName),
    project.novel.title, project.novel.summary,
  ].join(' ');
  const sensitiveHits = checkText(allNames);
  if (sensitiveHits.length > 0) {
    return res.status(400).json({ error: `项目内容包含敏感词: ${sensitiveHits.join(', ')}`, sensitiveWords: sensitiveHits });
  }

  const taskId = `script_${req.params.id}`;
  res.json({ taskId, async: true });

  // 后台异步执行，通过 WebSocket 推送进度
  generateScript(req.params.id, (progress) => {
    const progressTask: TaskInfo = {
      id: taskId, status: 'processing', startTime: Date.now(), result: null, error: null, progress,
    };
    wsManager.broadcast(taskId, progressTask);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error', startTime: Date.now(),
      result: null, error: result.success ? null : (result.error || '脚本生成失败'),
      progress: result.success ? '脚本生成完成' : '',
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/drama/:id/update-episodes - 更新集脚本内容
app.post('/api/drama/:id/update-episodes', (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const { episodes } = req.body;
  if (!Array.isArray(episodes)) return res.status(400).json({ error: 'episodes 必须是数组' });
  updateProject(req.params.id, { episodes });
  res.json({ success: true });
});

// POST /api/drama/:id/optimize-scripts - 创意优化脚本（异步+WebSocket进度）
app.post('/api/drama/:id/optimize-scripts', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  if (project.episodes.length === 0) return res.status(400).json({ error: '无脚本可优化' });

  const taskId = `optimize_${req.params.id}`;
  res.json({ taskId, async: true });

  optimizeScripts(req.params.id, (progress) => {
    const progressTask: TaskInfo = {
      id: taskId, status: 'processing', startTime: Date.now(), result: null, error: null, progress,
    };
    wsManager.broadcast(taskId, progressTask);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error', startTime: Date.now(),
      result: null, error: result.success ? null : (result.error || '优化失败'), progress: result.success ? '创意优化完成' : '',
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/drama/:id/optimize-single - 单集创意优化
app.post('/api/drama/:id/optimize-single', async (req, res) => {
  const { episodeNumber } = req.body;
  if (typeof episodeNumber !== 'number') return res.status(400).json({ error: '缺少 episodeNumber' });

  const result = await optimizeSingleEpisode(req.params.id, episodeNumber);
  if (!result.success) return res.status(500).json({ error: result.error });

  const project = getProject(req.params.id);
  res.json({ success: true, project });
});

// POST /api/drama/:id/regenerate-shots - 单集分镜重新生成
app.post('/api/drama/:id/regenerate-shots', async (req, res) => {
  const { episodeNumber } = req.body;
  if (typeof episodeNumber !== 'number') return res.status(400).json({ error: '缺少 episodeNumber' });

  const result = await regenerateEpisodeShots(req.params.id, episodeNumber);
  if (!result.success) return res.status(500).json({ error: result.error });

  const project = getProject(req.params.id);
  res.json({ success: true, project });
});

// POST /api/drama/:id/regenerate-ep-ref-images - 单集参考图重新生成
app.post('/api/drama/:id/regenerate-ep-ref-images', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const { episodeNumber, sessionId } = req.body;
  if (typeof episodeNumber !== 'number') return res.status(400).json({ error: '缺少 episodeNumber' });
  const authToken = sessionId || DEFAULT_SESSION_ID;
  if (!authToken) return res.status(401).json({ error: '未配置 Session ID' });

  const episode = project.episodes.find(ep => ep.number === episodeNumber);
  if (!episode) return res.status(404).json({ error: `第 ${episodeNumber} 集不存在` });

  try {
    const refUrls = await generateEpisodeRefImages(project, episode, authToken);
    episode.refImageUrls = refUrls;
    updateProject(req.params.id, { episodes: project.episodes });
    res.json({ success: true, project: getProject(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/drama/:id/generate-ref-images - 为每集生成专属参考图（异步+WebSocket进度）
app.post('/api/drama/:id/generate-ref-images', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  if (project.episodes.length === 0) return res.status(400).json({ error: '无脚本' });

  const { sessionId } = req.body;
  const authToken = sessionId || DEFAULT_SESSION_ID;
  if (!authToken) return res.status(401).json({ error: '未配置 Session ID' });

  const taskId = `refimg_${req.params.id}`;
  res.json({ taskId, async: true });

  batchGenerateRefImages(req.params.id, authToken, (progress) => {
    const progressTask: TaskInfo = {
      id: taskId, status: 'processing', startTime: Date.now(), result: null, error: null, progress,
    };
    wsManager.broadcast(taskId, progressTask);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error', startTime: Date.now(),
      result: null, error: result.success ? null : (result.error || '参考图生成失败'),
      progress: result.success ? '参考图生成完成' : '',
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/drama/:id/auto-generate-image - 为集数自动生成参考图
app.post('/api/drama/:id/auto-generate-image', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const { sessionId, episodeNumber, prompt: customPrompt } = req.body;
  const authToken = sessionId || DEFAULT_SESSION_ID;
  if (!authToken) return res.status(401).json({ error: '未配置 Session ID' });

  const episode = project.episodes.find(e => e.number === episodeNumber);
  if (!episode) return res.status(404).json({ error: '集数不存在' });

  try {
    const genPrompt = customPrompt || episode.prompt.split('\n')[0];
    const images = await generateImage(genPrompt, authToken, { width: 1280, height: 720, count: 1, style: project.style });
    res.json({ images, episodeNumber });
  } catch (err) {
    res.status(500).json({ error: `生图失败: ${(err as Error).message}` });
  }
});

// POST /api/drama/:id/batch-generate - 阶段3：批量视频生成（逐集串行）
app.post('/api/drama/:id/batch-generate', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  if (project.episodes.length === 0) return res.status(400).json({ error: '无脚本可生成，请先完成阶段1和阶段2' });

  const { sessionId } = req.body;
  const authToken = sessionId || DEFAULT_SESSION_ID;
  if (!authToken) return res.status(401).json({ error: '未配置 Session ID' });

  // 用项目ID作为 WebSocket 订阅 key
  const batchTaskId = `batch_${req.params.id}`;
  res.json({ batchTaskId, totalEpisodes: project.episodes.length });

  // 后台异步执行批量生成，通过 WebSocket 推送进度
  batchGenerateVideos(req.params.id, authToken, tasks, (_episode, _total, status, detail) => {
    // 构造进度消息并广播
    const progressTask: TaskInfo = {
      id: batchTaskId,
      status: status === 'complete' ? 'done' : status === 'error' ? 'processing' : 'processing',
      progress: detail || '',
      startTime: Date.now(),
      result: null,
      error: null,
    };
    // 广播给订阅了 batchTaskId 的前端
    wsManager.broadcast(batchTaskId, progressTask);
  }).then(() => {
    // 全部完成，发送最终状态
    const finalProject = getProject(req.params.id);
    const doneCount = finalProject?.episodes.filter(e => e.videoStatus === 'done').length || 0;
    const totalCount = finalProject?.episodes.length || 0;
    const finalTask: TaskInfo = {
      id: batchTaskId,
      status: 'done',
      progress: `批量生成完成: ${doneCount}/${totalCount} 集成功`,
      startTime: Date.now(),
      result: null,
      error: null,
    };
    wsManager.broadcast(batchTaskId, finalTask);
  }).catch((err: Error) => {
    const errTask: TaskInfo = {
      id: batchTaskId,
      status: 'error',
      progress: '',
      startTime: Date.now(),
      result: null,
      error: err.message,
    };
    wsManager.broadcast(batchTaskId, errTask);
  });
});

// GET /api/video-proxy - 代理视频流
app.get('/api/video-proxy', async (req, res) => {
  const videoUrl = req.query.url as string;
  if (!videoUrl) return res.status(400).json({ error: '缺少 url 参数' });
  try {
    console.log(`[video-proxy] 代理视频: ${videoUrl.substring(0, 100)}...`);
    const response = await fetch(videoUrl, {
      headers: { 'User-Agent': FAKE_HEADERS['User-Agent'], Referer: 'https://jimeng.jianying.com/' },
    });
    if (!response.ok) return res.status(response.status).json({ error: `视频获取失败: ${response.status}` });

    const contentType = response.headers.get('content-type');
    if (contentType) res.setHeader('Content-Type', contentType);
    const contentLength = response.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');

    const reader = response.body!.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        if (!res.write(value)) await new Promise((r) => res.once('drain', r));
      }
    };
    pump().catch((err: Error) => {
      console.error(`[video-proxy] 流传输错误: ${err.message}`);
      if (!res.headersSent) res.status(500).end();
      else res.end();
    });
  } catch (error: unknown) {
    console.error(`[video-proxy] 错误: ${(error as Error).message}`);
    if (!res.headersSent) res.status(500).json({ error: '视频代理失败' });
  }
});

// GET /api/thumbnail-proxy - 视频缩略图代理
app.get('/api/thumbnail-proxy', async (req, res) => {
  const videoUrl = req.query.url as string;
  if (!videoUrl) return res.status(400).json({ error: '缺少 url 参数' });
  // 返回视频代理URL，前端用 video 元素截取第一帧
  res.json({ proxyUrl: `/api/video-proxy?url=${encodeURIComponent(videoUrl)}` });
});

// POST /api/upload-material - 通用素材上传（保存到本地 data/materials 目录）
const materialUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
app.post('/api/upload-material', materialUpload.array('files', 20), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) return res.status(400).json({ error: '未上传文件' });
    const materialsDir = path.join(__dirname, '../../data/materials');
    const fs = await import('fs');
    if (!fs.existsSync(materialsDir)) fs.mkdirSync(materialsDir, { recursive: true });
    const urls: string[] = [];
    for (const file of files) {
      const ext = path.extname(file.originalname) || '.png';
      const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
      const filepath = path.join(materialsDir, filename);
      fs.writeFileSync(filepath, file.buffer);
      urls.push(`/api/material/${filename}`);
    }
    res.json({ urls });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// GET /api/material/:filename - 提供素材文件
app.get('/api/material/:filename', (req, res) => {
  const materialsDir = path.join(__dirname, '../../data/materials');
  const filepath = path.join(materialsDir, req.params.filename);
  res.sendFile(filepath);
});

// GET /api/materials - 列出所有已上传素材
app.get('/api/materials', async (_req, res) => {
  try {
    const materialsDir = path.join(__dirname, '../../data/materials');
    const fs = await import('fs');
    if (!fs.existsSync(materialsDir)) return res.json({ files: [] });
    const files = fs.readdirSync(materialsDir).map(f => ({
      name: f,
      url: `/api/material/${f}`,
      size: fs.statSync(path.join(materialsDir, f)).size,
    }));
    res.json({ files });
  } catch { res.json({ files: [] }); }
});

// DELETE /api/material/:filename - 删除已上传素材
app.delete('/api/material/:filename', (req, res) => {
  try {
    const materialsDir = path.join(__dirname, '../../data/materials');
    const filepath = path.join(materialsDir, req.params.filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: '文件不存在' });
    }
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// multer 错误处理
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '文件大小超过限制 (最大20MB)' });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: '文件数量超过限制 (最多5个)' });
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  }
  res.status(500).json({ error: err.message || '服务器内部错误' });
});

// ============================================================
// 剧本创建 API
// ============================================================

// GET /api/screenplay/genres - 获取题材列表
app.get('/api/screenplay/genres', (_req, res) => {
  res.json({ genres: getGenreList() });
});

// POST /api/screenplay/create - 创建剧本项目
app.post('/api/screenplay/create', (req, res) => {
  const { genres, audience, tone, endingType, totalEpisodes, language, mode, customPrompt, agentId, referenceNovel, fixedModel, nsfw, useCharacterPool, useTimeline } = req.body;
  if (!genres?.length || !audience || !tone || !totalEpisodes) {
    return res.status(400).json({ error: '缺少必要参数' });
  }
  // nsfw 由项目级配置控制，全局开关在设置中管理
  const result = createScreenplay({
    genres, audience, tone, endingType: endingType || 'HE',
    totalEpisodes, language: language || 'zh-CN', mode: mode || 'domestic', customPrompt,
    agentId: agentId || undefined,
    referenceNovel: referenceNovel || undefined,
    useCharacterPool: useCharacterPool || false,
    useTimeline: useTimeline || false,
    fixedModel: fixedModel || undefined,
    nsfw: nsfw || false,
  });
  if ('error' in result) return res.status(400).json({ error: result.error });
  res.json({ project: result });
});

// GET /api/screenplay/list - 列出所有剧本项目
app.get('/api/screenplay/list', (_req, res) => {
  res.json({ projects: listScreenplays() });
});

// GET /api/screenplay/:id - 获取剧本详情
app.get('/api/screenplay/:id', (req, res) => {
  const project = getScreenplay(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  console.log(`[screenplay-api] GET /${req.params.id} status=${project.status} hasDirectory=${Array.isArray(project.episodeDirectory)} dirLen=${Array.isArray(project.episodeDirectory) ? project.episodeDirectory.length : typeof project.episodeDirectory}`);
  res.json({ project });
});

// DELETE /api/screenplay/:id - 删除剧本项目
app.delete('/api/screenplay/:id', (req, res) => {
  removeScreenplay(req.params.id);
  res.json({ success: true });
});

// POST /api/screenplay/:id/select-title - 选择剧名
app.post('/api/screenplay/:id/select-title', (req, res) => {
  const { title } = req.body;
  const project = updateScreenplay(req.params.id, { selectedTitle: title });
  if (!project) return res.status(404).json({ error: '项目不存在' });
  res.json({ project });
});

// POST /api/screenplay/:id/creative-plan - 生成创作方案
app.post('/api/screenplay/:id/creative-plan', async (req, res) => {
  const taskId = `sp_plan_${req.params.id}`;
  res.json({ async: true, taskId });

  const emitProgress = (msg: string) => {
    const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
    wsManager.broadcast(taskId, task);
  };

  // 如果有参考小说且尚未解析，先进行深度解析
  const project = getScreenplay(req.params.id);
  if (project?.config.referenceNovel && !project.config.novelAnalysis) {
    emitProgress('📖 检测到参考小说，开始深度解析...');
    const analysisResult = await analyzeReferenceNovel(req.params.id, project.config.referenceNovel, emitProgress);
    if (analysisResult.success && analysisResult.analysis) {
      updateScreenplay(req.params.id, { config: { ...project.config, novelAnalysis: analysisResult.analysis } });
    }
  }

  generateCreativePlan(req.params.id, emitProgress).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error',
      progress: result.success ? '创作方案生成完成' : '',
      startTime: Date.now(), result: null, error: result.success ? null : (result.error || '失败'),
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/screenplay/:id/characters - 生成角色设计
app.post('/api/screenplay/:id/characters', async (req, res) => {
  const taskId = `sp_chars_${req.params.id}`;
  res.json({ async: true, taskId });
  generateCharacters(req.params.id, (msg) => {
    const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
    wsManager.broadcast(taskId, task);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error',
      progress: result.success ? '角色开发完成' : '',
      startTime: Date.now(), result: null, error: result.success ? null : (result.error || '失败'),
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/screenplay/:id/directory - 生成分集目录
app.post('/api/screenplay/:id/directory', async (req, res) => {
  const taskId = `sp_dir_${req.params.id}`;
  res.json({ async: true, taskId });
  generateDirectory(req.params.id, (msg) => {
    const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
    wsManager.broadcast(taskId, task);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error',
      progress: result.success ? '分集目录生成完成' : '',
      startTime: Date.now(), result: null, error: result.success ? null : (result.error || '失败'),
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/screenplay/:id/episode - 生成单集剧本
app.post('/api/screenplay/:id/episode', async (req, res) => {
  const { episodeNumber } = req.body;
  if (typeof episodeNumber !== 'number') return res.status(400).json({ error: '缺少 episodeNumber' });
  const taskId = `sp_ep_${req.params.id}_${episodeNumber}`;
  res.json({ async: true, taskId });
  generateEpisode(req.params.id, episodeNumber, (msg) => {
    const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
    wsManager.broadcast(taskId, task);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error',
      progress: result.success ? `第${episodeNumber}集完成` : '',
      startTime: Date.now(), result: null, error: result.success ? null : (result.error || '失败'),
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/screenplay/:id/episode-batch - 批量生成剧本
app.post('/api/screenplay/:id/episode-batch', async (req, res) => {
  const { startEp, endEp } = req.body;
  if (typeof startEp !== 'number' || typeof endEp !== 'number') return res.status(400).json({ error: '缺少 startEp/endEp' });
  const taskId = `sp_batch_${req.params.id}`;
  res.json({ async: true, taskId });
  generateEpisodeBatch(req.params.id, startEp, endEp, (msg) => {
    const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
    wsManager.broadcast(taskId, task);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error',
      progress: result.success ? `已完成${result.completed.length}集` : `完成${result.completed.length}集，${result.errors.length}集失败`,
      startTime: Date.now(), result: null, error: result.errors.length > 0 ? result.errors.map(e => `第${e.episode}集: ${e.error}`).join('; ') : null,
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/screenplay/:id/retry-failed - 重试失败/缺失的分集
app.post('/api/screenplay/:id/retry-failed', async (req, res) => {
  const taskId = `sp_retry_${req.params.id}`;
  res.json({ async: true, taskId });
  retryFailedEpisodes(req.params.id, (msg) => {
    const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
    wsManager.broadcast(taskId, task);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error',
      progress: result.missing.length === 0
        ? '所有分集均已生成，无需重试'
        : result.success ? `已重新生成${result.completed.length}集` : `完成${result.completed.length}集，${result.errors.length}集仍失败`,
      startTime: Date.now(), result: null,
      error: result.errors.length > 0 ? result.errors.map(e => `第${e.episode}集: ${e.error}`).join('; ') : null,
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/screenplay/:id/review - 质量自检
app.post('/api/screenplay/:id/review', async (req, res) => {
  const { episodeNumber } = req.body;
  if (typeof episodeNumber !== 'number') return res.status(400).json({ error: '缺少 episodeNumber' });
  const result = await reviewEpisode(req.params.id, episodeNumber);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ review: result.review });
});

// POST /api/screenplay/:id/review-all - 一键全部自检优化（异步）
app.post('/api/screenplay/:id/review-all', (req, res) => {
  const projectId = req.params.id;
  const project = getScreenplay(projectId);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  if (!project.episodes?.length) return res.status(400).json({ error: '暂无剧集' });

  // skipReviewed=true 时跳过已有评审的集（断点续传）
  const skipReviewed = req.body?.skipReviewed === true;

  const taskId = `sp_review_all_${projectId}_${Date.now()}`;
  const task: TaskInfo = {
    id: taskId, status: 'processing', progress: '准备批量自检...',
    startTime: Date.now(), result: null, error: null,
  };
  tasks.set(taskId, task);
  res.json({ async: true, taskId });

  // 后台顺序执行每集自检+改写
  (async () => {
    // 过滤掉 number 无效的 episode，按集号排序确保顺序优化（保持前后集连贯性）
    const validEpisodes = project.episodes
      .filter(ep => typeof ep.number === 'number')
      .sort((a, b) => a.number - b.number);

    // 断点续传：跳过已有评审记录的集
    const toReview = skipReviewed
      ? validEpisodes.filter(ep => !project.reviews[ep.number])
      : validEpisodes;
    const total = toReview.length;
    const skipped = validEpisodes.length - total;
    let done = 0;
    const errors: string[] = [];

    if (skipped > 0) {
      console.log(`[screenplay] review-all 断点续传: 跳过 ${skipped} 集已评审，待优化 ${total} 集`);
    }

    const broadcastProgress = (msg: string, completedEp?: number, score?: number) => {
      task.progress = JSON.stringify({
        msg, currentEps: [], done, total,
        ...(completedEp != null ? { completedEp, score } : {}),
      });
      wsManager.broadcast(taskId, task);
    };

    if (total === 0) {
      task.status = 'done';
      task.progress = JSON.stringify({ msg: '所有集均已评审，无需优化', currentEps: [], done: 0, total: 0 });
      wsManager.broadcast(taskId, task);
      return;
    }

    // 顺序执行：按集号依次优化，确保每集改写时能看到前面已优化的版本
    for (const ep of toReview) {
      broadcastProgress(`正在优化第${ep.number}集 (${done}/${total})${skipped > 0 ? ` [已跳过${skipped}集]` : ''}...`);
      try {
        const result = await reviewEpisode(projectId, ep.number);
        done++;
        const score = result.review?.total;
        broadcastProgress(
          `第${ep.number}集完成 (${done}/${total})${score ? ` 评分:${score}/50` : ''}`,
          ep.number, score,
        );
      } catch (err) {
        errors.push(`第${ep.number}集: ${(err as Error).message}`);
        done++;
        broadcastProgress(`第${ep.number}集失败 (${done}/${total})`);
      }
    }

    task.status = 'done';
    task.progress = JSON.stringify({ msg: errors.length > 0
      ? `完成 ${total - errors.length}/${total} 集，${errors.length} 集失败`
      : `全部 ${total} 集自检优化完成${skipped > 0 ? `（跳过${skipped}集已评审）` : ''}`, currentEps: [], done: total, total });
    wsManager.broadcast(taskId, task);
  })();
});

// GET /api/screenplay/:id/review-status - 查询是否有正在运行的 review-all 任务
app.get('/api/screenplay/:id/review-status', (req, res) => {
  const projectId = req.params.id;
  const prefix = `sp_review_all_${projectId}_`;
  for (const [id, task] of tasks) {
    if (id.startsWith(prefix) && task.status === 'processing') {
      let progress: any = {};
      try { progress = JSON.parse(task.progress); } catch {}
      return res.json({ running: true, taskId: id, done: progress.done || 0, total: progress.total || 0, msg: progress.msg || '' });
    }
  }
  res.json({ running: false });
});

// POST /api/screenplay/:id/export - 导出剧本
app.post('/api/screenplay/:id/export', (_req, res) => {
  const result = exportScreenplay(_req.params.id);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ content: result.content });
});

// POST /api/screenplay/:id/submission - 生成投稿材料
app.post('/api/screenplay/:id/submission', async (req, res) => {
  const taskId = `submission_${req.params.id}_${Date.now()}`;
  try {
    const result = await generateSubmissionMaterials(req.params.id, (msg) => {
      const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
      wsManager.broadcast(taskId, task);
    });
    if (!result.success) return res.status(500).json({ error: result.error });
    res.json({ materials: result.materials });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// PATCH /api/screenplay/:id - 更新剧本项目（通用）
app.patch('/api/screenplay/:id', (req, res) => {
  const project = updateScreenplay(req.params.id, req.body);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  res.json({ project });
});

// ============================================================
// 创作工厂 API
// ============================================================

// POST /api/factory/create - 创建工厂项目
app.post('/api/factory/create', upload.single('novel'), (req, res) => {
  let novelText = '';
  if (req.file) {
    novelText = req.file.buffer.toString('utf-8');
  } else if (req.body?.novelText) {
    novelText = req.body.novelText;
  }
  if (!novelText || novelText.trim().length < 500) {
    return res.status(400).json({ error: '小说内容过短（至少500字）' });
  }
  const { concurrency, agentsPerGeneration, topK, fixedModel, nsfw } = req.body || {};
  const project = createFactory(novelText, {
    concurrency: concurrency ? parseInt(concurrency) : undefined,
    agentsPerGeneration: agentsPerGeneration ? parseInt(agentsPerGeneration) : undefined,
    topK: topK ? parseInt(topK) : undefined,
  });
  // 项目级锁定模型
  if (fixedModel?.apiKey) {
    project.fixedModel = fixedModel;
  }
  // 项目级 NSFW
  if (nsfw) project.nsfw = true;
  res.json({ project: { id: project.id, status: project.status, createdAt: project.createdAt } });
});

// GET /api/factory/list - 列出所有工厂项目
app.get('/api/factory/list', (_req, res) => {
  const projects = listFactories().map(p => ({
    id: p.id, status: p.status,
    title: p.novelDNA?.title || '未解析',
    genre: p.novelDNA?.genre || '',
    chapters: p.chapters.length,
    currentChapter: p.currentChapter,
    currentGeneration: p.currentGeneration,
    agentCount: p.agents.length,
    bestScore: p.evolutionHistory.length > 0
      ? p.evolutionHistory[p.evolutionHistory.length - 1].bestScore : 0,
    createdAt: p.createdAt, updatedAt: p.updatedAt,
  }));
  res.json({ projects });
});

// GET /api/factory/:id - 获取工厂详情
app.get('/api/factory/:id', (req, res) => {
  const project = getFactory(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  // 返回精简数据（agents太大，只返回top10和统计）
  const topAgents = [...project.agents]
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10)
    .map(a => ({ id: a.id, generation: a.generation, score: a.score, rank: a.rank, parentId: a.parentId, scoreHistory: a.scoreHistory }));
  res.json({
    project: {
      id: project.id, status: project.status,
      novelDNA: project.novelDNA,
      chapters: project.chapters.map(c => ({ number: c.number, title: c.title, wordCount: c.wordCount })),
      stages: (project.stages || []).map(s => ({ index: s.index, name: s.name, chapterRange: s.chapterRange })),
      currentChapter: project.currentChapter,
      currentGeneration: project.currentGeneration,
      totalAgents: project.agents.length,
      topAgents,
      evolutionHistory: project.evolutionHistory,
      finalAgent: project.finalAgent ? {
        id: project.finalAgent.id, generation: project.finalAgent.generation,
        score: project.finalAgent.score, scoreHistory: project.finalAgent.scoreHistory,
        mutationLog: project.finalAgent.mutationLog,
      } : undefined,
      concurrency: project.concurrency,
      agentsPerGeneration: project.agentsPerGeneration,
      topK: project.topK,
      createdAt: project.createdAt, updatedAt: project.updatedAt,
      error: project.error,
    },
  });
});

// DELETE /api/factory/:id - 删除工厂项目
app.delete('/api/factory/:id', (req, res) => {
  removeFactory(req.params.id);
  res.json({ success: true });
});

// POST /api/factory/:id/parse - 解析小说DNA
app.post('/api/factory/:id/parse', async (req, res) => {
  const taskId = `factory_parse_${req.params.id}`;
  res.json({ async: true, taskId });
  parseNovelDNA(req.params.id, (msg) => {
    const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
    wsManager.broadcast(taskId, task);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error',
      progress: result.success ? 'DNA解析完成' : '',
      startTime: Date.now(), result: null, error: result.success ? null : (result.error || '失败'),
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/factory/:id/retry-protagonists - 重试主角提取
app.post('/api/factory/:id/retry-protagonists', async (req, res) => {
  const result = await retryProtagonistExtraction(req.params.id);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ success: true, protagonists: result.protagonists });
});

// POST /api/factory/:id/generate-agents - 生成初代Agent群
app.post('/api/factory/:id/generate-agents', async (req, res) => {
  const taskId = `factory_agents_${req.params.id}`;
  res.json({ async: true, taskId });
  generateInitialAgents(req.params.id, (msg) => {
    const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
    wsManager.broadcast(taskId, task);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error',
      progress: result.success ? 'Agent生成完成' : '',
      startTime: Date.now(), result: null, error: result.success ? null : (result.error || '失败'),
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/factory/:id/evolve - 执行单轮进化（按阶段）
app.post('/api/factory/:id/evolve', async (req, res) => {
  const { stage: stageIndex } = req.body;
  if (typeof stageIndex !== 'number') return res.status(400).json({ error: '缺少 stage（阶段编号）' });
  const project = getFactory(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const stage = project.stages.find(s => s.index === stageIndex);
  if (!stage) return res.status(400).json({ error: `阶段${stageIndex}不存在` });
  const taskId = `factory_evolve_${req.params.id}_s${stageIndex}`;
  res.json({ async: true, taskId });
  runEvolutionRound(req.params.id, stage, (msg) => {
    const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
    wsManager.broadcast(taskId, task);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error',
      progress: result.success ? `竞赛完成` : '',
      startTime: Date.now(), result: null, error: result.success ? null : (result.error || '失败'),
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/factory/:id/mutate - 变异繁殖下一代
app.post('/api/factory/:id/mutate', async (req, res) => {
  const taskId = `factory_mutate_${req.params.id}`;
  res.json({ async: true, taskId });
  mutateAndBreed(req.params.id, (msg) => {
    const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
    wsManager.broadcast(taskId, task);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error',
      progress: result.success ? '变异繁殖完成' : '',
      startTime: Date.now(), result: null, error: result.success ? null : (result.error || '失败'),
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/factory/:id/run-full - 完整自动进化
app.post('/api/factory/:id/run-full', async (req, res) => {
  const taskId = `factory_full_${req.params.id}`;
  res.json({ async: true, taskId });
  runFullEvolution(req.params.id, (msg) => {
    const task: TaskInfo = { id: taskId, status: 'processing', progress: msg, startTime: Date.now(), result: null, error: null };
    wsManager.broadcast(taskId, task);
  }).then((result) => {
    const task: TaskInfo = {
      id: taskId, status: result.success ? 'done' : 'error',
      progress: result.success ? '进化完成' : '',
      startTime: Date.now(), result: null, error: result.success ? null : (result.error || '失败'),
    };
    wsManager.broadcast(taskId, task);
  });
});

// POST /api/factory/:id/export - 导出Agent到仓库
app.post('/api/factory/:id/export', (_req, res) => {
  const result = exportFinalAgent(_req.params.id);
  if (!result.success || !result.agent) return res.status(500).json({ error: result.error });
  const project = getFactory(_req.params.id);
  const agent = result.agent;
  const now = Date.now();
  const agentId = `agent_${crypto.randomUUID().slice(0, 8)}`;
  const novelTitle = project?.novelDNA?.title || '未命名';
  const genre = project?.novelDNA?.genre || '';
  const row: AgentStoreRow = {
    id: agentId,
    name: `${novelTitle} - 风格Agent`,
    genre,
    tone: project?.novelDNA?.tone || '',
    description: `基于「${novelTitle}」进化${agent.generation}代，最终得分${agent.score}`,
    system_prompt: agent.systemPrompt,
    style_directive: agent.styleDirective,
    technique_weights: JSON.stringify(agent.techniqueWeights),
    source_novel: novelTitle,
    score: agent.score || 0,
    generation: agent.generation,
    score_history: JSON.stringify(agent.scoreHistory),
    mutation_log: JSON.stringify(agent.mutationLog),
    factory_project_id: _req.params.id,
    created_at: now, updated_at: now,
  };
  insertAgentStore(row);

  // 同时导出主角为角色Agent
  const protagonists = result.protagonists || [];
  const savedCharacters: Array<{ id: string; name: string; role: string }> = [];
  for (const char of protagonists) {
    const charAgentId = `ca_fac_${_req.params.id.slice(0, 6)}_${char.id}`;
    const systemPrompt = buildFactoryCharacterPrompt(char, novelTitle, genre);
    insertCharacterAgent({
      id: charAgentId,
      name: char.name,
      role: char.role,
      source_novel: novelTitle,
      source_project_id: _req.params.id,
      category: genre,
      description: char.description,
      personality: char.personality,
      visual_prompt: char.visualPrompt || '',
      costume_desc: char.costumeDesc || '',
      system_prompt: systemPrompt,
      profile_images: JSON.stringify({}),
      tags: JSON.stringify([char.role, genre].filter(Boolean)),
      created_at: now,
      updated_at: now,
    });
    savedCharacters.push({ id: charAgentId, name: char.name, role: char.role });
  }

  res.json({ success: true, agentId, name: row.name, prompt: result.prompt, characterAgents: savedCharacters });
});

// GET /api/agents - Agent仓库列表
app.get('/api/agents', (_req, res) => {
  const agents = listAgentStore().map(a => ({
    id: a.id, name: a.name, genre: a.genre, tone: a.tone,
    description: a.description, score: a.score, generation: a.generation,
    sourceNovel: a.source_novel, createdAt: a.created_at,
  }));
  res.json({ agents });
});

// GET /api/agents/:id - Agent详情（含system_prompt）
app.get('/api/agents/:id', (req, res) => {
  const agent = getAgentStoreById(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent不存在' });
  res.json({
    id: agent.id, name: agent.name, genre: agent.genre, tone: agent.tone,
    description: agent.description, systemPrompt: agent.system_prompt,
    styleDirective: agent.style_directive,
    techniqueWeights: JSON.parse(agent.technique_weights || '{}'),
    score: agent.score,
    generation: agent.generation, sourceNovel: agent.source_novel,
    scoreHistory: JSON.parse(agent.score_history || '[]'),
    mutationLog: JSON.parse(agent.mutation_log || '[]'),
    createdAt: agent.created_at,
  });
});

// DELETE /api/agents/:id - 删除Agent
app.delete('/api/agents/:id', (req, res) => {
  deleteAgentStore(req.params.id);
  res.json({ success: true });
});

// ============================================================
// 角色Agent仓库（群演库）
// ============================================================

// POST /api/character-agents/extract/:projectId - 从小说项目提取角色为Agent
app.post('/api/character-agents/extract/:projectId', (req, res) => {
  const { rolesFilter, category } = req.body || {};
  const result = extractCharacterAgents(req.params.projectId, { rolesFilter, category });
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ success: true, agents: result.agents, count: result.agents.length });
});

// GET /api/character-agents - 角色Agent列表
app.get('/api/character-agents', (req, res) => {
  const agents = listCharacterAgents().map(a => ({
    id: a.id, name: a.name, role: a.role, category: a.category,
    description: a.description, personality: a.personality,
    sourceNovel: a.source_novel, visualPrompt: a.visual_prompt,
    profileImages: JSON.parse(a.profile_images || '{}'),
    tags: JSON.parse(a.tags || '[]'),
    createdAt: a.created_at,
  }));
  // 按来源小说分组
  const grouped: Record<string, typeof agents> = {};
  for (const a of agents) {
    const key = a.sourceNovel || '未分类';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(a);
  }
  res.json({ agents, grouped });
});

// GET /api/character-agents/:id - 角色Agent详情
app.get('/api/character-agents/:id', (req, res) => {
  const agent = getCharacterAgentById(req.params.id);
  if (!agent) return res.status(404).json({ error: '角色Agent不存在' });
  res.json({
    id: agent.id, name: agent.name, role: agent.role, category: agent.category,
    description: agent.description, personality: agent.personality,
    visualPrompt: agent.visual_prompt, costumeDesc: agent.costume_desc,
    systemPrompt: agent.system_prompt, sourceNovel: agent.source_novel,
    profileImages: JSON.parse(agent.profile_images || '{}'),
    tags: JSON.parse(agent.tags || '[]'),
    createdAt: agent.created_at,
  });
});

// PATCH /api/character-agents/:id - 更新角色Agent
app.patch('/api/character-agents/:id', (req, res) => {
  const agent = getCharacterAgentById(req.params.id);
  if (!agent) return res.status(404).json({ error: '角色Agent不存在' });
  const { category, tags, description, personality } = req.body || {};
  const updates: Record<string, unknown> = { updated_at: Date.now() };
  if (category !== undefined) updates.category = category;
  if (tags !== undefined) updates.tags = JSON.stringify(tags);
  if (description !== undefined) updates.description = description;
  if (personality !== undefined) updates.personality = personality;
  updateCharacterAgent(req.params.id, updates);
  res.json({ success: true });
});

// DELETE /api/character-agents/:id - 删除角色Agent
app.delete('/api/character-agents/:id', (req, res) => {
  deleteCharacterAgent(req.params.id);
  res.json({ success: true });
});

// POST /api/factory/:id/stop - 中断进化
app.post('/api/factory/:id/stop', (req, res) => {
  const stopped = requestStop(req.params.id);
  if (!stopped) return res.status(400).json({ error: '当前未在进化中' });
  res.json({ success: true, message: '已发送中断信号' });
});

// PATCH /api/factory/:id - 更新工厂配置
app.patch('/api/factory/:id', (req, res) => {
  const project = updateFactory(req.params.id, req.body);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  res.json({ success: true });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', mode: 'direct-jimeng-api', ws: true });
});

// 生产模式: 提供前端静态文件
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

// 创建 HTTP server 并挂载 WebSocket
const server = http.createServer(app);
wsManager.init(server);

// 优雅关闭
process.on('SIGTERM', () => { console.log('[server] 收到 SIGTERM'); browserService.close().finally(() => process.exit(0)); });
process.on('SIGINT', () => { console.log('[server] 收到 SIGINT'); browserService.close().finally(() => process.exit(0)); });

// 初始化数据库后启动服务器
initDB().then(() => {
  // 从 DB 恢复 LLM 配置（优先级高于 .env）
  const savedLLM = loadLLMConfigFromDB();
  if (savedLLM) {
    updateLLMConfig({
      provider: savedLLM.provider as 'deepseek' | 'openai' | 'gemini' | 'anthropic' | 'ollama' | 'custom',
      apiKey: savedLLM.apiKey,
      apiUrl: savedLLM.apiUrl,
      model: savedLLM.model,
      maxTokens: savedLLM.maxTokens ? parseInt(savedLLM.maxTokens) : undefined,
      temperature: savedLLM.temperature ? parseFloat(savedLLM.temperature) : undefined,
    });
    console.log(`[llm] 已从数据库恢复 LLM 配置: ${savedLLM.provider}/${savedLLM.model}`);
  }

  // 从 DB 恢复 Vision LLM 配置
  const savedVision = loadVisionLLMConfigFromDB();
  if (savedVision && savedVision.provider) {
    updateVisionLLMConfig({
      provider: savedVision.provider as 'deepseek' | 'openai' | 'gemini' | 'anthropic' | 'ollama' | 'custom',
      apiKey: savedVision.apiKey,
      apiUrl: savedVision.apiUrl,
      model: savedVision.model,
      maxTokens: savedVision.maxTokens ? parseInt(savedVision.maxTokens) : undefined,
      temperature: savedVision.temperature ? parseFloat(savedVision.temperature) : undefined,
    });
    console.log(`[llm] 已从数据库恢复 Vision LLM 配置: ${savedVision.provider}/${savedVision.model}`);
  }

  // 从 DB 恢复额外 LLM 配置池
  const savedExtra = loadExtraLLMConfigsFromDB();
  if (savedExtra.length > 0) {
    setExtraConfigs(savedExtra.map(c => ({
      provider: (c.provider || 'custom') as LLMConfig['provider'],
      apiKey: c.apiKey || '',
      apiUrl: c.apiUrl || '',
      model: c.model || '',
      maxTokens: c.maxTokens ? parseInt(c.maxTokens) : 8000,
      temperature: c.temperature ? parseFloat(c.temperature) : 0.7,
    })));
    console.log(`[llm] 已从数据库恢复 ${savedExtra.length} 个额外 LLM 配置`);
  }

  // 从 DB 恢复 NSFW 全局开关
  loadNSFWFromDB();
  if (isNSFWEnabled()) console.log('[llm] NSFW 模式已从数据库恢复: 开启');

  // 从 DB 恢复创作工厂项目
  restoreFactories();

  // 从 DB 恢复剧本项目
  loadScreenplayProjectsFromDB();

  server.listen(Number(PORT), '0.0.0.0', () => {
    // 获取本机局域网 IP
    const nets = os.networkInterfaces();
    const lanIps: string[] = [];
    for (const iface of Object.values(nets)) {
      for (const cfg of iface || []) {
        if (cfg.family === 'IPv4' && !cfg.internal) lanIps.push(cfg.address);
      }
    }
    console.log(`\n🚀 服务器已启动: http://0.0.0.0:${PORT}`);
    if (lanIps.length > 0) console.log(`🌐 局域网访问: http://${lanIps[0]}:${PORT}`);
    console.log(`🔗 直连即梦 API (jimeng.jianying.com)`);
    console.log(`📡 WebSocket: ws://0.0.0.0:${PORT}/ws`);
    console.log(`🔑 默认 Session ID: ${DEFAULT_SESSION_ID ? `已配置 (长度${DEFAULT_SESSION_ID.length})` : '未配置'}`);
    console.log(`📁 运行模式: ${process.env.NODE_ENV === 'production' ? '生产' : '开发'}\n`);
  });
}).catch((err) => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});

