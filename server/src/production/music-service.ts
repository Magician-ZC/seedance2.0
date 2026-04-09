// 音乐生成服务：Suno API 封装 + 自动 prompt 生成 + 手动上传支持
import { fetch as undiciFetch } from 'undici';
import crypto from 'crypto';
import type { Segment } from './segment-builder.js';

// ==================== Suno Config ====================

interface SunoConfig {
  apiKey: string;
  baseUrl: string;
}

let sunoConfig: SunoConfig | null = null;

export function setSunoConfig(config: SunoConfig): void {
  sunoConfig = config;
}

export function getSunoConfig(): SunoConfig | null {
  return sunoConfig;
}

// ==================== Prompt 生成 ====================

const EMOTION_MUSIC_MAP: Record<string, string> = {
  '紧张': 'tense, suspenseful, thriller',
  '悲伤': 'melancholic, sad, emotional piano',
  '开心': 'upbeat, cheerful, happy pop',
  '浪漫': 'romantic, warm, soft strings',
  '恐怖': 'horror, dark ambient, eerie',
  '愤怒': 'aggressive, intense, heavy drums',
  '平静': 'calm, ambient, peaceful',
  '搞笑': 'funny, quirky, comedic',
  '史诗': 'epic, orchestral, cinematic',
  '温馨': 'warm, heartfelt, gentle acoustic',
};

export function generateMusicPrompt(segment: Segment): string {
  const keywords: string[] = [];

  for (const shot of segment.shots) {
    if (shot.soundDesign) {
      keywords.push(shot.soundDesign);
    }
    for (const [emotion, style] of Object.entries(EMOTION_MUSIC_MAP)) {
      if (shot.content.includes(emotion) || (shot.soundDesign && shot.soundDesign.includes(emotion))) {
        keywords.push(style);
      }
    }
  }

  const unique = [...new Set(keywords)];
  if (unique.length === 0) {
    unique.push('cinematic, atmospheric, background music');
  }

  const durationHint = segment.totalDuration <= 5
    ? 'short musical piece'
    : segment.totalDuration <= 10
    ? 'medium-length background music'
    : 'full background music track';

  return `${durationHint}, ${unique.slice(0, 5).join(', ')}, no vocals, instrumental only`;
}

// ==================== Suno API 调用 ====================

interface SunoGenerateResult {
  id: string;
  audioUrl: string;
  duration: number;
  status: string;
}

export async function generateMusic(
  prompt: string,
  duration: number,
): Promise<SunoGenerateResult> {
  if (!sunoConfig) throw new Error('Suno API 未配置');

  const baseUrl = sunoConfig.baseUrl || 'https://api.suno.ai/v1';
  const reqId = crypto.randomUUID();

  console.log(`[music] 调用 Suno 生成音乐: "${prompt.slice(0, 60)}..." (${duration}s)`);

  const resp = await undiciFetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${sunoConfig.apiKey}`,
    },
    body: JSON.stringify({
      prompt,
      duration: Math.min(duration, 30),
      instrumental: true,
      request_id: reqId,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Suno API 请求失败: ${resp.status} ${errText}`);
  }

  const result = await resp.json() as { id: string; audio_url?: string; status: string; duration?: number };

  if (result.audio_url) {
    console.log(`[music] Suno 生成完成: ${result.id}`);
    return {
      id: result.id,
      audioUrl: result.audio_url,
      duration: result.duration || duration,
      status: 'done',
    };
  }

  // 异步模式：返回 task ID，需要轮询
  return {
    id: result.id,
    audioUrl: '',
    duration: 0,
    status: 'pending',
  };
}

export async function pollMusicStatus(taskId: string): Promise<SunoGenerateResult> {
  if (!sunoConfig) throw new Error('Suno API 未配置');

  const baseUrl = sunoConfig.baseUrl || 'https://api.suno.ai/v1';
  const maxRetries = 60;

  for (let i = 0; i < maxRetries; i++) {
    await new Promise(r => setTimeout(r, 5000));

    const resp = await undiciFetch(`${baseUrl}/status/${taskId}`, {
      headers: { 'Authorization': `Bearer ${sunoConfig.apiKey}` },
    });

    if (!resp.ok) continue;

    const result = await resp.json() as { status: string; audio_url?: string; duration?: number };

    if (result.status === 'done' && result.audio_url) {
      return {
        id: taskId,
        audioUrl: result.audio_url,
        duration: result.duration || 0,
        status: 'done',
      };
    }

    if (result.status === 'error') {
      throw new Error(`Suno 生成失败: ${taskId}`);
    }
  }

  throw new Error(`Suno 生成超时: ${taskId}`);
}

// ==================== 批量生成 ====================

export async function generateMusicForSegments(
  segments: Segment[],
  onProgress?: (segIdx: number, status: string) => void,
): Promise<Map<number, SunoGenerateResult>> {
  const results = new Map<number, SunoGenerateResult>();

  for (const seg of segments) {
    const prompt = generateMusicPrompt(seg);
    onProgress?.(seg.segmentIndex, `生成第${seg.segmentIndex + 1}段音乐: "${prompt.slice(0, 40)}..."`);

    try {
      let result = await generateMusic(prompt, seg.totalDuration);
      if (result.status === 'pending') {
        onProgress?.(seg.segmentIndex, `等待第${seg.segmentIndex + 1}段音乐生成完成...`);
        result = await pollMusicStatus(result.id);
      }
      results.set(seg.segmentIndex, result);
      onProgress?.(seg.segmentIndex, `第${seg.segmentIndex + 1}段音乐完成`);
    } catch (err) {
      console.error(`[music] 段落 ${seg.segmentIndex} 音乐生成失败:`, err);
      onProgress?.(seg.segmentIndex, `第${seg.segmentIndex + 1}段音乐失败: ${err}`);
    }
  }

  return results;
}
