// 短剧制片模块 - API路由
import { Router } from 'express';
import multer from 'multer';
import crypto from 'crypto';
const uuid = () => crypto.randomUUID();
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  insertProductionProject, getProductionProject, listProductionProjects,
  updateProductionProject, deleteProductionProject,
  insertProductionEpisode, getProductionEpisodes, updateProductionEpisode,
  getProductionAssets, getProductionAsset, insertProductionAsset,
  updateProductionAsset, deleteProductionAsset,
  insertAssetVariant, getAssetVariants,
  insertVoiceProfile, getVoiceProfiles, updateVoiceProfile, deleteVoiceProfile,
  saveTTSConfig, loadTTSConfig as dbLoadTTSConfig,
  insertSegment, getSegments as dbGetSegments, updateSegment, deleteSegmentsByProject, deleteSegmentsByEpisode,
  saveMusicConfig, loadMusicConfig as dbLoadMusicConfig,
} from './db-production.js';
import { parseDocxBuffer, parseScriptText, cleanScript, aiCleanScript, generateEpisodeSummary } from './script-parser.js';
import type { EpisodeSummary } from './script-parser.js';
import {
  extractCharactersFromParsed, extractLocationsFromShots,
  extractPropsFromScript, linkShotsToAssets, detectVariants,
} from './asset-extractor.js';
import { getTTSProvider, parseDialogue, synthesizeDialogue, setDoubaoConfig, getDoubaoConfig } from './tts-service.js';
import { batchGenerateProductionVideos } from './video-orchestrator.js';
import { runQualityCheck } from './quality-checker.js';
import { wsManager } from '../ws-manager.js';
import { taskManager } from './task-manager.js';
import { generateImage, httpsDownload } from '../image-generator.js';
import { buildSegments, type ShotInput } from './segment-builder.js';
import { generateMusicForSegments, setSunoConfig, getSunoConfig } from './music-service.js';
import { composeProject } from './composer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../../data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const PROD_IMAGES_DIR = path.join(DATA_DIR, 'production-images');

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ==================== 项目 ====================

