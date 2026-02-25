// 图片自动生成服务 - 调用即梦平台生图 API
// 用于：1) 无参考图时自动生成 2) 短剧角色图预生成
import browserService from './browser-service.js';
import { jimengRequest } from './jimeng-api.js';
import { generateUUID, WEB_ID, USER_ID, DEFAULT_ASSISTANT_ID, JIMENG_BASE_URL } from './utils.js';

interface ImageGenResult {
  imageUrl: string;
  imageUri: string;
  width: number;
  height: number;
}

// 调用即梦文生图 API
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
  const { width = 1024, height = 1024, count = 1, style } = options;
  const fullPrompt = style ? `${style}, ${prompt}` : prompt;

  console.log(`[image-gen] 生成图片: "${fullPrompt.substring(0, 60)}..." (${width}x${height}, ${count}张)`);

  const submitId = generateUUID();
  const componentId = generateUUID();

  const generateQueryParams = new URLSearchParams({
    aid: String(DEFAULT_ASSISTANT_ID),
    device_platform: 'web',
    region: 'cn',
    webId: String(WEB_ID),
    da_version: '3.3.9',
    web_component_open_flag: '1',
    web_version: '7.5.0',
    aigc_features: 'app_lip_sync',
  });
  const generateUrl = `${JIMENG_BASE_URL}/mweb/v1/aigc_draft/generate?${generateQueryParams}`;

  const generateBody = {
    extend: { root_model: 'high_aes_general_v30' },
    submit_id: submitId,
    metrics_extra: JSON.stringify({ isDefaultSeed: 1, originSubmitId: submitId }),
    draft_content: JSON.stringify({
      type: 'draft',
      id: generateUUID(),
      min_version: '3.3.9',
      version: '3.3.9',
      main_component_id: componentId,
      component_list: [{
        type: 'image_base_component',
        id: componentId,
        min_version: '1.0.0',
        generate_type: 'gen_image',
        aigc_mode: 'workbench',
        abilities: {
          type: '', id: generateUUID(),
          gen_image: {
            type: '', id: generateUUID(),
            text_to_image_params: {
              type: '', id: generateUUID(),
              prompt: fullPrompt,
              image_aspect_ratio: `${width}:${height}`,
              seed: Math.floor(Math.random() * 1000000000),
              model_req_key: 'high_aes_general_v30',
              generate_count: count,
              image_gen_inputs: [{
                type: '', id: generateUUID(),
                prompt: fullPrompt,
              }],
            },
          },
        },
        process_type: 1,
      }],
    }),
    http_common_info: { aid: DEFAULT_ASSISTANT_ID },
  };

  const result = await browserService.fetch(sessionId, WEB_ID, USER_ID, generateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(generateBody),
  }) as Record<string, unknown>;

  if (result.ret !== undefined && String(result.ret) !== '0') {
    throw new Error(`生图失败 (ret=${result.ret}): ${result.errmsg || '未知错误'}`);
  }

  const aigcData = (result.data as Record<string, unknown>)?.aigc_data as Record<string, unknown>;
  const historyId = aigcData?.history_record_id as string;
  if (!historyId) throw new Error('生图未获取到记录ID');

  console.log(`[image-gen] 生图请求已提交, historyId: ${historyId}`);

  // 轮询等待生图完成
  await new Promise((r) => setTimeout(r, 3000));
  const maxRetries = 30;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const pollResult = await jimengRequest('post', '/mweb/v1/get_history_by_ids', sessionId, {
        data: { history_ids: [historyId] },
      });
      const historyList = pollResult?.history_list as Array<Record<string, unknown>> | undefined;
      const historyData = historyList?.[0];
      if (!historyData) {
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const status = historyData.status as number;
      if (status === 30) throw new Error('生图内容被过滤');
      if (status === 50) {
        // 完成
        const itemList = historyData.item_list as Array<Record<string, unknown>> || [];
        const results: ImageGenResult[] = [];
        for (const item of itemList) {
          const image = item.image as Record<string, unknown> | undefined;
          const url = (image?.large_image_url || image?.url || image?.image_url) as string;
          const uri = (image?.uri || image?.image_uri) as string;
          if (url) {
            results.push({
              imageUrl: url,
              imageUri: uri || '',
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
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      if ((err as Error).message?.includes('被过滤')) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  throw new Error('生图超时');
}

// 智能判断图片是否符合标准（基于简单规则）
export function validateImageQuality(imageUrl: string): { valid: boolean; reason?: string } {
  // 基础验证：URL 是否有效
  if (!imageUrl || !imageUrl.startsWith('http')) {
    return { valid: false, reason: '无效的图片URL' };
  }
  // 实际的质量判断需要视觉模型，这里返回通过
  // 后续可以接入视觉 AI 做更精确的判断
  return { valid: true };
}

// 为角色生成多角度参考图
export async function generateCharacterImages(
  characterName: string,
  description: string,
  style: string,
  sessionId: string,
): Promise<ImageGenResult[]> {
  const angles = [
    `front view full body portrait of ${characterName}, ${description}`,
    `side view full body portrait of ${characterName}, ${description}`,
    `three-quarter view close-up of ${characterName}, ${description}`,
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
