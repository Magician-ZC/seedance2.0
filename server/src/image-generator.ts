// 图片自动生成服务 - 通过模拟即梦官网 UI 操作生成图片
// 用于：1) 无参考图时自动生成 2) 短剧角色图预生成
import browserService from './browser-service.js';
import { WEB_ID, USER_ID, DEFAULT_ASSISTANT_ID, JIMENG_BASE_URL, FAKE_HEADERS } from './utils.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 图片存储目录：data/images/
const IMAGES_DIR = path.join(__dirname, '../../data/images');

// 确保图片目录存在
function ensureImagesDir(): void {
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// 下载即梦图片到本地，返回本地文件名
// 环境可能有自签名证书（代理/VPN），需要跳过 TLS 验证
import https from 'https';

// 创建忽略 TLS 验证的 agent（解决 SELF_SIGNED_CERT_IN_CHAIN）
const tlsAgent = new https.Agent({ rejectUnauthorized: false });

export function httpsDownload(imageUrl: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doGet = (url: string, redirects = 0) => {
      if (redirects > 5) { reject(new Error('Too many redirects')); return; }
      const u = new URL(url);
      https.get({
        hostname: u.hostname, path: u.pathname + u.search, port: u.port || 443,
        agent: tlsAgent,
        headers: {
          'User-Agent': FAKE_HEADERS['User-Agent'],
          'Referer': 'https://jimeng.jianying.com/',
          'Accept': 'image/*,*/*',
        },
      }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          doGet(res.headers.location!, redirects + 1);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      }).on('error', reject);
    };
    doGet(imageUrl);
  });
}

export async function downloadImageToLocal(
  imageUrl: string,
  sessionId: string,
  prefix: string = 'img',
  subDir?: string,
): Promise<string> {
  const targetDir = subDir ? path.join(IMAGES_DIR, subDir) : IMAGES_DIR;
  if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
  const ext = '.jpg';
  const filename = `${prefix}_${crypto.randomUUID().substring(0, 8)}${ext}`;
  const filepath = path.join(targetDir, filename);
  // 返回的文件名包含子目录前缀，供 /api/images/ 静态服务使用
  const relName = subDir ? `${subDir}/${filename}` : filename;

  let buffer: Buffer;

  // 优先用 https 模块下载（跳过 TLS 验证，解决自签名证书问题）
  try {
    buffer = await httpsDownload(imageUrl);
  } catch (err) {
    console.log(`[image-gen] https 下载失败: ${(err as Error).message}，尝试浏览器代理...`);
    // 降级用浏览器代理
    try {
      const base64 = await browserService.downloadAsBase64(sessionId, WEB_ID, USER_ID, imageUrl);
      buffer = Buffer.from(base64, 'base64');
    } catch (err2) {
      console.log(`[image-gen] 浏览器代理也失败: ${(err2 as Error).message}`);
      throw new Error(`图片下载失败: ${(err as Error).message}`);
    }
  }

  if (buffer.length < 1000) {
    throw new Error(`图片内容异常 (${buffer.length} bytes)，可能链接已过期`);
  }

  fs.writeFileSync(filepath, buffer);
  console.log(`[image-gen] 图片已下载到本地: ${relName} (${(buffer.length / 1024).toFixed(1)}KB)`);
  return relName;
}

// 删除本地图片文件（filename 可能包含子目录如 projectId/characters/xxx.jpg）
export function deleteLocalImage(filename: string): void {
  const filepath = path.join(IMAGES_DIR, filename);
  if (fs.existsSync(filepath)) {
    fs.unlinkSync(filepath);
    console.log(`[image-gen] 已删除本地图片: ${filename}`);
  }
}

// 获取本地图片的完整文件路径
export function getLocalImagePath(filename: string): string {
  return path.join(IMAGES_DIR, filename);
}

// 判断是否是本地图片路径（以 /api/images/ 开头）
export function isLocalImageUrl(url: string): boolean {
  return url.startsWith('/api/images/');
}

// 从本地 URL 提取文件名
export function localUrlToFilename(url: string): string {
  return url.replace('/api/images/', '');
}

interface ImageGenResult {
  imageUrl: string;
  imageUri: string;
  width: number;
  height: number;
}

