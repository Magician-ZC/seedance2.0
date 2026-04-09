// FFmpeg 合成服务：视频 + 配音 + 配乐 → 段落合成 → 整集拼接
// 流程：
//   1. composeSegment: 单个段落的视频 + 对白音轨 + BGM 混合
//   2. composeEpisode: 将一集的所有段落合成视频拼接成完整剧集
//   3. composeProject: 合成整个项目的所有剧集

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { fetch as undiciFetch } from 'undici';
import {
  getSegments, updateSegment,
  getProductionEpisodes, updateProductionEpisode,
  updateProductionProject,
} from './db-production.js';
import { wsManager } from '../ws-manager.js';
import { taskManager } from './task-manager.js';

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '../../../data');
const COMPOSE_DIR = path.join(DATA_DIR, 'composed');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const MUSIC_DIR = path.join(DATA_DIR, 'music');
const TEMP_DIR = path.join(DATA_DIR, 'compose-temp');

function ensureDirs() {
  for (const d of [COMPOSE_DIR, TEMP_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

// ==================== 下载远程文件到本地 ====================

async function downloadToLocal(url: string, destPath: string): Promise<void> {
  if (url.startsWith('/api/production/')) {
    const localName = url.split('/').pop()!;
    let srcDir = AUDIO_DIR;
    if (url.includes('/music-files/')) srcDir = MUSIC_DIR;
    else if (url.includes('/composed/')) srcDir = COMPOSE_DIR;
    const srcPath = path.join(srcDir, localName);
    if (fs.existsSync(srcPath)) {
      fs.copyFileSync(srcPath, destPath);
      return;
    }
  }

  if (url.startsWith('http')) {
    const resp = await undiciFetch(url);
    if (!resp.ok) throw new Error(`下载失败: ${resp.status} ${url}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return;
  }

  throw new Error(`无法解析资源路径: ${url}`);
}

// ==================== FFmpeg 工具函数 ====================

async function ffmpeg(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync('ffmpeg', args, { maxBuffer: 10 * 1024 * 1024 });
    return stdout + stderr;
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`FFmpeg 错误: ${e.stderr || e.message}`);
  }
}

async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', filePath,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

// ==================== 单段落合成 ====================

export interface ComposeSegmentInput {
  segmentId: string;
  videoUrl: string;
  dialogueAudioUrls: string[];
  musicUrl: string;
  totalDuration: number;
  projectId: string;
  episodeId: string;
  segmentIndex: number;
}

export async function composeSegment(input: ComposeSegmentInput): Promise<string> {
  ensureDirs();
  const tag = `seg${input.segmentIndex}`;
  const tempBase = path.join(TEMP_DIR, `${input.projectId}_${input.episodeId}_${tag}`);

  const videoPath = `${tempBase}_video.mp4`;
  await downloadToLocal(input.videoUrl, videoPath);
  const videoDuration = await getMediaDuration(videoPath);

  const hasDialogue = input.dialogueAudioUrls.length > 0;
  const hasMusic = !!input.musicUrl;

  if (!hasDialogue && !hasMusic) {
    const outName = `${input.projectId}_${input.episodeId}_${tag}_composed.mp4`;
    const outPath = path.join(COMPOSE_DIR, outName);
    fs.copyFileSync(videoPath, outPath);
    cleanup(tempBase);
    return `/api/production/composed/${outName}`;
  }

  // 合并所有对白音频为单条音轨
  let dialoguePath: string | null = null;
  if (hasDialogue) {
    dialoguePath = `${tempBase}_dialogue.mp3`;
    if (input.dialogueAudioUrls.length === 1) {
      await downloadToLocal(input.dialogueAudioUrls[0], dialoguePath);
    } else {
      const listFile = `${tempBase}_dlist.txt`;
      const parts: string[] = [];
      for (let i = 0; i < input.dialogueAudioUrls.length; i++) {
        const partPath = `${tempBase}_d${i}.mp3`;
        await downloadToLocal(input.dialogueAudioUrls[i], partPath);
        parts.push(`file '${partPath}'`);
      }
      fs.writeFileSync(listFile, parts.join('\n'));
      await ffmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', dialoguePath]);
    }
  }

  // 下载音乐并裁剪/循环到视频时长
  let musicPath: string | null = null;
  if (hasMusic) {
    const rawMusicPath = `${tempBase}_music_raw.mp3`;
    await downloadToLocal(input.musicUrl, rawMusicPath);
    musicPath = `${tempBase}_music.mp3`;

    const musicDuration = await getMediaDuration(rawMusicPath);
    if (musicDuration > videoDuration + 1) {
      await ffmpeg(['-y', '-i', rawMusicPath, '-t', String(videoDuration), '-af', `afade=t=out:st=${Math.max(videoDuration - 2, 0)}:d=2`, musicPath]);
    } else if (musicDuration < videoDuration - 1) {
      await ffmpeg(['-y', '-stream_loop', '-1', '-i', rawMusicPath, '-t', String(videoDuration), '-af', `afade=t=out:st=${Math.max(videoDuration - 2, 0)}:d=2`, musicPath]);
    } else {
      fs.copyFileSync(rawMusicPath, musicPath);
    }
  }

  // 混合：视频 + 对白(音量1.0) + 音乐(音量0.3)
  const outName = `${input.projectId}_${input.episodeId}_${tag}_composed.mp4`;
  const outPath = path.join(COMPOSE_DIR, outName);

  const ffArgs: string[] = ['-y', '-i', videoPath];
  const filterParts: string[] = [];
  let audioInputIdx = 1;

  if (dialoguePath) {
    ffArgs.push('-i', dialoguePath);
    filterParts.push(`[${audioInputIdx}:a]aresample=44100,volume=1.0[dialogue]`);
    audioInputIdx++;
  }
  if (musicPath) {
    ffArgs.push('-i', musicPath);
    filterParts.push(`[${audioInputIdx}:a]aresample=44100,volume=0.3[bgm]`);
    audioInputIdx++;
  }

  if (dialoguePath && musicPath) {
    filterParts.push(`[dialogue][bgm]amix=inputs=2:duration=longest:normalize=0[aout]`);
    ffArgs.push('-filter_complex', filterParts.join(';'), '-map', '0:v', '-map', '[aout]');
  } else if (dialoguePath) {
    ffArgs.push('-filter_complex', filterParts.join(';'), '-map', '0:v', '-map', '[dialogue]');
  } else if (musicPath) {
    ffArgs.push('-filter_complex', filterParts.join(';'), '-map', '0:v', '-map', '[bgm]');
  }

  ffArgs.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-shortest', outPath);

  await ffmpeg(ffArgs);
  cleanup(tempBase);

  return `/api/production/composed/${outName}`;
}

// ==================== 整集拼接 ====================

export async function composeEpisode(
  projectId: string,
  episodeId: string,
  segmentComposedUrls: string[],
): Promise<string> {
  ensureDirs();
  const tempBase = path.join(TEMP_DIR, `${projectId}_${episodeId}_episode`);
  const listFile = `${tempBase}_list.txt`;

  const entries: string[] = [];
  for (let i = 0; i < segmentComposedUrls.length; i++) {
    const segPath = `${tempBase}_p${i}.mp4`;
    await downloadToLocal(segmentComposedUrls[i], segPath);
    entries.push(`file '${segPath}'`);
  }

  fs.writeFileSync(listFile, entries.join('\n'));

  const outName = `${projectId}_${episodeId}_full.mp4`;
  const outPath = path.join(COMPOSE_DIR, outName);

  await ffmpeg([
    '-y', '-f', 'concat', '-safe', '0', '-i', listFile,
    '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
    '-c:a', 'aac', '-b:a', '128k',
    outPath,
  ]);

  cleanup(tempBase);
  return `/api/production/composed/${outName}`;
}

// ==================== 项目级别合成入口 ====================

export async function composeProject(projectId: string): Promise<void> {
  const task = taskManager.startTask(projectId, 'full', '开始合成...');

  try {
    const episodes = getProductionEpisodes(projectId);
    const sorted = [...episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
    updateProductionProject(projectId, { status: 'composing' });

    let epDone = 0;

    for (const ep of sorted) {
      const segments = getSegments(projectId, ep.id);
      if (!segments.length) {
        console.log(`[composer] 第${ep.episodeNumber}集无段落，跳过`);
        continue;
      }

      const readySegments = segments.filter(s => s.videoUrl);
      if (!readySegments.length) {
        console.log(`[composer] 第${ep.episodeNumber}集无已生成视频，跳过`);
        continue;
      }

      taskManager.updateProgress(task.taskId, `合成第${ep.episodeNumber}集 (0/${readySegments.length} 段)`, { episodeNumber: ep.episodeNumber });

      const composedSegUrls: string[] = [];
      let segDone = 0;

      for (const seg of readySegments) {
        if (taskManager.shouldStop(task.taskId)) {
          taskManager.updateProgress(task.taskId, '已手动停止');
          return;
        }

        // 收集此段落对应镜头的对白音频
        const dialogueAudioUrls: string[] = [];
        const shotIds: number[] = seg.shotIds;
        const shots: Array<{ audioUrl?: string; audioStatus?: string }> = ep.shots || [];
        for (const sid of shotIds) {
          const shot = shots[sid - 1];
          if (shot?.audioUrl && shot?.audioStatus === 'done') {
            dialogueAudioUrls.push(shot.audioUrl);
          }
        }

        taskManager.updateProgress(task.taskId, `合成第${ep.episodeNumber}集 段落${seg.segmentIndex + 1}`, {
          episodeNumber: ep.episodeNumber, segmentIndex: seg.segmentIndex,
        });

        console.log(`[composer] 合成 ep${ep.episodeNumber} seg${seg.segmentIndex + 1}: video=${!!seg.videoUrl}, dialogue=${dialogueAudioUrls.length}, music=${!!seg.musicUrl}`);

        try {
          const composedUrl = await composeSegment({
            segmentId: seg.id,
            videoUrl: seg.videoUrl,
            dialogueAudioUrls,
            musicUrl: seg.musicUrl,
            totalDuration: seg.totalDuration,
            projectId,
            episodeId: ep.id,
            segmentIndex: seg.segmentIndex,
          });

          updateSegment(seg.id, { composedUrl });
          composedSegUrls.push(composedUrl);
          segDone++;

          taskManager.updateProgress(task.taskId, `第${ep.episodeNumber}集 ${segDone}/${readySegments.length} 段合成完成`, {
            episodeNumber: ep.episodeNumber, segmentsDone: segDone,
          });
        } catch (err) {
          console.error(`[composer] 段落合成失败 ep${ep.episodeNumber} seg${seg.segmentIndex + 1}:`, err);
          taskManager.updateProgress(task.taskId, `第${ep.episodeNumber}集 段落${seg.segmentIndex + 1} 合成失败: ${err}`, {
            episodeNumber: ep.episodeNumber, segmentIndex: seg.segmentIndex, error: String(err),
          });
        }
      }

      // 拼接整集
      if (composedSegUrls.length > 0) {
        taskManager.updateProgress(task.taskId, `拼接第${ep.episodeNumber}集 (${composedSegUrls.length}段)...`);
        try {
          const episodeUrl = await composeEpisode(projectId, ep.id, composedSegUrls);
          updateProductionEpisode(ep.id, { composed_url: episodeUrl, status: 'composed' });
          console.log(`[composer] 第${ep.episodeNumber}集合成完成: ${episodeUrl}`);
        } catch (err) {
          console.error(`[composer] 第${ep.episodeNumber}集拼接失败:`, err);
        }
      }

      epDone++;
      taskManager.updateProgress(task.taskId, `${epDone}/${sorted.length} 集合成完成`);
    }

    updateProductionProject(projectId, { status: 'composed' });
    taskManager.completeTask(task.taskId, `合成完成: ${epDone} 集`);
  } catch (err) {
    console.error('[composer] 合成整体异常:', err);
    taskManager.failTask(task.taskId, String(err));
  }
}

// ==================== 清理临时文件 ====================

function cleanup(tempBase: string) {
  try {
    const dir = path.dirname(tempBase);
    const prefix = path.basename(tempBase);
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(prefix)) {
        fs.unlinkSync(path.join(dir, f));
      }
    }
  } catch { /* ignore */ }
}
