// Seedance 2.0 视频生成核心逻辑
import { uploadImageBuffer } from './upload.js';
import { jimengRequest } from './jimeng-api.js';
import browserService from './browser-service.js';
import { generateUUID, WEB_ID, USER_ID, DEFAULT_ASSISTANT_ID, JIMENG_BASE_URL, SEEDANCE_DRAFT_VERSION } from './utils.js';
import type { TaskInfo, GenerateVideoParams, UploadedImage, MetaItem } from './types.js';
import { MODEL_MAP, BENEFIT_TYPE_MAP, VIDEO_RESOLUTION } from './types.js';

// 解析 prompt 中的图片占位符, 构建 meta_list
function buildMetaListFromPrompt(prompt: string, imageCount: number): MetaItem[] {
  const metaList: MetaItem[] = [];
  const placeholderRegex = /@(?:图|image)?(\d+)/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = placeholderRegex.exec(prompt)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = prompt.substring(lastIndex, match.index);
      if (textBefore.trim()) metaList.push({ meta_type: 'text', text: textBefore });
    }
    const imageIndex = parseInt(match[1]) - 1;
    if (imageIndex >= 0 && imageIndex < imageCount) {
      metaList.push({ meta_type: 'image', text: '', material_ref: { material_idx: imageIndex } });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < prompt.length) {
    const remainingText = prompt.substring(lastIndex);
    if (remainingText.trim()) metaList.push({ meta_type: 'text', text: remainingText });
  }

  if (metaList.length === 0) {
    for (let i = 0; i < imageCount; i++) {
      if (i === 0) metaList.push({ meta_type: 'text', text: '使用' });
      metaList.push({ meta_type: 'image', text: '', material_ref: { material_idx: i } });
      if (i < imageCount - 1) metaList.push({ meta_type: 'text', text: '和' });
    }
    metaList.push({ meta_type: 'text', text: prompt?.trim() ? `图片，${prompt}` : '图片生成视频' });
  }
  return metaList;
}