// 通过即梦官网 UI 操作生成图片（输入prompt → 点击生成 → 捕获结果）
export async function generateImage(
  prompt: string,
  sessionId: string,
  options: {
    width?: number;
    height?: number;
    count?: number;
    style?: string;
  } = {},
): Promise<ImageGenResult[]> {
  const { width = 1024, height = 1024, style } = options;
  const fullPrompt = style ? `${style}, ${prompt}` : prompt;

  console.log(`[image-gen] 生成图片: "${fullPrompt.substring(0, 80)}..."`);

  // 通过 UI 操作提交生图请求，获取 historyId
  const { historyId } = await browserService.generateImageViaUI(sessionId, WEB_ID, USER_ID, fullPrompt);
  console.log(`[image-gen] 生图请求已提交, historyId: ${historyId}`);

  // 轮询等待生图完成（与 video-generator 对齐策略）
  await new Promise((r) => setTimeout(r, 5000));
  const maxRetries = 60;
  const startTime = Date.now();

  for (let i = 0; i < maxRetries; i++) {
    try {
      // 通过浏览器代理轮询（即梦有反爬，直接 fetch 会失败）
      const pollUrl = `${JIMENG_BASE_URL}/mweb/v1/get_history_by_ids?aid=${DEFAULT_ASSISTANT_ID}&device_platform=web&region=cn`;
      const rawResult = await browserService.fetch(sessionId, WEB_ID, USER_ID, pollUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history_ids: [historyId] }),
      }) as Record<string, unknown>;

      // browserService.fetch 返回完整响应，需要从 data 层取
      const pollData = (String(rawResult.ret) === '0' ? rawResult.data : rawResult) as Record<string, unknown>;
      const historyList = pollData?.history_list as Array<Record<string, unknown>> | undefined;
      const historyData = historyList?.[0] || (pollData as Record<string, Record<string, unknown>>)?.[historyId];
      if (!historyData) {
        const waitTime = Math.min(2000 * (i + 1), 10000);
        console.log(`[image-gen] 轮询 #${i + 1}: 数据不存在，等待 ${waitTime}ms`);
        await new Promise((r) => setTimeout(r, waitTime));
        continue;
      }

      const status = historyData.status as number;
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`[image-gen] 轮询 #${i + 1}: status=${status}, 已等待 ${elapsed}s`);

      if (status === 30) throw new Error('生图内容被过滤，请修改描述后重试');
      if (status === 50) {
        const itemList = historyData.item_list as Array<Record<string, unknown>> || [];
        const results: ImageGenResult[] = [];
        for (const item of itemList) {
          const image = item.image as Record<string, unknown> | undefined;
          if (!image) continue;
          // 新版API: image.large_images 数组中包含图片信息
          const largeImages = image.large_images as Array<Record<string, unknown>> | undefined;
          if (largeImages && largeImages.length > 0) {
            const img = largeImages[0];
            const url = img.image_url as string;
            const uri = img.image_uri as string;
            if (url) {
              results.push({
                imageUrl: url, imageUri: uri || '',
                width: (img.width as number) || width,
                height: (img.height as number) || height,
              });
              continue;
            }
          }
          // 兼容旧版API格式
          const url = (image.large_image_url || image.url || image.image_url) as string;
          const uri = (image.uri || image.image_uri) as string;
          if (url) {
            results.push({
              imageUrl: url, imageUri: uri || '',
              width: (image.width as number) || width,
              height: (image.height as number) || height,
            });
          }
        }
        if (results.length > 0) {
          console.log(`[image-gen] 生图完成: ${results.length} 张, 耗时 ${elapsed}s`);
          return results;
        }
        throw new Error('生图完成但未获取到图片URL');
      }

      // 仍在生成中，递增等待（最长10秒）
      const waitTime = Math.min(2000 * Math.min(i + 1, 5), 10000);
      await new Promise((r) => setTimeout(r, waitTime));
    } catch (err) {
      if ((err as Error).message?.includes('被过滤')) throw err;
      const waitTime = Math.min(2000 * (i + 1), 10000);
      console.log(`[image-gen] 轮询出错: ${(err as Error).message}, 等待 ${waitTime}ms 重试`);
      await new Promise((r) => setTimeout(r, waitTime));
    }
  }

  const totalElapsed = Math.floor((Date.now() - startTime) / 1000);
  throw new Error(`生图超时 (${totalElapsed}s)`);
}

// 智能判断图片是否符合标准（基于简单规则）
export function validateImageQuality(imageUrl: string): { valid: boolean; reason?: string } {
  if (!imageUrl || !imageUrl.startsWith('http')) {
    return { valid: false, reason: '无效的图片URL' };
  }
  return { valid: true };
}

// 角色档案图片类型标签
export type ProfileImageType = 'main' | 'front' | 'side' | 'back' | 'costume' | 'props' | 'expressions';

// 角色档案生成结果
export interface CharacterProfileResult {
  mainCandidates: ImageGenResult[];  // 主图候选（4张）
  detailImages: Array<{ type: ProfileImageType; images: ImageGenResult[] }>;  // 多角度/细节图
}

