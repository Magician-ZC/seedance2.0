// 视频生成编排：支持逐段落（Segment）和逐镜头（Shot）两种模式
// 段落模式注入资产参考图、段间过渡提示
import { generateSeedanceVideo } from '../video-generator.js';
import { uploadImageBuffer } from '../upload.js';
import { wsManager } from '../ws-manager.js';
import type { TaskInfo, GenerateVideoParams } from '../types.js';
import {
  getProductionEpisodes, updateProductionEpisode,
  getProductionAssets, updateProductionProject,
  getSegments as dbGetSegments, updateSegment,
} from './db-production.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { httpsDownload } from '../image-generator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROD_IMAGES_DIR = path.join(__dirname, '../../../data/production-images');

interface VideoGenContext {
  projectId: string;
  sessionId: string;
  ratio: string;
  useSegments?: boolean;
}

// ==================== 主入口 ====================

export async function batchGenerateProductionVideos(ctx: VideoGenContext): Promise<void> {
  const segments = dbGetSegments(ctx.projectId);
  if (ctx.useSegments !== false && segments.length > 0) {
    await generateBySegments(ctx, segments);
  } else {
    await generateByShots(ctx);
  }
}

// ==================== 逐段落生成 ====================

async function generateBySegments(
  ctx: VideoGenContext,
  segments: Array<{
    id: string; episodeId: string; segmentIndex: number;
    totalDuration: number; mergedPrompt: string; transitionHint: string;
    shotIds: number[]; videoStatus: string; videoUrl: string;
  }>,
): Promise<void> {
  const { projectId, sessionId } = ctx;
  const assets = getProductionAssets(projectId);
  const characterAssets = assets.filter(a => a.assetType === 'character');

  updateProductionProject(projectId, { status: 'generating' });
  wsManager.broadcastJSON(`production_batch_${projectId}`, { type: 'batch_start', totalSegments: segments.length, mode: 'segment' });

  const tasks = new Map<string, TaskInfo>();
  let taskCounter = 0;
  let prevSegPrompt = '';

  for (const seg of segments) {
    if (seg.videoStatus === 'done' && seg.videoUrl) continue;

    const segNum = seg.segmentIndex + 1;
    wsManager.broadcastJSON(`production_batch_${projectId}`, { type: 'segment_start', segmentIndex: seg.segmentIndex, episodeId: seg.episodeId });

    updateSegment(seg.id, { videoStatus: 'generating' });

    // 构建带过渡的 prompt
    let prompt = seg.mergedPrompt;
    if (prevSegPrompt) {
      prompt = `[承接上一段: ${prevSegPrompt.slice(-80)}] ${prompt}`;
    }
    if (seg.transitionHint) {
      prompt = `${prompt}. [过渡: ${seg.transitionHint}]`;
    }

    const taskId = `prod_seg_${projectId}_${++taskCounter}_${Date.now()}`;
    const taskInfo: TaskInfo = {
      id: taskId, status: 'processing', progress: '准备生成...',
      startTime: Date.now(), result: null, error: null,
      prompt, ratio: ctx.ratio || '9:16',
    };
    tasks.set(taskId, taskInfo);

    // 收集资产参考图（预上传到 ImageX）
    const preUploadedUris: string[] = [];
    for (const charAsset of characterAssets) {
      const imgUrls: string[] = charAsset.imageUrls || [];
      if (imgUrls.length === 0) continue;
      try {
        const refUrl = imgUrls[0];
        const imageUri = await resolveAssetImageUri(refUrl, sessionId);
        if (imageUri) {
          preUploadedUris.push(imageUri);
          break;
        }
      } catch (err) {
        console.error(`[video-orch] 资产图上传失败: ${charAsset.name}`, err);
      }
    }

    try {
      const duration = Math.min(Math.round(seg.totalDuration), 15);
      const params: GenerateVideoParams = {
        prompt,
        ratio: ctx.ratio || '9:16',
        duration: Math.max(duration, 3),
        files: [],
        preUploadedUris,
        sessionId,
        model: 'seedance-2.0',
      };

      console.log(`[video-orch] 段落${segNum} 生成: ${duration}s, ${preUploadedUris.length}张参考图`);
      const videoUrl = await generateSeedanceVideo(taskId, params, tasks);

      if (videoUrl) {
        updateSegment(seg.id, { videoUrl, videoStatus: 'done' });
        wsManager.broadcastJSON(`production_batch_${projectId}`, { type: 'segment_complete', segmentIndex: seg.segmentIndex, status: 'done' });
      } else {
        updateSegment(seg.id, { videoStatus: 'error' });
        wsManager.broadcastJSON(`production_batch_${projectId}`, { type: 'segment_complete', segmentIndex: seg.segmentIndex, status: 'error' });
      }
    } catch (err) {
      console.error(`[video-orch] 段落${segNum} 失败:`, err);
      updateSegment(seg.id, { videoStatus: 'error' });
    }

    prevSegPrompt = prompt;
  }

  updateProductionProject(projectId, { status: 'voice_generating' });
  wsManager.broadcastJSON(`production_batch_${projectId}`, { type: 'batch_complete', mode: 'segment' });
}

