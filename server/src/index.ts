// 后端主入口 - TypeScript 重构版
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import { generateSeedanceVideo } from './video-generator.js';
import browserService from './browser-service.js';
import { wsManager } from './ws-manager.js';
import { FAKE_HEADERS } from './utils.js';
import type { TaskInfo, ModelKey, HistoryRecord } from './types.js';
import { DEFAULT_PRESETS } from './types.js';
import { loadWords, checkText, sanitizeText, addManualWords, removeWord, getWordsDetail, learnFromFailure, confirmLearnedWord } from './sensitive-words.js';
import {
  createProject, getProject, listProjects, removeProject,
  analyzeNovel, transformCopyright, generateScript, confirmCharacter,
  updateCharacterImages, getProjectLogs, batchGenerateVideos,
  type CharacterInfo,
} from './novel-to-drama.js';
import { generateImage, generateCharacterImages } from './image-generator.js';
import { initDB, saveLLMConfig as saveLLMConfigToDB, loadLLMConfigFromDB } from './db-service.js';
import { getLLMConfig, updateLLMConfig } from './llm-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const DEFAULT_SESSION_ID = process.env.VITE_DEFAULT_SESSION_ID || '';

app.use(cors());
app.use(express.json({ limit: '50mb' }));

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
            const imgResp = await fetch(genResults[0].imageUrl);
            const imgBuffer = Buffer.from(await imgResp.arrayBuffer());
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

  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });

  const progressTaskId = `analyze_${req.params.id}`;
  // 短文本（< 5万字）同步处理，长文本异步处理
  if (novelText.length < 50000) {
    const result = await analyzeNovel(req.params.id, novelText);
    if (!result.success) return res.status(500).json({ error: result.error });
    res.json({ project: result.project });
  } else {
    // 长文本：立即返回，后台异步处理
    res.json({ async: true, progressTaskId, message: `小说 ${(novelText.length / 10000).toFixed(1)} 万字，正在后台分析...` });

    // 后台执行（novelText 传入后由 analyzeNovel 内部处理，不再长期持有引用）
    analyzeNovel(req.params.id, novelText, (step, detail) => {
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

// POST /api/drama/:id/generate-character-images - 生成角色图
app.post('/api/drama/:id/generate-character-images', async (req, res) => {
  const project = getProject(req.params.id);
  if (!project) return res.status(404).json({ error: '项目不存在' });
  const { sessionId, characterId } = req.body;
  const authToken = sessionId || DEFAULT_SESSION_ID;
  if (!authToken) return res.status(401).json({ error: '未配置 Session ID' });

  const character = project.novel.characters.find((c: CharacterInfo) => c.id === characterId);
  if (!character) return res.status(404).json({ error: '角色不存在' });

  try {
    const images = await generateCharacterImages(character.newName, character.description, project.style, authToken);
    updateCharacterImages(req.params.id, characterId, images.map(img => img.imageUrl));
    res.json({ characterId, images, imageUrls: images.map(img => img.imageUrl) });
  } catch (err) {
    res.status(500).json({ error: `角色图生成失败: ${(err as Error).message}` });
  }
});

// POST /api/drama/:id/confirm-character - 确认角色
app.post('/api/drama/:id/confirm-character', (req, res) => {
  const { characterId, selectedImageUrls } = req.body;
  const result = confirmCharacter(req.params.id, characterId, selectedImageUrls);
  if (!result.success) return res.status(400).json({ error: result.error });
  res.json({ confirmed: true, allConfirmed: result.allConfirmed, characterId });
});

// POST /api/drama/:id/generate-script - 第3步：LLM 自动生成分镜脚本
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

  const result = await generateScript(req.params.id);
  if (!result.success) return res.status(500).json({ error: result.error });
  res.json({ project: result.project });
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
  batchGenerateVideos(req.params.id, authToken, tasks, (episode, total, status, detail) => {
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

// multer 错误处理
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '文件大小超过限制 (最大20MB)' });
    if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: '文件数量超过限制 (最多5个)' });
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  }
  res.status(500).json({ error: err.message || '服务器内部错误' });
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

  server.listen(PORT, () => {
    console.log(`\n🚀 服务器已启动: http://localhost:${PORT}`);
    console.log(`🔗 直连即梦 API (jimeng.jianying.com)`);
    console.log(`📡 WebSocket: ws://localhost:${PORT}/ws`);
    console.log(`🔑 默认 Session ID: ${DEFAULT_SESSION_ID ? `已配置 (长度${DEFAULT_SESSION_ID.length})` : '未配置'}`);
    console.log(`📁 运行模式: ${process.env.NODE_ENV === 'production' ? '生产' : '开发'}\n`);
  });
}).catch((err) => {
  console.error('数据库初始化失败:', err);
  process.exit(1);
});

