import type { GenerateVideoRequest, VideoGenerationResponse } from '../types';
import { wsService } from './wsService';

export async function generateVideo(
  request: GenerateVideoRequest,
  onProgress?: (message: string) => void,
): Promise<VideoGenerationResponse> {
  const formData = new FormData();
  formData.append('prompt', request.prompt);
  formData.append('model', request.model);
  formData.append('ratio', request.ratio);
  formData.append('duration', String(request.duration));
  if (request.sessionId) formData.append('sessionId', request.sessionId);
  if (request.autoGenImage) formData.append('autoGenImage', 'true');
  for (const file of request.files) formData.append('files', file);

  // 第1步: 提交任务
  onProgress?.('正在提交视频生成请求...');
  const submitRes = await fetch('/api/generate-video', { method: 'POST', body: formData });
  const submitData = await submitRes.json();
  if (!submitRes.ok) throw new Error(submitData.error || `提交失败 (HTTP ${submitRes.status})`);

  const { taskId } = submitData;
  if (!taskId) throw new Error('服务器未返回任务ID');

  // 第2步: 优先使用 WebSocket，回退到轮询
  return new Promise<VideoGenerationResponse>((resolve, reject) => {
    let settled = false;
    let unsubscribe: (() => void) | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const cleanup = () => {
      if (unsubscribe) unsubscribe();
      if (pollTimer) clearInterval(pollTimer);
    };

    // WebSocket 监听
    unsubscribe = wsService.subscribe(taskId, (msg) => {
      if (settled) return;
      if (msg.data.progress) onProgress?.(msg.data.progress);
      if (msg.type === 'task_done' && msg.data.result) {
        settled = true;
        cleanup();
        resolve(msg.data.result);
      }
      if (msg.type === 'task_error') {
        settled = true;
        cleanup();
        reject(new Error(msg.data.error || '视频生成失败'));
      }
    });

    // 轮询兜底 (WebSocket 可能连接失败)
    const maxPollTime = 25 * 60 * 1000;
    const startTime = Date.now();
    pollTimer = setInterval(async () => {
      if (settled) return;
      if (Date.now() - startTime > maxPollTime) {
        settled = true;
        cleanup();
        reject(new Error('视频生成超时，请稍后重试'));
        return;
      }
      try {
        const res = await fetch(`/api/task/${taskId}`);
        const data = await res.json();
        if (data.status === 'done' && data.result?.data?.[0]?.url) {
          settled = true;
          cleanup();
          resolve(data.result);
        } else if (data.status === 'error') {
          settled = true;
          cleanup();
          reject(new Error(data.error || '视频生成失败'));
        } else if (data.progress) {
          onProgress?.(data.progress);
        }
      } catch { /* ignore poll errors */ }
    }, 5000);
  });
}