router.post('/create', (req, res) => {
  try {
    const { title, config, requirementsText } = req.body;
    const id = uuid();
    insertProductionProject({
      id, title: title || '未命名制片项目',
      status: 'created', totalEpisodes: 0,
      config: JSON.stringify(config || {}),
      requirementsText: requirementsText || '',
    });
    res.json({ success: true, project: getProductionProject(id) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/list', (_req, res) => {
  try {
    res.json({ success: true, projects: listProductionProjects() });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/:id', (req, res) => {
  try {
    const project = getProductionProject(req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });
    const episodes = getProductionEpisodes(req.params.id);
    const assets = getProductionAssets(req.params.id);
    const voices = getVoiceProfiles(req.params.id);
    res.json({ success: true, project, episodes, assets, voices });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/:id', (req, res) => {
  try {
    deleteProductionProject(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================== 脚本上传与解析 ====================

router.post('/:id/upload-script', upload.array('scripts', 50), async (req, res) => {
  try {
    const projectId = req.params.id as string;
    const project = getProductionProject(projectId);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) return res.status(400).json({ error: '未上传文件' });

    const episodes: Array<{ episodeNumber: number; rawText: string }> = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let rawText = '';

      if (file.originalname.endsWith('.docx')) {
        rawText = await parseDocxBuffer(file.buffer);
      } else if (file.originalname.endsWith('.txt')) {
        rawText = file.buffer.toString('utf-8');
      } else {
        rawText = file.buffer.toString('utf-8');
      }

      const epId = uuid();
      insertProductionEpisode({
        id: epId, projectId,
        episodeNumber: i + 1, rawScript: rawText, status: 'raw',
      });
      episodes.push({ episodeNumber: i + 1, rawText });
    }

    updateProductionProject(projectId, {
      status: 'script_uploaded',
      total_episodes: files.length,
    });

    res.json({ success: true, episodeCount: files.length, episodes: getProductionEpisodes(projectId) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/:id/clean-script', async (req, res) => {
  try {
    const pid = req.params.id;
    const project = getProductionProject(pid);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const episodes = getProductionEpisodes(pid);
    if (!episodes.length) return res.status(400).json({ error: '没有可清洗的剧集，请先上传脚本' });

    const existing = taskManager.getProjectTask(pid, 'clean');
    if (existing?.status === 'running') {
      return res.json({ async: true, taskId: existing.taskId, message: '清洗任务进行中' });
    }

    const useAI = req.body.useAI !== false;
    const task = taskManager.startTask(pid, 'clean', `开始清洗 ${episodes.length} 集脚本`);
    updateProductionProject(pid, { status: 'cleaning' });

    res.json({ async: true, taskId: task.taskId });

    (async () => {
      let successCount = 0;
      let prevSummary: EpisodeSummary | undefined;

      const sorted = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);

      for (const ep of sorted) {
        if (taskManager.shouldStop(task.taskId)) {
          console.log(`[production] 清洗任务被中断: ${pid}`);
          taskManager.updateProgress(task.taskId, '已手动停止');
          break;
        }

        if (!ep.rawScript) {
          console.log(`[production] 第${ep.episodeNumber}集无原始脚本，跳过`);
          continue;
        }

        try {
          console.log(`[production] 开始解析第${ep.episodeNumber}集脚本 (${ep.rawScript.length} chars)...`);
          taskManager.updateProgress(task.taskId, `正在解析第${ep.episodeNumber}集...`, { episodeNumber: ep.episodeNumber, phase: 'parsing' });

          const parsed = await parseScriptText(ep.rawScript, prevSummary);
          console.log(`[production] 第${ep.episodeNumber}集解析完成: ${parsed.characters.length}个角色, ${parsed.shots.length}个镜头`);

          const { cleaned, issues } = cleanScript(parsed);
          if (issues.length) console.log(`[production] 第${ep.episodeNumber}集规则检查发现 ${issues.length} 个问题`);

          let finalScript = cleaned;
          if (useAI) {
            taskManager.updateProgress(task.taskId, `AI清洗第${ep.episodeNumber}集...`, { episodeNumber: ep.episodeNumber, phase: 'ai_clean' });
            console.log(`[production] 开始AI清洗第${ep.episodeNumber}集...`);
            finalScript = await aiCleanScript(cleaned, project.requirementsText || '', prevSummary);
            console.log(`[production] 第${ep.episodeNumber}集AI清洗完成`);
          }

          // 生成本集摘要供下一集参照
          taskManager.updateProgress(task.taskId, `生成第${ep.episodeNumber}集叙事摘要...`, { episodeNumber: ep.episodeNumber, phase: 'summary' });
          prevSummary = await generateEpisodeSummary(finalScript, ep.episodeNumber);
          console.log(`[production] 第${ep.episodeNumber}集摘要已生成`);

          const linkedShots = linkShotsToAssets(finalScript.shots, [], [], []);

          updateProductionEpisode(ep.id, {
            cleaned_script: JSON.stringify(finalScript),
            shots_data: JSON.stringify(linkedShots.map((s, idx) => ({
              ...s,
              characterRefs: s.characterRefs || [],
              locationRefs: s.locationRefs || [],
              propRefs: s.propRefs || [],
              videoStatus: 'pending',
              audioStatus: 'pending',
              index: s.index || idx + 1,
            }))),
            status: 'cleaned',
          });

          successCount++;
          taskManager.updateProgress(task.taskId, `第${ep.episodeNumber}集清洗完成 (${successCount}/${sorted.length})`, {
            episodeNumber: ep.episodeNumber, phase: 'done', issues, successCount,
          });
        } catch (epErr) {
          const msg = epErr instanceof Error ? epErr.message : String(epErr);
          console.error(`[production] 第${ep.episodeNumber}集清洗失败:`, msg);
          taskManager.updateProgress(task.taskId, `第${ep.episodeNumber}集失败: ${msg}`, {
            episodeNumber: ep.episodeNumber, phase: 'error', error: msg,
          });
        }
      }

      if (successCount > 0) {
        updateProductionProject(pid, { status: 'asset_extracting' });
        taskManager.completeTask(task.taskId, `清洗完成: ${successCount}/${sorted.length} 集成功`);
      } else if (taskManager.shouldStop(task.taskId)) {
        updateProductionProject(pid, { status: 'script_uploaded' });
        taskManager.completeTask(task.taskId, '任务已停止');
      } else {
        updateProductionProject(pid, { status: 'script_uploaded' });
        taskManager.failTask(task.taskId, '所有剧集清洗失败');
      }
    })().catch(err => {
      console.error('[production] 清洗任务整体异常:', err);
      taskManager.failTask(task.taskId, String(err));
    });
  } catch (err) {
    console.error('[production] clean-script 路由错误:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ==================== 资产提取 ====================

router.post('/:id/assets/extract', async (req, res) => {
  try {
    const pid = req.params.id;
    const project = getProductionProject(pid);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const existing = taskManager.getProjectTask(pid, 'extract');
    if (existing?.status === 'running') {
      return res.json({ async: true, taskId: existing.taskId, message: '提取任务进行中' });
    }

    const episodes = getProductionEpisodes(pid);
    if (episodes.length === 0) return res.status(400).json({ error: '没有已解析的剧集' });

    const firstEp = episodes[0];
    const parsedScript = firstEp.cleanedScript ? JSON.parse(firstEp.cleanedScript) : null;
    if (!parsedScript) return res.status(400).json({ error: '脚本尚未清洗，请先执行 AI 脚本清洗' });

    const task = taskManager.startTask(pid, 'extract', '开始资产提取...');
    res.json({ async: true, taskId: task.taskId });

    (async () => {
      taskManager.updateProgress(task.taskId, '提取角色...');
      const characters = extractCharactersFromParsed(parsedScript.characters || []);
      console.log(`[production] 提取到 ${characters.length} 个角色`);

      taskManager.updateProgress(task.taskId, '提取场景...');
      const allShots = episodes.flatMap(ep => ep.shots || []);
      const locations = extractLocationsFromShots(allShots);
      console.log(`[production] 提取到 ${locations.length} 个场景`);

      taskManager.updateProgress(task.taskId, 'AI 提取道具...');
      const props = await extractPropsFromScript(parsedScript);

      for (const c of characters) {
        insertProductionAsset({
          id: c.id, projectId: pid, assetType: 'character',
          name: c.name, description: c.description,
          visualPrompt: c.visualPrompt, metadata: JSON.stringify(c.metadata),
          imageUrls: '[]', status: 'extracted',
        });
      }
      for (const l of locations) {
        insertProductionAsset({
          id: l.id, projectId: pid, assetType: 'location',
          name: l.name, description: l.description,
          visualPrompt: l.visualPrompt, metadata: JSON.stringify(l.metadata),
          imageUrls: '[]', status: 'extracted',
        });
      }
      for (const p of props) {
        insertProductionAsset({
          id: p.id, projectId: pid, assetType: 'prop',
          name: p.name, description: p.description,
          visualPrompt: p.visualPrompt, metadata: JSON.stringify(p.metadata),
          imageUrls: '[]', status: 'extracted',
        });
      }

      taskManager.updateProgress(task.taskId, '链接镜头到资产...');
      for (const ep of episodes) {
        const shots = ep.shots || [];
        const linked = linkShotsToAssets(shots, characters, locations, props);
        updateProductionEpisode(ep.id, { shots_data: JSON.stringify(linked) });
      }

      if (episodes.length > 1) {
        taskManager.updateProgress(task.taskId, '检测跨集角色变体...');
        const variants = await detectVariants(
          characters,
          episodes.map(ep => ({ episodeNumber: ep.episodeNumber, shots: ep.shots || [] }))
        );
        for (const v of variants) {
          const char = characters.find(c => c.name === v.characterName);
          if (char) {
            insertAssetVariant({
              id: uuid(), assetId: char.id, episodeNumber: v.episodeNumber,
              variantLabel: v.variantLabel, description: v.description,
              visualPrompt: '', imageUrls: '[]', metadataOverride: '{}',
            });
          }
        }
      }

      updateProductionProject(pid, { status: 'asset_extracting' });
      taskManager.completeTask(task.taskId, `提取完成: ${characters.length} 角色, ${locations.length} 场景, ${props.length} 道具`);
    })().catch(err => {
      console.error('[production] 资产提取失败:', err);
      taskManager.failTask(task.taskId, String(err));
    });
  } catch (err) {
    console.error('[production] extract 路由错误:', err);
    res.status(500).json({ error: String(err) });
  }
});

// ==================== 资产管理 ====================

router.get('/:id/assets', (req, res) => {
  try {
    const assetType = req.query.type as string | undefined;
    res.json({ success: true, assets: getProductionAssets(req.params.id, assetType) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.put('/assets/:assetId', (req, res) => {
  try {
    updateProductionAsset(req.params.assetId, req.body);
    res.json({ success: true, asset: getProductionAsset(req.params.assetId) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/assets/:assetId', (req, res) => {
  try {
    deleteProductionAsset(req.params.assetId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/assets/:assetId/variants', (req, res) => {
  try {
    res.json({ success: true, variants: getAssetVariants(req.params.assetId) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/assets/:assetId/variants', (req, res) => {
  try {
    const { episodeNumber, variantLabel, description, visualPrompt } = req.body;
    const id = uuid();
    insertAssetVariant({
      id, assetId: req.params.assetId, episodeNumber, variantLabel,
      description: description || '', visualPrompt: visualPrompt || '',
      imageUrls: '[]', metadataOverride: JSON.stringify(req.body.metadataOverride || {}),
    });
    res.json({ success: true, variant: { id } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/:id/confirm-assets', (req, res) => {
  try {
    const assets = getProductionAssets(req.params.id);
    for (const a of assets) {
      if (a.status === 'extracted') {
        updateProductionAsset(a.id, { status: 'confirmed' });
      }
    }
    updateProductionProject(req.params.id, { status: 'asset_confirmed' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================== 资产图片生成 / 上传 ====================

const imageUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/assets/:assetId/upload-image', imageUpload.single('image'), (req, res) => {
  try {
    const assetId = req.params.assetId as string;
    const asset = getProductionAsset(assetId);
    if (!asset) return res.status(404).json({ error: '资产不存在' });
    if (!req.file) return res.status(400).json({ error: '未提供图片' });

    if (!fs.existsSync(PROD_IMAGES_DIR)) fs.mkdirSync(PROD_IMAGES_DIR, { recursive: true });

    const ext = path.extname(req.file.originalname) || '.png';
    const filename = `${assetId}_${Date.now()}${ext}`;
    const filePath = path.join(PROD_IMAGES_DIR, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const localUrl = `/api/production/images/${filename}`;
    const existing = asset.imageUrls || [];
    existing.push(localUrl);
    updateProductionAsset(assetId, { imageUrls: existing });

    res.json({ success: true, imageUrl: localUrl, imageUrls: existing });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/images/:filename', (req, res) => {
  const filePath = path.join(PROD_IMAGES_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

router.post('/assets/:assetId/generate-images', async (req, res) => {
  try {
    const asset = getProductionAsset(req.params.assetId);
    if (!asset) return res.status(404).json({ error: '资产不存在' });

    const { sessionId, style } = req.body;
    if (!sessionId) return res.status(400).json({ error: '需要 sessionId' });

    const existingTask = taskManager.getProjectTask(asset.projectId, 'full');
    if (existingTask?.status === 'running') {
      return res.json({ async: true, taskId: existingTask.taskId });
    }

    const taskId = `production_image_${req.params.assetId}`;
    res.json({ async: true, taskId });

    (async () => {
      const baseDesc = asset.visualPrompt || `${asset.name}, ${asset.description}`;
      const negativePrompt = 'low quality, blurry, deformed, extra limbs, bad anatomy, watermark, text, CG, cartoon';

      if (!fs.existsSync(PROD_IMAGES_DIR)) fs.mkdirSync(PROD_IMAGES_DIR, { recursive: true });

      const hasRefImage = asset.imageUrls && asset.imageUrls.length > 0;

      // Step 1: 无参考图时先生成主图
      if (!hasRefImage) {
        wsManager.broadcastJSON(taskId, { type: 'production_task', status: 'running', progress: '正在生成角色主图（全身立绘）...' });
        console.log(`[production] 开始生成角色主图: ${asset.name}`);

        const mainPrompt = `全身立绘, 白色简洁背景, 高清, 角色设定图, ${baseDesc}, 全身可见, 包括鞋子, 面朝镜头`;
        const mainResults = await generateImage(mainPrompt, sessionId, {
          width: 768, height: 1024, count: 1, style, negativePrompt,
        });

        if (mainResults.length > 0) {
          const imgBuf = await httpsDownload(mainResults[0].imageUrl);
          const mainFilename = `${req.params.assetId}_main_${Date.now()}.png`;
          fs.writeFileSync(path.join(PROD_IMAGES_DIR, mainFilename), imgBuf);
          const mainLocalUrl = `/api/production/images/${mainFilename}`;

          updateProductionAsset(req.params.assetId, { imageUrls: [mainLocalUrl] });
          wsManager.broadcastJSON(taskId, { type: 'production_task', status: 'running', progress: '主图生成完成，准备生成三视图...', detail: { mainImage: mainLocalUrl } });
          console.log(`[production] 角色主图已生成: ${mainLocalUrl}`);
        } else {
          wsManager.broadcastJSON(taskId, { type: 'production_task', status: 'error', error: '主图生成失败' });
          return;
        }
      }

      // Step 2: 生成三视图（面部特写 + 正/侧/背视图）
      wsManager.broadcastJSON(taskId, { type: 'production_task', status: 'running', progress: '正在生成角色三视图...' });
      console.log(`[production] 开始生成角色三视图: ${asset.name}`);

      const threeViewPrompt = `${baseDesc}, 请生成角色全身三视图以及一张面部特写, ` +
        `最左边占满三分之一的位置是超大的面部特写, ` +
        `右边三分之二放正视图、侧视图、后视图, ` +
        `纯白色背景, 2K高清, 不要道具, 不要特效, 要配鞋, ` +
        `16:9比例, 保持与角色主图的外貌特征完全一致`;

      const sheetResults = await generateImage(threeViewPrompt, sessionId, {
        width: 1920, height: 1080, count: 1, style, negativePrompt,
      });

      const profileImages: Record<string, string> = {};
      if (sheetResults.length > 0) {
        const sheetBuf = await httpsDownload(sheetResults[0].imageUrl);
        const sheetFilename = `${req.params.assetId}_threeview_${Date.now()}.png`;
        fs.writeFileSync(path.join(PROD_IMAGES_DIR, sheetFilename), sheetBuf);
        profileImages.threeView = `/api/production/images/${sheetFilename}`;
        console.log(`[production] 三视图已生成: ${profileImages.threeView}`);
      }

      // Step 3: 分别生成正面/侧面/背面独立图
      const viewTypes = ['front', 'side', 'back'] as const;
      const viewPrompts: Record<string, string> = {
        front: `正面全身照, 白色简洁背景, 角色设定图, ${baseDesc}, 面朝镜头, 全身可见, 包括鞋子`,
        side: `左侧面全身照, 白色简洁背景, 角色设定图, ${baseDesc}, 左侧面, 全身可见, 包括鞋子`,
        back: `背面全身照, 白色简洁背景, 角色设定图, ${baseDesc}, 背对镜头, 全身可见, 包括鞋子`,
      };

      for (const vt of viewTypes) {
        wsManager.broadcastJSON(taskId, { type: 'production_task', status: 'running', progress: `生成${vt === 'front' ? '正面' : vt === 'side' ? '侧面' : '背面'}图...` });
        try {
          const results = await generateImage(viewPrompts[vt], sessionId, {
            width: 768, height: 1024, count: 1, style, negativePrompt,
          });
          if (results.length > 0) {
            const buf = await httpsDownload(results[0].imageUrl);
            const fname = `${req.params.assetId}_${vt}_${Date.now()}.png`;
            fs.writeFileSync(path.join(PROD_IMAGES_DIR, fname), buf);
            profileImages[vt] = `/api/production/images/${fname}`;
          }
        } catch (err) {
          console.error(`[production] ${vt}视图生成失败:`, err);
        }
      }

      updateProductionAsset(req.params.assetId, { profileImages, status: 'images_ready' });
      wsManager.broadcastJSON(taskId, { type: 'production_task', status: 'done', progress: '三视图全部完成', detail: { profileImages } });
      console.log(`[production] 角色 ${asset.name} 三视图全部完成`);
    })().catch(err => {
      console.error('[production] 三视图生成异常:', err);
      wsManager.broadcastJSON(taskId, { type: 'production_task', status: 'error', error: String(err) });
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================== 语音 ====================

router.get('/voices/list', async (req, res) => {
  try {
    const language = (req.query.language as string) || 'en';
    const provider = getTTSProvider('doubao');
    const voices = await provider.listVoices(language);
    res.json({ success: true, voices });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/voices/config', (req, res) => {
  try {
    const { appId, accessToken, clusterId } = req.body;
    setDoubaoConfig({ appId, accessToken, clusterId });
    saveTTSConfig('doubao', appId, accessToken, clusterId || '');
    console.log('[production] 豆包TTS配置已保存到DB');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/voices/config', (_req, res) => {
  const config = getDoubaoConfig();
  res.json({
    success: true,
    configured: !!config,
    provider: 'doubao',
    appId: config?.appId ? config.appId.slice(0, 4) + '****' : '',
    clusterId: config?.clusterId || '',
  });
});

router.post('/:id/voice-bindings', (req, res) => {
  try {
    const { characterAssetId, voiceId, voiceName, language, speed, pitch, emotion } = req.body;
    const id = uuid();
    insertVoiceProfile({
      id, projectId: req.params.id,
      characterAssetId: characterAssetId || '',
      provider: 'doubao', voiceId: voiceId || '',
      voiceName: voiceName || '', language: language || 'en',
      speed: speed ?? 1.0, pitch: pitch ?? 0, emotion: emotion || '',
    });
    if (characterAssetId) {
      updateProductionAsset(characterAssetId, { voiceProfileId: id });
    }
    res.json({ success: true, voiceProfile: { id } });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/:id/voice-bindings', (req, res) => {
  try {
    res.json({ success: true, voiceProfiles: getVoiceProfiles(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.put('/voice-bindings/:bindingId', (req, res) => {
  try {
    updateVoiceProfile(req.params.bindingId, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.delete('/voice-bindings/:bindingId', (req, res) => {
  try {
    deleteVoiceProfile(req.params.bindingId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/:id/generate-voices', async (req, res) => {
  try {
    const pid = req.params.id;
    const project = getProductionProject(pid);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const existing = taskManager.getProjectTask(pid, 'voice');
    if (existing?.status === 'running') {
      return res.json({ async: true, taskId: existing.taskId, message: '配音任务进行中' });
    }

    if (!fs.existsSync(AUDIO_DIR)) fs.mkdirSync(AUDIO_DIR, { recursive: true });

    const episodes = getProductionEpisodes(pid);
    const voiceProfiles = getVoiceProfiles(pid);
    const assets = getProductionAssets(pid, 'character');

    const charVoiceMap = new Map<string, { voiceId: string; speed: number; provider: string }>();
    for (const vp of voiceProfiles) {
      if (vp.characterAssetId) {
        const char = assets.find(a => a.id === vp.characterAssetId);
        if (char) {
          charVoiceMap.set(char.name.toUpperCase(), { voiceId: vp.voiceId, speed: vp.speed, provider: vp.provider });
        }
      }
    }

    const task = taskManager.startTask(pid, 'voice', '开始配音生成...');
    updateProductionProject(pid, { status: 'voice_generating' });
    res.json({ async: true, taskId: task.taskId });

    (async () => {
      let totalShots = 0;
      let doneShots = 0;
      for (const ep of episodes) totalShots += (ep.shots || []).filter((s: { dialogue?: string }) => s.dialogue).length;

      for (const ep of episodes) {
        if (taskManager.shouldStop(task.taskId)) break;

        const shots = ep.shots || [];
        for (let i = 0; i < shots.length; i++) {
          if (taskManager.shouldStop(task.taskId)) break;
          const shot = shots[i];
          if (!shot.dialogue || shot.audioStatus === 'done') continue;

          try {
            const lines = parseDialogue(shot.dialogue);
            const audioBuffers: Buffer[] = [];

            for (const line of lines) {
              const binding = charVoiceMap.get(line.characterName.toUpperCase());
              if (!binding) continue;
              const audio = await synthesizeDialogue(binding.provider, line, binding.voiceId, binding.speed);
              audioBuffers.push(audio);
            }

            if (audioBuffers.length > 0) {
              const combined = Buffer.concat(audioBuffers);
              const filename = `${pid}_ep${ep.episodeNumber}_shot${i}.mp3`;
              fs.writeFileSync(path.join(AUDIO_DIR, filename), combined);
              shots[i] = { ...shots[i], audioUrl: `/api/production/audio/${filename}`, audioStatus: 'done' };
            } else {
              shots[i] = { ...shots[i], audioStatus: 'done' };
            }
          } catch (err) {
            shots[i] = { ...shots[i], audioStatus: 'error', audioError: String(err) };
          }

          updateProductionEpisode(ep.id, { shots_data: JSON.stringify(shots) });
          doneShots++;
          taskManager.updateProgress(task.taskId, `配音 ${doneShots}/${totalShots}`, { episodeNumber: ep.episodeNumber, shotIndex: i, doneShots, totalShots });
        }

        const allVoiceDone = shots.every((s: { dialogue?: string; audioStatus?: string }) => !s.dialogue || s.audioStatus === 'done');
        if (allVoiceDone) updateProductionEpisode(ep.id, { status: 'voice_done' });
      }

      if (taskManager.shouldStop(task.taskId)) {
        taskManager.completeTask(task.taskId, '配音已停止');
      } else {
        taskManager.completeTask(task.taskId, `配音完成: ${doneShots}/${totalShots}`);
      }
    })().catch(err => {
      console.error('[production] 配音异常:', err);
      taskManager.failTask(task.taskId, String(err));
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// 音频静态文件
router.get('/audio/:filename', (req, res) => {
  const filePath = path.join(AUDIO_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// ==================== 视频批量生成 ====================

router.post('/:id/generate-videos', async (req, res) => {
  try {
    const pid = req.params.id;
    const project = getProductionProject(pid);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const existing = taskManager.getProjectTask(pid, 'video');
    if (existing?.status === 'running') {
      return res.json({ async: true, taskId: existing.taskId, message: '视频生成进行中' });
    }

    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: '需要 sessionId' });

    const task = taskManager.startTask(pid, 'video', '视频生成已启动');
    res.json({ async: true, taskId: task.taskId });

    batchGenerateProductionVideos({
      projectId: pid,
      sessionId,
      ratio: project.config?.ratio || '9:16',
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================== 质检 ====================

router.post('/:id/quality-check', (req, res) => {
  try {
    const project = getProductionProject(req.params.id);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const episodes = getProductionEpisodes(req.params.id);
    const report = runQualityCheck(
      req.params.id,
      episodes.map(ep => ({ episodeNumber: ep.episodeNumber, shots: ep.shots || [] })),
      {
        shotDurationMin: project.config?.shotDuration?.min,
        shotDurationMax: project.config?.shotDuration?.max,
        episodeDurationMin: project.config?.episodeDuration?.min,
        episodeDurationMax: project.config?.episodeDuration?.max,
      }
    );

    res.json({ success: true, report });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================== 剧集 ====================

router.get('/:id/episodes', (req, res) => {
  try {
    res.json({ success: true, episodes: getProductionEpisodes(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.put('/episodes/:epId', (req, res) => {
  try {
    updateProductionEpisode(req.params.epId, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================== 分段 ====================

router.post('/:id/build-segments', async (req, res) => {
  try {
    const pid = req.params.id;
    const project = getProductionProject(pid);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const episodes = getProductionEpisodes(pid);
    if (!episodes.length) return res.status(400).json({ error: '没有剧集' });

    const maxDuration = (req.body.maxDuration as number) || 15;
    deleteSegmentsByProject(pid);

    let totalSegments = 0;
    const allSegments: Record<string, unknown>[] = [];

    for (const ep of episodes) {
      const shots: ShotInput[] = (ep.shots || []).map((s: Record<string, unknown>, i: number) => ({
        index: i,
        scene: (s.scene as string) || '',
        content: (s.content as string) || '',
        cameraWork: (s.cameraWork as string) || '',
        visualRequirement: (s.visualRequirement as string) || '',
        soundDesign: (s.soundDesign as string) || '',
        duration: (s.duration as number) || 2,
        dialogue: (s.dialogue as string) || '',
        characterRefs: (s.characterRefs as string[]) || [],
      }));

      const segments = buildSegments(shots, maxDuration);
      console.log(`[production] 第${ep.episodeNumber}集分段: ${segments.length}段 (${shots.length}个镜头)`);

      for (const seg of segments) {
        insertSegment({
          id: seg.id,
          projectId: pid,
          episodeId: ep.id,
          segmentIndex: seg.segmentIndex,
          shotIds: JSON.stringify(seg.shots.map(s => s.index)),
          totalDuration: seg.totalDuration,
          mergedPrompt: seg.mergedPrompt,
          transitionHint: seg.transitionHint,
        });
        totalSegments++;
        allSegments.push({ ...seg, episodeId: ep.id });
      }
    }

    updateProductionProject(pid, { status: 'segmented' });
    res.json({ success: true, totalSegments, segments: allSegments });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/:id/segments', (req, res) => {
  try {
    const episodeId = req.query.episodeId as string | undefined;
    const segments = dbGetSegments(req.params.id, episodeId);
    res.json({ success: true, segments });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ==================== 音乐 ====================

const musicUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const MUSIC_DIR = path.join(DATA_DIR, 'music');

router.post('/music/config', (req, res) => {
  try {
    const { apiKey, baseUrl } = req.body;
    if (!apiKey) return res.status(400).json({ error: '需要 apiKey' });
    setSunoConfig({ apiKey, baseUrl: baseUrl || 'https://api.suno.ai/v1' });
    saveMusicConfig('suno', apiKey, baseUrl || '');
    console.log('[production] Suno 音乐配置已保存');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/music/config', (_req, res) => {
  const config = getSunoConfig();
  res.json({ success: true, configured: !!config, provider: 'suno' });
});

router.post('/:id/generate-music', async (req, res) => {
  try {
    const pid = req.params.id;
    const project = getProductionProject(pid);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const existingTask = taskManager.getProjectTask(pid, 'full');
    if (existingTask?.status === 'running') {
      return res.json({ async: true, taskId: existingTask.taskId });
    }

    const task = taskManager.startTask(pid, 'full', '开始生成音乐');
    res.json({ async: true, taskId: task.taskId });

    (async () => {
      const segments = dbGetSegments(pid);
      if (!segments.length) {
        taskManager.failTask(task.taskId, '请先执行分段');
        return;
      }

      const segInputs = segments.map(s => ({
        id: s.id,
        segmentIndex: s.segmentIndex,
        shots: (s.shotIds as number[]).map(idx => ({ index: idx, scene: '', content: '', cameraWork: '', visualRequirement: '', soundDesign: '', duration: 0 })),
        totalDuration: s.totalDuration,
        mergedPrompt: s.mergedPrompt,
        transitionHint: s.transitionHint,
      }));

      await generateMusicForSegments(segInputs, (segIdx, status) => {
        taskManager.updateProgress(task.taskId, status, { segmentIndex: segIdx });
      });

      taskManager.completeTask(task.taskId, `音乐生成完成: ${segments.length}段`);
    })().catch(err => {
      taskManager.failTask(task.taskId, String(err));
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post('/:id/segments/:segId/upload-music', musicUpload.single('music'), (req, res) => {
  try {
    const segId = req.params.segId as string;
    if (!req.file) return res.status(400).json({ error: '未提供音频文件' });
    if (!fs.existsSync(MUSIC_DIR)) fs.mkdirSync(MUSIC_DIR, { recursive: true });

    const ext = path.extname(req.file.originalname) || '.mp3';
    const filename = `${segId}_${Date.now()}${ext}`;
    const filePath = path.join(MUSIC_DIR, filename);
    fs.writeFileSync(filePath, req.file.buffer);

    const musicUrl = `/api/production/music-files/${filename}`;
    updateSegment(segId, { musicUrl, musicStatus: 'done' });

    res.json({ success: true, musicUrl });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/music-files/:filename', (req, res) => {
  const filePath = path.join(MUSIC_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// ==================== 合成 ====================

const COMPOSE_DIR = path.join(DATA_DIR, 'composed');

router.post('/:id/compose', async (req, res) => {
  try {
    const pid = req.params.id as string;
    const project = getProductionProject(pid);
    if (!project) return res.status(404).json({ error: '项目不存在' });

    const existing = taskManager.getProjectTask(pid, 'full');
    if (existing?.status === 'running') {
      return res.json({ async: true, taskId: existing.taskId, message: '合成任务进行中' });
    }

    const taskId = `production_full_${pid}`;
    res.json({ async: true, taskId, message: '合成任务已启动' });

    composeProject(pid).catch(err => {
      console.error('[production] 合成任务启动异常:', err);
    });
  } catch (err) {
    console.error('[production] compose 路由错误:', err);
    res.status(500).json({ error: String(err) });
  }
});

router.get('/:id/composed', (req, res) => {
  try {
    const pid = req.params.id as string;
    const segments = dbGetSegments(pid);
    const episodes = getProductionEpisodes(pid);
    const episodeMap: Record<string, { composedUrl: string; segments: Array<{ segmentIndex: number; composedUrl: string }> }> = {};

    for (const ep of episodes) {
      episodeMap[ep.id] = {
        composedUrl: ep.composedUrl || '',
        segments: [],
      };
    }

    for (const seg of segments) {
      if (episodeMap[seg.episodeId]) {
        episodeMap[seg.episodeId].segments.push({
          segmentIndex: seg.segmentIndex,
          composedUrl: seg.composedUrl || '',
        });
      }
    }

    res.json({ success: true, episodes: episodeMap });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.get('/composed/:filename', (req, res) => {
  if (!fs.existsSync(COMPOSE_DIR)) return res.status(404).send('Not found');
  const filePath = path.join(COMPOSE_DIR, req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// ==================== 任务管理 ====================

router.get('/tasks/running', (_req, res) => {
  res.json({ success: true, tasks: taskManager.getRunningTasks() });
});

router.get('/:id/tasks', (req, res) => {
  res.json({ success: true, tasks: taskManager.getProjectTasks(req.params.id) });
});

router.post('/:id/stop', (req, res) => {
  const { stage } = req.body;
  taskManager.requestStop(req.params.id, stage);
  res.json({ success: true, message: `已请求停止${stage ? ` ${stage}` : '所有'}任务` });
});

export default router;
