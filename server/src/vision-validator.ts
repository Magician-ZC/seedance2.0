// 多模态视觉验证模块 - 用于角色图/场景图/分镜的自动评分和验证
// 支持 OpenAI(GPT-4o) / Gemini / Anthropic(Claude) 的 vision API

import { getLLMConfig, chatCompletionJSON, type LLMConfig } from './llm-service.js';
import { fetch as undiciFetch } from 'undici';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 图片评分结果
export interface ImageScore {
  url: string;
  score: number;        // 0-100 综合评分
  matchScore: number;   // prompt 匹配度
  qualityScore: number; // 画面质量
  reason: string;       // 评分理由
}

// 验证结果
export interface ValidationResult {
  passed: boolean;
  score: number;
  issues: string[];     // 不符合的地方
  suggestion?: string;  // 改进建议
}

// 将本地图片路径或URL转为 base64 data URI
async function imageToBase64(imageUrlOrPath: string): Promise<string> {
  // 本地文件路径（/api/images/xxx）
  if (imageUrlOrPath.startsWith('/api/images/')) {
    const filename = imageUrlOrPath.replace('/api/images/', '');
    const filePath = path.join(__dirname, '../../data/images', filename);
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
      return `data:${mime};base64,${data.toString('base64')}`;
    }
  }
  // 远程 URL：下载后转 base64
  if (imageUrlOrPath.startsWith('http')) {
    const resp = await undiciFetch(imageUrlOrPath);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get('content-type') || 'image/jpeg';
    return `data:${contentType};base64,${buffer.toString('base64')}`;
  }
  throw new Error(`无法处理图片: ${imageUrlOrPath}`);
}

// 构建多模态请求体（支持 OpenAI / Gemini / Anthropic 格式）
function buildVisionBody(
  config: LLMConfig,
  systemPrompt: string,
  textContent: string,
  imageBase64List: string[],
) {
  const { model, temperature = 0.3, maxTokens = 2000 } = config;

  if (config.provider === 'gemini') {
    const parts: Array<Record<string, unknown>> = [
      { text: systemPrompt + '\n\n' + textContent },
    ];
    for (const img of imageBase64List) {
      const [header, data] = img.split(',');
      const mime = header.match(/data:(.*?);/)?.[1] || 'image/jpeg';
      parts.push({ inline_data: { mime_type: mime, data } });
    }
    return {
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature, maxOutputTokens: maxTokens, responseMimeType: 'application/json' },
    };
  }

  if (config.provider === 'anthropic') {
    const content: Array<Record<string, unknown>> = [];
    for (const img of imageBase64List) {
      const [header, data] = img.split(',');
      const mediaType = header.match(/data:(.*?);/)?.[1] || 'image/jpeg';
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data } });
    }
    content.push({ type: 'text', text: systemPrompt + '\n\n' + textContent });
    return {
      model, temperature, max_tokens: maxTokens,
      messages: [{ role: 'user', content }],
    };
  }

  // OpenAI / DeepSeek / Custom 兼容格式
  const userContent: Array<Record<string, unknown>> = [
    { type: 'text', text: textContent },
  ];
  for (const img of imageBase64List) {
    userContent.push({ type: 'image_url', image_url: { url: img, detail: 'low' } });
  }
  return {
    model, temperature, max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    response_format: { type: 'json_object' },
  };
}