// ==================== 解析资产图片到 imageUri ====================

async function resolveAssetImageUri(refUrl: string, sessionId: string): Promise<string | null> {
  if (refUrl.startsWith('/api/production/images/')) {
    const filename = refUrl.replace('/api/production/images/', '');
    const localPath = path.join(PROD_IMAGES_DIR, filename);
    if (fs.existsSync(localPath)) {
      const buf = fs.readFileSync(localPath);
      const imageUri = await uploadImageBuffer(buf, sessionId);
      return imageUri || null;
    }
    return null;
  }

  if (refUrl.startsWith('http')) {
    const buf = await httpsDownload(refUrl);
    const imageUri = await uploadImageBuffer(buf, sessionId);
    return imageUri || null;
  }

  return null;
}

// ==================== 逐镜头生成（旧模式，兜底） ====================

async function generateByShots(ctx: VideoGenContext): Promise<void> {
  const { projectId, sessionId } = ctx;
  const episodes = getProductionEpisodes(projectId);

  updateProductionProject(projectId, { status: 'generating' });
  wsManager.broadcastJSON(`production_batch_${projectId}`, { type: 'batch_start', totalEpisodes: episodes.length, mode: 'shot' });

  const tasks = new Map<string, TaskInfo>();
  let taskCounter = 0;

  for (const episode of episodes) {
    if (episode.status === 'done' || episode.status === 'composed') continue;

    wsManager.broadcastJSON(`production_batch_${projectId}`, { type: 'episode_start', episodeNumber: episode.episodeNumber });

    const shots = episode.shots || [];

    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i];
      if (shot.videoStatus === 'done' && shot.videoUrl) continue;

      try {
        shots[i] = { ...shot, videoStatus: 'generating' };
        updateProductionEpisode(episode.id, { shots_data: JSON.stringify(shots), status: 'generating' });

        const prompt = buildVideoPrompt(shot);
        const taskId = `prod_${projectId}_${++taskCounter}_${Date.now()}`;

        const taskInfo: TaskInfo = {
          id: taskId, status: 'processing', progress: '准备生成...',
          startTime: Date.now(), result: null, error: null,
          prompt, ratio: ctx.ratio || '9:16',
        };
        tasks.set(taskId, taskInfo);

        const params: GenerateVideoParams = {
          prompt, ratio: ctx.ratio || '9:16',
          duration: Math.min(shot.duration || 3, 5),
          files: [], sessionId, model: 'seedance-2.0',
        };

        const videoUrl = await generateSeedanceVideo(taskId, params, tasks);

        if (videoUrl) {
          shots[i] = { ...shots[i], videoUrl, videoStatus: 'done', videoError: undefined };
        } else {
          shots[i] = { ...shots[i], videoStatus: 'error', videoError: taskInfo.error || '生成失败' };
        }
      } catch (err) {
        shots[i] = { ...shots[i], videoStatus: 'error', videoError: String(err) };
      }

      updateProductionEpisode(episode.id, { shots_data: JSON.stringify(shots) });

      wsManager.broadcastJSON(`production_batch_${projectId}`, {
        type: 'shot_complete', episodeNumber: episode.episodeNumber, shotIndex: i, status: shots[i].videoStatus,
      });
    }

    const allDone = shots.every((s: { videoStatus?: string }) => s.videoStatus === 'done');
    const lastVideo = [...shots].reverse().find((s: { videoUrl?: string }) => s.videoUrl)?.videoUrl;
    updateProductionEpisode(episode.id, {
      shots_data: JSON.stringify(shots),
      status: allDone ? 'shots_ready' : 'generating',
      video_url: lastVideo || '',
    });

    wsManager.broadcastJSON(`production_batch_${projectId}`, {
      type: 'episode_complete', episodeNumber: episode.episodeNumber, allDone,
    });
  }

  updateProductionProject(projectId, { status: 'voice_generating' });
  wsManager.broadcastJSON(`production_batch_${projectId}`, { type: 'batch_complete', mode: 'shot' });
}

function buildVideoPrompt(
  shot: { content: string; cameraWork?: string; visualRequirement?: string }
): string {
  const parts: string[] = [];
  parts.push(shot.content);
  if (shot.cameraWork) parts.push(`Camera: ${shot.cameraWork}`);
  if (shot.visualRequirement) parts.push(`Style: ${shot.visualRequirement}`);
  return parts.join('. ');
}