// 第一阶段：生成全身主图候选（1次API调用，返回4张）
export async function generateCharacterMainImages(
  characterName: string,
  description: string,
  style: string,
  sessionId: string,
  visualPrompt?: string,
  refImageUrl?: string,
): Promise<ImageGenResult[]> {
  const baseDesc = visualPrompt || `${characterName}, ${description}`;
  const refHint = refImageUrl ? ', 保持与参考图中人物的外貌特征一致' : '';
  const prompt = `全身立绘, 白色简洁背景, 角色设定图, ${baseDesc}${refHint}, 高质量, 细节丰富, 全身可见`;

  console.log(`[image-gen] 生成角色主图候选: "${characterName}"`);
  return generateImage(prompt, sessionId, { width: 768, height: 1024, count: 4, style });
}

// 第二阶段：基于主图描述生成多角度/细节图
export async function generateCharacterDetailImages(
  characterName: string,
  description: string,
  style: string,
  sessionId: string,
  visualPrompt?: string,
  detailTypes: ProfileImageType[] = ['front', 'side', 'back', 'costume'],
  onProgress?: (done: number, total: number) => void,
): Promise<Array<{ type: ProfileImageType; images: ImageGenResult[] }>> {
  const baseDesc = visualPrompt || `${characterName}, ${description}`;
  const total = detailTypes.length;
  let done = 0;
  onProgress?.(0, total);

  // 各角度/细节的 prompt 模板
  const promptMap: Record<ProfileImageType, string> = {
    main: `全身立绘, 白色简洁背景, ${baseDesc}`,
    front: `正面全身照, 白色简洁背景, 角色设定图, ${baseDesc}, 面朝镜头, 全身可见`,
    side: `侧面全身照, 白色简洁背景, 角色设定图, ${baseDesc}, 左侧面, 全身可见`,
    back: `背面全身照, 白色简洁背景, 角色设定图, ${baseDesc}, 背对镜头, 全身可见`,
    costume: `服装细节特写, 白色简洁背景, ${baseDesc}, 服装设计细节, 面料质感, 配饰`,
    props: `道具特写, 白色简洁背景, ${baseDesc}, 角色标志性道具, 细节展示`,
    expressions: `表情特写, ${baseDesc}, 面部表情合集, 多种情绪, 喜怒哀乐`,
  };

  const results: Array<{ type: ProfileImageType; images: ImageGenResult[] }> = [];

  // 串行生成（避免即梦 UI 并发冲突）
  for (const type of detailTypes) {
    try {
      const prompt = promptMap[type];
      const imgs = await generateImage(prompt, sessionId, { width: 768, height: 1024, count: 1, style });
      results.push({ type, images: imgs });
    } catch (err) {
      console.error(`[image-gen] 角色细节图生成失败 (${characterName}/${type}): ${(err as Error).message}`);
      results.push({ type, images: [] });
    }
    done++;
    onProgress?.(done, total);
  }

  return results;
}

// 为角色生成多角度参考图（兼容旧版：3个角度并发）
export async function generateCharacterImages(
  characterName: string,
  description: string,
  style: string,
  sessionId: string,
  visualPrompt?: string,
  onProgress?: (done: number, total: number) => void,
  refImageUrl?: string,
): Promise<ImageGenResult[]> {
  // 全中文 prompt，直接用角色描述，不混入英文
  const baseDesc = visualPrompt || `${characterName}, ${description}`;
  // 如果有参考图，在 prompt 中提示保持一致性
  const refHint = refImageUrl ? ', 保持与参考图中人物的外貌特征一致' : '';

  const angles = [
    `正面全身照, ${baseDesc}${refHint}`,
    `侧面全身照, ${baseDesc}${refHint}`,
    `四分之三侧面特写, ${baseDesc}${refHint}`,
  ];

  const total = angles.length;
  let done = 0;
  onProgress?.(0, total);

  // 并发生成所有角度
  const results = await Promise.allSettled(
    angles.map(async (anglePrompt, i) => {
      // 错开提交时间避免同时点击UI
      await new Promise(r => setTimeout(r, i * 2000));
      const imgs = await generateImage(anglePrompt, sessionId, {
        width: 768, height: 1024, count: 1, style,
      });
      done++;
      onProgress?.(done, total);
      return imgs;
    }),
  );

  const allResults: ImageGenResult[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') allResults.push(...r.value);
    else console.error(`[image-gen] 角色图生成失败 (${characterName}): ${r.reason?.message}`);
  }
  return allResults;
}