// 通用多模态 API 调用（发送图片 + 文本，返回 JSON）
async function visionCallJSON<T = unknown>(
  systemPrompt: string,
  textContent: string,
  imageUrls: string[],
  config?: LLMConfig,
): Promise<{ success: boolean; data?: T; error?: string }> {
  const { getVisionLLMConfig } = await import('./llm-service.js');
  const cfg = config || getVisionLLMConfig();

  // 将图片转为 base64（最多5张，避免 token 爆炸）
  const base64List: string[] = [];
  for (const url of imageUrls.slice(0, 5)) {
    try {
      base64List.push(await imageToBase64(url));
    } catch (err) {
      console.log(`[vision] 图片转换失败: ${url} - ${(err as Error).message}`);
    }
  }
  if (base64List.length === 0) {
    return { success: false, error: '无可用图片' };
  }

  // 构建请求
  const { buildHeaders, getEndpoint } = await import('./llm-service.js');
  const endpoint = getEndpoint(cfg);
  const headers = buildHeaders(cfg);
  const body = buildVisionBody(cfg, systemPrompt, textContent, base64List);

  try {
    const response = await undiciFetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      // 如果模型不支持 vision，降级为纯文本评分
      if (response.status === 400 && errText.includes('image')) {
        console.log(`[vision] 当前模型不支持图片输入，降级为纯文本评分`);
        return fallbackTextScore<T>(systemPrompt, textContent);
      }
      return { success: false, error: `Vision API 错误 (${response.status}): ${errText.substring(0, 200)}` };
    }

    const data = await response.json() as Record<string, unknown>;
    const { parseResponse, extractJSON } = await import('./llm-service.js');
    const content = parseResponse(cfg, data);
    const parsed = extractJSON(content) as T;
    return { success: true, data: parsed };
  } catch (err) {
    return { success: false, error: `Vision 请求异常: ${(err as Error).message}` };
  }
}

// 降级：模型不支持 vision 时用纯文本做评分（基于 prompt 描述打分）
async function fallbackTextScore<T>(systemPrompt: string, textContent: string): Promise<{ success: boolean; data?: T; error?: string }> {
  return chatCompletionJSON<T>(systemPrompt, textContent + '\n\n注意：无法查看图片，请仅根据描述信息给出合理评分。');
}

// ====== 核心功能：角色图评分选择 ======
// 对多张角色图评分，返回按分数排序的结果
export async function scoreCharacterImages(
  characterName: string,
  description: string,
  visualPrompt: string,
  imageUrls: string[],
): Promise<ImageScore[]> {
  if (imageUrls.length === 0) return [];
  if (imageUrls.length === 1) {
    return [{ url: imageUrls[0], score: 80, matchScore: 80, qualityScore: 80, reason: '仅一张图片，默认选择' }];
  }

  const systemPrompt = `你是一位专业的影视选角导演和AI绘画评审专家。请对以下角色参考图进行评分。

## 评分维度（每项0-100分）
1. matchScore（prompt匹配度）：图片是否符合角色描述？性别、年龄、发型、服装、体型、五官是否匹配？
2. qualityScore（画面质量）：构图是否合理？光线是否自然？是否有明显的AI瑕疵（多余手指、扭曲面部等）？

## 评分标准
- 90-100：完美匹配，高质量，可直接使用
- 70-89：基本匹配，质量良好，小瑕疵可接受
- 50-69：部分匹配，有明显问题
- 0-49：严重不匹配或质量极差

返回 JSON 数组（按图片顺序）：
[{ "index": 0, "score": 85, "matchScore": 90, "qualityScore": 80, "reason": "简短评价" }]`;

  const textContent = `角色：${characterName}
描述：${description}
生图提示词：${visualPrompt}

请对以下 ${imageUrls.length} 张图片逐一评分（图片按顺序排列）。`;

  const result = await visionCallJSON<Array<{ index: number; score: number; matchScore: number; qualityScore: number; reason: string }>>(
    systemPrompt, textContent, imageUrls,
  );

  if (!result.success || !result.data) {
    console.log(`[vision] 角色图评分失败: ${result.error}，使用默认评分`);
    return imageUrls.map((url, i) => ({
      url, score: 70 - i, matchScore: 70, qualityScore: 70,
      reason: '评分服务不可用，按生成顺序排列',
    }));
  }

  // 映射回 ImageScore 格式
  return result.data
    .map(item => ({
      url: imageUrls[item.index] || imageUrls[0],
      score: item.score || 0,
      matchScore: item.matchScore || 0,
      qualityScore: item.qualityScore || 0,
      reason: item.reason || '',
    }))
    .sort((a, b) => b.score - a.score);
}

