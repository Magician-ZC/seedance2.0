// 图片自动生成服务 - 通过模拟即梦官网 UI 操作生成图片
// 用于：1) 无参考图时自动生成 2) 短剧角色图预生成
import browserService from './browser-service.js';
import { jimengRequest } from './jimeng-api.js';
import { WEB_ID, USER_ID } from './utils.js';

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

  // 轮询等待生图完成
  await new Promise((r) => setTimeout(r, 5000));
  const maxRetries = 30;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const pollResult = await jimengRequest('post', '/mweb/v1/get_history_by_ids', sessionId, {
        data: { history_ids: [historyId] },
      });
      // 兼容两种响应格式
      const historyList = pollResult?.history_list as Array<Record<string, unknown>> | undefined;
      const historyData = historyList?.[0] || (pollResult as Record<string, Record<string, unknown>>)?.[historyId];
      if (!historyData) {
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }

      const status = historyData.status as number;
      if (status === 30) throw new Error('生图内容被过滤，请修改描述后重试');
      if (status === 50) {
        const itemList = historyData.item_list as Array<Record<string, unknown>> || [];
        const results: ImageGenResult[] = [];
        for (const item of itemList) {
          const image = item.image as Record<string, unknown> | undefined;
          const url = (image?.large_image_url || image?.url || image?.image_url) as string;
          const uri = (image?.uri || image?.image_uri) as string;
          if (url) {
            results.push({
              imageUrl: url, imageUri: uri || '',
              width: (image?.width as number) || width,
              height: (image?.height as number) || height,
            });
          }
        }
        if (results.length > 0) {
          console.log(`[image-gen] 生图完成: ${results.length} 张`);
          return results;
        }
        throw new Error('生图完成但未获取到图片URL');
      }

      // 仍在生成中
      await new Promise((r) => setTimeout(r, 3000));
    } catch (err) {
      if ((err as Error).message?.includes('被过滤')) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  throw new Error('生图超时');
}

// 智能判断图片是否符合标准（基于简单规则）
export function validateImageQuality(imageUrl: string): { valid: boolean; reason?: string } {
  if (!imageUrl || !imageUrl.startsWith('http')) {
    return { valid: false, reason: '无效的图片URL' };
  }
  return { valid: true };
}

// 为角色生成多角度参考图
export async function generateCharacterImages(
  characterName: string,
  description: string,
  style: string,
  sessionId: string,
  visualPrompt?: string,
): Promise<ImageGenResult[]> {
  const basePrompt = visualPrompt || `portrait of ${characterName}, ${description}`;

  const angles = [
    `front view full body, ${basePrompt}`,
    `side view full body, ${basePrompt}`,
    `three-quarter view close-up, ${basePrompt}`,
  ];

  const allResults: ImageGenResult[] = [];
  for (const anglePrompt of angles) {
    try {
      const results = await generateImage(anglePrompt, sessionId, {
        width: 768, height: 1024, count: 1, style,
      });
      allResults.push(...results);
    } catch (err) {
      console.error(`[image-gen] 角色图生成失败 (${characterName}): ${(err as Error).message}`);
    }
    // 间隔避免请求过快
    await new Promise((r) => setTimeout(r, 2000));
  }
  return allResults;
}