export async function generateSeedanceVideo(
  taskId: string,
  params: GenerateVideoParams,
  tasks: Map<string, TaskInfo>,
): Promise<string> {
  const task = tasks.get(taskId)!;
  const modelKey = params.model && MODEL_MAP[params.model] ? params.model : 'seedance-2.0';
  const model = MODEL_MAP[modelKey];
  const benefitType = BENEFIT_TYPE_MAP[modelKey];
  const actualDuration = params.duration || 4;
  const resConfig = VIDEO_RESOLUTION[params.ratio] || VIDEO_RESOLUTION['4:3'];
  const { width, height } = resConfig;

  console.log(`[${taskId}] ${modelKey}: ${width}x${height} (${params.ratio}) ${actualDuration}秒`);

  // 第1步: 上传图片（支持预上传的 URI）
  task.progress = '正在上传参考图片...';
  const uploadedImages: UploadedImage[] = [];
  if (params.preUploadedUris?.length) {
    for (const uri of params.preUploadedUris) {
      uploadedImages.push({ uri, width, height });
    }
    console.log(`[${taskId}] 使用 ${uploadedImages.length} 张预上传参考图`);
  } else {
    for (let i = 0; i < params.files.length; i++) {
      task.progress = `正在上传第 ${i + 1}/${params.files.length} 张图片...`;
      console.log(`[${taskId}] 上传图片 ${i + 1}/${params.files.length}: ${params.files[i].originalname} (${(params.files[i].size / 1024).toFixed(1)}KB)`);
      const imageUri = await uploadImageBuffer(params.files[i].buffer, params.sessionId);
      uploadedImages.push({ uri: imageUri, width, height });
    }
  }
  console.log(`[${taskId}] 全部 ${uploadedImages.length} 张图片就绪`);

  // 第2步: 构建 material_list 和 meta_list
  const materialList = uploadedImages.map((img) => ({
    type: '', id: generateUUID(), material_type: 'image',
    image_info: {
      type: 'image', id: generateUUID(), source_from: 'upload', platform_type: 1, name: '',
      image_uri: img.uri, aigc_image: { type: '', id: generateUUID() },
      width: img.width, height: img.height, format: '', uri: img.uri,
    },
  }));
  const metaList = buildMetaListFromPrompt(params.prompt || '', uploadedImages.length);

  const componentId = generateUUID();
  const submitId = generateUUID();
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(width, height);
  const aspectRatio = `${width / divisor}:${height / divisor}`;

  const metricsExtra = JSON.stringify({
    isDefaultSeed: 1, originSubmitId: submitId, isRegenerate: false,
    enterFrom: 'click', position: 'page_bottom_box', functionMode: 'omni_reference',
    sceneOptions: JSON.stringify([{
      type: 'video', scene: 'BasicVideoGenerateButton', modelReqKey: model,
      videoDuration: actualDuration,
      reportParams: { enterSource: 'generate', vipSource: 'generate', extraVipFunctionKey: model, useVipFunctionDetailsReporterHoc: true },
      materialTypes: [1],
    }]),
  });

  // 第3步: 提交生成请求
  task.progress = '正在提交视频生成请求...';
  const generateQueryParams = new URLSearchParams({
    aid: String(DEFAULT_ASSISTANT_ID), device_platform: 'web', region: 'cn',
    webId: String(WEB_ID), da_version: SEEDANCE_DRAFT_VERSION,
    web_component_open_flag: '1', web_version: '7.5.0', aigc_features: 'app_lip_sync',
  });
  const generateUrl = `${JIMENG_BASE_URL}/mweb/v1/aigc_draft/generate?${generateQueryParams}`;

  const generateBody = {
    extend: {
      root_model: model,
      m_video_commerce_info: { benefit_type: benefitType, resource_id: 'generate_video', resource_id_type: 'str', resource_sub_type: 'aigc' },
      m_video_commerce_info_list: [{ benefit_type: benefitType, resource_id: 'generate_video', resource_id_type: 'str', resource_sub_type: 'aigc' }],
    },
    submit_id: submitId,
    metrics_extra: metricsExtra,
    draft_content: JSON.stringify({
      type: 'draft', id: generateUUID(), min_version: SEEDANCE_DRAFT_VERSION,
      min_features: ['AIGC_Video_UnifiedEdit'], is_from_tsn: true, version: SEEDANCE_DRAFT_VERSION,
      main_component_id: componentId,
      component_list: [{
        type: 'video_base_component', id: componentId, min_version: '1.0.0', aigc_mode: 'workbench',
        metadata: { type: '', id: generateUUID(), created_platform: 3, created_platform_version: '', created_time_in_ms: String(Date.now()), created_did: '' },
        generate_type: 'gen_video',
        abilities: {
          type: '', id: generateUUID(),
          gen_video: {
            type: '', id: generateUUID(),
            text_to_video_params: {
              type: '', id: generateUUID(),
              video_gen_inputs: [{
                type: '', id: generateUUID(), min_version: SEEDANCE_DRAFT_VERSION,
                prompt: '', video_mode: 2, fps: 24, duration_ms: actualDuration * 1000, idip_meta_list: [],
                unified_edit_input: { type: '', id: generateUUID(), material_list: materialList, meta_list: metaList },
              }],
              video_aspect_ratio: aspectRatio, seed: Math.floor(Math.random() * 1000000000),
              model_req_key: model, priority: 0,
            },
            video_task_extra: metricsExtra,
          },
        },
        process_type: 1,
      }],
    }),
    http_common_info: { aid: DEFAULT_ASSISTANT_ID },
  };

  const generateResult = await browserService.fetch(params.sessionId, WEB_ID, USER_ID, generateUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(generateBody),
  }) as Record<string, unknown>;

  if (generateResult.ret !== undefined && String(generateResult.ret) !== '0') {
    const retCode = String(generateResult.ret);
    const errMsg = (generateResult.errmsg as string) || retCode;
    if (retCode === '5000') throw new Error('即梦积分不足，请前往即梦官网领取积分');
    throw new Error(`即梦API错误 (ret=${retCode}): ${errMsg}`);
  }

  const aigcData = (generateResult.data as Record<string, unknown>)?.aigc_data as Record<string, unknown>;
  const historyId = aigcData?.history_record_id as string;
  if (!historyId) throw new Error('未获取到记录ID');
  console.log(`[${taskId}] 生成请求已提交, historyId: ${historyId}`);

  // 第4步: 轮询获取结果
  task.progress = '已提交，等待AI生成视频...';
  await new Promise((r) => setTimeout(r, 5000));

  let status = 20;
  let failCode: number | undefined;
  let itemList: Array<Record<string, unknown>> = [];
  const maxRetries = 60;

  for (let retryCount = 0; retryCount < maxRetries && status === 20; retryCount++) {
    try {
      const result = await jimengRequest('post', '/mweb/v1/get_history_by_ids', params.sessionId, { data: { history_ids: [historyId] } });
      const historyList = result?.history_list as Array<Record<string, unknown>> | undefined;
      const historyData = historyList?.[0] || (result as Record<string, Record<string, unknown>>)?.[historyId];

      if (!historyData) {
        const waitTime = Math.min(2000 * (retryCount + 1), 30000);
        console.log(`[${taskId}] 轮询 #${retryCount + 1}: 数据不存在，等待 ${waitTime}ms`);
        await new Promise((r) => setTimeout(r, waitTime));
        continue;
      }

      status = historyData.status as number;
      failCode = historyData.fail_code as number | undefined;
      itemList = (historyData.item_list as Array<Record<string, unknown>>) || [];

      const elapsed = Math.floor((Date.now() - task.startTime) / 1000);
      const mins = Math.floor(elapsed / 60);
      const secs = elapsed % 60;
      console.log(`[${taskId}] 轮询 #${retryCount + 1}: status=${status}, ${mins}分${secs}秒`);

      if (status === 30) {
        throw new Error(failCode === 2038 ? '内容被过滤，请修改提示词后重试' : `视频生成失败，错误码: ${failCode}`);
      }
      if (status === 20) {
        task.progress = elapsed < 120 ? 'AI正在生成视频，请耐心等待...' : `视频生成中，已等待 ${mins} 分钟...`;
        await new Promise((r) => setTimeout(r, 2000 * Math.min(retryCount + 1, 5)));
      }
    } catch (error: unknown) {
      const err = error as Error;
      if (err.message?.includes('内容被过滤') || err.message?.includes('生成失败')) throw err;
      console.log(`[${taskId}] 轮询出错: ${err.message}`);
      await new Promise((r) => setTimeout(r, 2000 * (retryCount + 1)));
    }
  }

  if (status === 20) throw new Error('视频生成超时 (约20分钟)，请稍后重试');

  // 第5步: 获取高清视频URL
  task.progress = '正在获取高清视频...';
  const firstItem = itemList?.[0] as Record<string, unknown> | undefined;
  const itemId = firstItem?.item_id || firstItem?.id || firstItem?.local_item_id ||
    (firstItem?.common_attr as Record<string, unknown>)?.id;

  if (itemId) {
    try {
      const hqResult = await jimengRequest('post', '/mweb/v1/get_local_item_list', params.sessionId, {
        data: { item_id_list: [String(itemId)], pack_item_opt: { scene: 1, need_data_integrity: true }, is_for_video_download: true },
      });
      const hqItemList = (hqResult?.item_list || hqResult?.local_item_list) as Array<Record<string, unknown>> | undefined;
      const hqItem = hqItemList?.[0];
      const video = hqItem?.video as Record<string, unknown> | undefined;
      const transcoded = video?.transcoded_video as Record<string, Record<string, unknown>> | undefined;
      const hqUrl = (transcoded?.origin?.video_url || video?.download_url || video?.play_url || video?.url) as string | undefined;

      if (hqUrl) { console.log(`[${taskId}] 高清视频URL获取成功`); return hqUrl; }

      const responseStr = JSON.stringify(hqResult);
      const urlMatch = responseStr.match(/https:\/\/v[0-9]+-dreamnia\.jimeng\.com\/[^"\s\\]+/) ||
        responseStr.match(/https:\/\/v[0-9]+-[^"\\]*\.jimeng\.com\/[^"\s\\]+/);
      if (urlMatch?.[0]) { console.log(`[${taskId}] 正则提取到高清视频URL`); return urlMatch[0]; }
    } catch (err: unknown) {
      console.log(`[${taskId}] 获取高清URL失败，使用预览URL: ${(err as Error).message}`);
    }
  }

  const firstVideo = firstItem?.video as Record<string, unknown> | undefined;
  const transcoded = firstVideo?.transcoded_video as Record<string, Record<string, unknown>> | undefined;
  const videoUrl = (transcoded?.origin?.video_url || firstVideo?.play_url || firstVideo?.download_url || firstVideo?.url) as string | undefined;
  if (!videoUrl) throw new Error('未能获取视频URL');
  console.log(`[${taskId}] 视频URL (预览): ${videoUrl}`);
  return videoUrl;
}