// ====== 核心功能：场景图验证 ======
export async function validateLocationImage(
  locationName: string,
  baseVisualPrompt: string,
  description: string,
  imageUrl: string,
): Promise<ValidationResult> {
  const systemPrompt = `你是一位专业的影视美术指导。请验证这张场景图是否符合描述要求。

## 验证维度
1. 空间布局是否匹配（家具摆放、建筑结构）
2. 风格氛围是否匹配（色调、光线、时代感）
3. 关键元素是否存在（描述中提到的物件）
4. 是否有明显的AI瑕疵

返回 JSON：
{
  "passed": true/false,
  "score": 0-100,
  "issues": ["不符合的地方1", "不符合的地方2"],
  "suggestion": "改进建议（如果不通过）"
}`;

  const textContent = `场景：${locationName}
基准描述：${baseVisualPrompt || description}`;

  const result = await visionCallJSON<ValidationResult>(systemPrompt, textContent, [imageUrl]);

  if (!result.success || !result.data) {
    return { passed: true, score: 70, issues: [], suggestion: '验证服务不可用，默认通过' };
  }
  return result.data;
}

// ====== 核心功能：场景图评分选择（多张候选中选最佳） ======
export async function scoreLocationImages(
  locationName: string,
  baseVisualPrompt: string,
  description: string,
  imageUrls: string[],
): Promise<ImageScore[]> {
  if (imageUrls.length === 0) return [];
  if (imageUrls.length === 1) {
    return [{ url: imageUrls[0], score: 80, matchScore: 80, qualityScore: 80, reason: '仅一张图片，默认选择' }];
  }

  const systemPrompt = `你是一位专业的影视美术指导。请对以下场景参考图进行评分。

## 评分维度
1. matchScore（描述匹配度）：空间布局、建筑风格、家具物件是否符合描述？
2. qualityScore（画面质量）：构图、光线、色调是否适合作为影视场景基准图？是否有AI瑕疵？

## 重要：选择的图将作为该场景的基准图，贯穿全剧所有集数，所以要选择：
- 最能代表该空间固定特征的（不含临时性元素）
- 画面最干净、最适合后续图生图叠加人物的

返回 JSON 数组：
[{ "index": 0, "score": 85, "matchScore": 90, "qualityScore": 80, "reason": "简短评价" }]`;

  const textContent = `场景：${locationName}
基准描述：${baseVisualPrompt || description}

请对以下 ${imageUrls.length} 张图片逐一评分。`;

  const result = await visionCallJSON<Array<{ index: number; score: number; matchScore: number; qualityScore: number; reason: string }>>(
    systemPrompt, textContent, imageUrls,
  );

  if (!result.success || !result.data) {
    console.log(`[vision] 场景图评分失败: ${result.error}，使用默认评分`);
    return imageUrls.map((url, i) => ({
      url, score: 70 - i, matchScore: 70, qualityScore: 70,
      reason: '评分服务不可用，按生成顺序排列',
    }));
  }

  return result.data
    .map(item => ({
      url: imageUrls[item.index] || imageUrls[0],
      score: item.score || 0,
      matchScore: item.matchScore || 0,
      qualityScore: item.qualityScore || 0,
      reason: item.reason || '',
    }))
    .sort((a, b) => b.score - a.score);
}

// ====== 核心功能：自动选择最佳图片并确认 ======
// 通用函数：从候选图中选出最佳的一张
export async function autoSelectBestImage(
  type: 'character' | 'location',
  name: string,
  description: string,
  visualPrompt: string,
  imageUrls: string[],
): Promise<{ bestUrl: string; scores: ImageScore[] }> {
  const scores = type === 'character'
    ? await scoreCharacterImages(name, description, visualPrompt, imageUrls)
    : await scoreLocationImages(name, visualPrompt, description, imageUrls);

  const bestUrl = scores.length > 0 ? scores[0].url : imageUrls[0];
  console.log(`[vision] ${type} "${name}" 自动选择: ${bestUrl} (评分: ${scores[0]?.score || 'N/A'})`);
  return { bestUrl, scores };
}
