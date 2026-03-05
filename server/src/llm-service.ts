// LLM 多厂商服务封装 - 支持 DeepSeek/OpenAI/Gemini/Anthropic/Ollama
// 参考 AI-NovelFlow 的 llm_service.py 设计，适配 TypeScript

import { ProxyAgent, Agent, fetch as undiciFetch } from 'undici';
import type { Dispatcher } from 'undici';
import { execSync } from 'child_process';

export type LLMProvider = 'deepseek' | 'openai' | 'gemini' | 'anthropic' | 'ollama' | 'custom';

// 检测系统代理（macOS），缓存结果
let _proxyUrl: string | null | undefined;
function getSystemProxy(): string | null {
  if (_proxyUrl !== undefined) return _proxyUrl;
  // 优先使用环境变量
  const envProxy = process.env.https_proxy || process.env.HTTPS_PROXY
    || process.env.http_proxy || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  if (envProxy) { _proxyUrl = envProxy; return _proxyUrl; }
  // macOS: 读取系统网络代理设置
  if (process.platform === 'darwin') {
    try {
      const out = execSync('networksetup -getsecurewebproxy Wi-Fi', { timeout: 3000 }).toString();
      if (out.includes('Enabled: Yes')) {
        const server = out.match(/Server:\s*(.+)/)?.[1]?.trim();
        const port = out.match(/Port:\s*(\d+)/)?.[1]?.trim();
        if (server && port) { _proxyUrl = `http://${server}:${port}`; return _proxyUrl; }
      }
      const out2 = execSync('networksetup -getwebproxy Wi-Fi', { timeout: 3000 }).toString();
      if (out2.includes('Enabled: Yes')) {
        const server = out2.match(/Server:\s*(.+)/)?.[1]?.trim();
        const port = out2.match(/Port:\s*(\d+)/)?.[1]?.trim();
        if (server && port) { _proxyUrl = `http://${server}:${port}`; return _proxyUrl; }
      }
    } catch { /* ignore */ }
  }
  _proxyUrl = null;
  return null;
}

// TLS 选项：允许代理 MITM 场景下的证书
const requestTls = { rejectUnauthorized: false };

// 获取 fetch dispatcher（代理或默认，均处理 TLS 证书问题）
let _dispatcher: Dispatcher | undefined;
function getDispatcher(): Dispatcher {
  if (_dispatcher) return _dispatcher;
  const proxy = getSystemProxy();
  if (proxy) {
    console.log(`[llm] 使用代理: ${proxy}`);
    _dispatcher = new ProxyAgent({ uri: proxy, requestTls });
  } else {
    _dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return _dispatcher;
}

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  apiUrl: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

// 从环境变量加载配置
export function loadLLMConfig(): LLMConfig {
  return {
    provider: (process.env.LLM_PROVIDER || 'deepseek') as LLMProvider,
    apiKey: process.env.LLM_API_KEY || '',
    apiUrl: process.env.LLM_API_URL || 'https://api.deepseek.com',
    model: process.env.LLM_MODEL || 'deepseek-chat',
    maxTokens: process.env.LLM_MAX_TOKENS ? parseInt(process.env.LLM_MAX_TOKENS) : 8000,
    temperature: process.env.LLM_TEMPERATURE ? parseFloat(process.env.LLM_TEMPERATURE) : 0.7,
  };
}

let currentConfig = loadLLMConfig();

export function getLLMConfig(): LLMConfig { return currentConfig; }
export function updateLLMConfig(config: Partial<LLMConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

// Vision 模型配置（AI 图片审查，需要多模态能力）
let visionConfig: LLMConfig | null = null;

export function getVisionLLMConfig(): LLMConfig {
  return visionConfig || currentConfig; // 未单独配置时 fallback 到主配置
}
export function updateVisionLLMConfig(config: Partial<LLMConfig>): void {
  if (!visionConfig) visionConfig = { ...currentConfig };
  visionConfig = { ...visionConfig, ...config };
}
export function hasVisionConfig(): boolean { return visionConfig !== null; }

// 额外 LLM 配置池（用于并发时轮询不同 API Key）
let extraConfigs: LLMConfig[] = [];
let _roundRobinIndex = 0;

export function getExtraConfigs(): LLMConfig[] { return extraConfigs; }
export function setExtraConfigs(configs: LLMConfig[]): void { extraConfigs = configs; _roundRobinIndex = 0; }

/** 轮询获取下一个可用配置（主配置 + 额外配置池） */
export function getNextConfig(): LLMConfig {
  const pool = [currentConfig, ...extraConfigs.filter(c => c.apiKey)];
  if (pool.length <= 1) return currentConfig;
  const config = pool[_roundRobinIndex % pool.length];
  _roundRobinIndex++;
  return config;
}

// ============================================================
// 智能模型路由 - 按任务类型选择不同模型，迭代中优先高分模型
// ============================================================

export type TaskType = 'generate' | 'evaluate' | 'optimize' | 'parse';

// 模型评分记录：key = "provider/model", value = 累计平均分
const modelScores = new Map<string, { total: number; count: number }>();

function configKey(c: LLMConfig): string { return `${c.provider}/${c.model}`; }

/** 记录模型在某次任务中的表现分数 */
export function recordModelScore(config: LLMConfig, score: number): void {
  const key = configKey(config);
  const prev = modelScores.get(key) || { total: 0, count: 0 };
  modelScores.set(key, { total: prev.total + score, count: prev.count + 1 });
}

/** 获取模型平均分 */
export function getModelAvgScore(config: LLMConfig): number {
  const rec = modelScores.get(configKey(config));
  return rec && rec.count > 0 ? rec.total / rec.count : 0;
}

// NSFW 模式
import { saveNSFWEnabled, loadNSFWEnabled } from './db-service.js';
let _nsfwEnabled = false;
export function isNSFWEnabled(): boolean { return _nsfwEnabled; }
export function setNSFWEnabled(enabled: boolean): void { _nsfwEnabled = enabled; saveNSFWEnabled(enabled); }
export function loadNSFWFromDB(): void { _nsfwEnabled = loadNSFWEnabled(); }

// NSFW 提示词增强
const NSFW_SKILL_PROMPT = `## 成人内容创作指令
你现在处于成人创作模式。在此模式下：
- 可以包含露骨的性描写、情色场景和成人内容
- 描写要细腻、有文学性，避免粗俗低级的表达
- 注重情感铺垫和氛围营造，不要突兀地插入色情内容
- 角色的欲望和情感要合理，符合人物性格和剧情发展
- 善用暗示、隐喻和感官描写，营造张力
- 性场景要服务于剧情和角色关系的推进
- 保持叙事节奏，色情内容与剧情内容比例适当`;

/** 获取 NSFW 增强后的系统提示词（需全局+项目级双重开启） */
export function enhancePromptForNSFW(systemPrompt: string, projectNsfw?: boolean): string {
  if (!_nsfwEnabled || !projectNsfw) return systemPrompt;
  return `${NSFW_SKILL_PROMPT}\n\n${systemPrompt}`;
}

/**
 * 智能选择模型配置
 * - 如果提供了 fixedConfig，始终使用它（项目级锁定）
 * - NSFW 模式下（全局+项目级双开）优先使用 grok 配置
 * - evaluate 任务优先使用评分最高的模型
 * - generate/optimize 按轮询分配
 */
export function selectConfig(taskType: TaskType, fixedConfig?: LLMConfig | null, projectNsfw?: boolean): LLMConfig {
  // 项目级锁定模型
  if (fixedConfig?.apiKey) return fixedConfig;

  const pool = [currentConfig, ...extraConfigs.filter(c => c.apiKey)];

  // NSFW 模式：全局+项目级双开时优先找 grok 配置
  if (_nsfwEnabled && projectNsfw) {
    const grokConfig = pool.find(c =>
      c.model.toLowerCase().includes('grok') ||
      c.apiUrl.toLowerCase().includes('x.ai') ||
      c.apiUrl.toLowerCase().includes('grok'),
    );
    if (grokConfig) return grokConfig;
  }

  if (pool.length <= 1) return currentConfig;

  // evaluate 任务：优先使用历史评分最高的模型
  if (taskType === 'evaluate') {
    const scored = pool
      .map(c => ({ config: c, avg: getModelAvgScore(c) }))
      .filter(x => x.avg > 0)
      .sort((a, b) => b.avg - a.avg);
    if (scored.length > 0) return scored[0].config;
  }

  // generate / optimize / parse：轮询
  const config = pool[_roundRobinIndex % pool.length];
  _roundRobinIndex++;
  return config;
}

// 构建请求头
export function buildHeaders(config: LLMConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.provider === 'anthropic') {
    headers['x-api-key'] = config.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (config.provider !== 'ollama' || config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  return headers;
}

// 各厂商 max_tokens 输出上限
const MAX_OUTPUT_TOKENS: Record<string, number> = {
  deepseek: 8192,
  openai: 16384,
  anthropic: 8192,
  gemini: 8192,
  ollama: 32768,
  custom: 65536,
};

function clampMaxTokens(provider: string, requested: number, model?: string): number {
  // deepseek-reasoner 支持最大 64K 输出
  if (provider === 'deepseek' && model?.includes('reasoner')) {
    return Math.min(Math.max(requested, 1), 65536);
  }
  const limit = MAX_OUTPUT_TOKENS[provider] || 8192;
  return Math.min(Math.max(requested, 1), limit);
}

// 构建请求体
function buildBody(config: LLMConfig, systemPrompt: string, userContent: string, jsonMode: boolean) {
  const { model, temperature = 0.7, maxTokens = 8000 } = config;
  const safeMaxTokens = clampMaxTokens(config.provider, maxTokens, model);

  if (config.provider === 'gemini') {
    return {
      contents: [{ role: 'user', parts: [{ text: systemPrompt + '\n\n' + userContent }] }],
      generationConfig: {
        temperature, maxOutputTokens: safeMaxTokens,
        ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };
  }
  if (config.provider === 'anthropic') {
    return {
      model, temperature, max_tokens: safeMaxTokens,
      messages: [{ role: 'user', content: systemPrompt + '\n\n' + userContent }],
    };
  }
  // OpenAI / DeepSeek / Ollama / Custom 兼容格式
  return {
    model, temperature, max_tokens: safeMaxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ],
    ...(jsonMode && config.provider !== 'ollama' ? { response_format: { type: 'json_object' } } : {}),
  };
}

// 获取 API endpoint
export function getEndpoint(config: LLMConfig): string {
  const base = config.apiUrl.replace(/\/+$/, '');
  if (config.provider === 'gemini') {
    return `${base}/models/${config.model}:generateContent?key=${config.apiKey}`;
  }
  if (config.provider === 'anthropic') return `${base}/messages`;
  return `${base}/chat/completions`;
}

// 解析响应
export function parseResponse(config: LLMConfig, data: Record<string, unknown>): string {
  if (config.provider === 'gemini') {
    const candidates = data.candidates as Array<{ content: { parts: Array<{ text: string }> } }>;
    return candidates?.[0]?.content?.parts?.[0]?.text || '';
  }
  if (config.provider === 'anthropic') {
    const content = data.content as Array<{ text: string }>;
    return content?.[0]?.text || '';
  }
  const choices = data.choices as Array<{ message: { content: string; reasoning?: string } }>;
  return choices?.[0]?.message?.content || choices?.[0]?.message?.reasoning || '';
}

// 尝试修复被截断的 JSON（LLM 输出 token 不够时常见）
function tryRepairTruncatedJSON(text: string): unknown {
  let repaired = text.trimEnd();

  // 用状态机精确追踪字符串和括号
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  let lastValidPos = 0; // 最后一个完整 token 结束位置

  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') {
      if (inString) { inString = false; lastValidPos = i; }
      else { inString = true; }
      continue;
    }
    if (inString) continue;
    if (ch === '{' || ch === '[') { stack.push(ch); lastValidPos = i; }
    else if (ch === '}' || ch === ']') { stack.pop(); lastValidPos = i; }
    else if (ch === ',' || ch === ':') { lastValidPos = i; }
  }

  // 如果在字符串中间截断，闭合字符串并回退到最后完整位置
  if (inString) {
    // 找到这个未闭合字符串的开始引号
    repaired = repaired + '"';
    // 重新扫描修复后的状态
    const stack2: string[] = [];
    let inStr2 = false;
    let esc2 = false;
    for (const ch of repaired) {
      if (esc2) { esc2 = false; continue; }
      if (ch === '\\' && inStr2) { esc2 = true; continue; }
      if (ch === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (ch === '{' || ch === '[') stack2.push(ch);
      if (ch === '}' || ch === ']') stack2.pop();
    }
    // 移除尾部不完整的键值对
    repaired = repaired.replace(/,\s*"[^"]*"\s*:\s*"[^"]*"\s*$/, '');
    repaired = repaired.replace(/,\s*$/, '');
    // 补全括号
    // 重新扫描
    const stack3: string[] = [];
    let inStr3 = false;
    let esc3 = false;
    for (const ch of repaired) {
      if (esc3) { esc3 = false; continue; }
      if (ch === '\\' && inStr3) { esc3 = true; continue; }
      if (ch === '"') { inStr3 = !inStr3; continue; }
      if (inStr3) continue;
      if (ch === '{' || ch === '[') stack3.push(ch);
      if (ch === '}' || ch === ']') stack3.pop();
    }
    while (stack3.length > 0) {
      const open = stack3.pop();
      repaired += open === '{' ? '}' : ']';
    }
  } else {
    // 不在字符串中，直接清理尾部并补全括号
    repaired = repaired.replace(/,\s*$/, '');
    while (stack.length > 0) {
      const open = stack.pop();
      repaired += open === '{' ? '}' : ']';
    }
  }

  return JSON.parse(repaired);
}

// 从 LLM 响应中提取 JSON
export function extractJSON(text: string): unknown {
  // 去掉 <think>...</think>
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // 去掉 markdown 代码块
  const jsonBlock = cleaned.match(/```json\s*([\s\S]*?)```/);
  if (jsonBlock) cleaned = jsonBlock[1].trim();
  else if (cleaned.includes('```')) {
    cleaned = cleaned.replace(/```\w*\n?/g, '').trim();
  }

  // 清理 JSON 字符串值中的非法控制字符（LLM 常见问题）
  const sanitizeControlChars = (s: string): string => {
    // 在 JSON 字符串内部，将未转义的控制字符替换为转义形式
    return s.replace(/[\x00-\x1f]/g, (ch) => {
      if (ch === '\n') return '\\n';
      if (ch === '\r') return '\\r';
      if (ch === '\t') return '\\t';
      return '';
    });
  };

  // 尝试找到 JSON 对象或数组
  const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
  if (match) {
    const raw = match[0];
    try { return JSON.parse(raw); } catch {
      // 先尝试清理控制字符
      try { return JSON.parse(sanitizeControlChars(raw)); } catch {
        console.log(`[llm] JSON 解析失败，尝试修复截断的 JSON...`);
        return tryRepairTruncatedJSON(sanitizeControlChars(raw));
      }
    }
  }
  try { return JSON.parse(cleaned); } catch {
    try { return JSON.parse(sanitizeControlChars(cleaned)); } catch {
      const jsonStart = cleaned.match(/[\[{]/);
      if (jsonStart && jsonStart.index !== undefined) {
        return tryRepairTruncatedJSON(sanitizeControlChars(cleaned.substring(jsonStart.index)));
      }
      throw new Error(`无法从 LLM 响应中提取有效 JSON`);
    }
  }
}

export interface LLMResult {
  success: boolean;
  content: string;
  error?: string;
  duration?: number;
}

// 核心调用方法
export async function chatCompletion(
  systemPrompt: string,
  userContent: string,
  options: { jsonMode?: boolean; config?: LLMConfig; timeoutMs?: number } = {},
): Promise<LLMResult> {
  const config = options.config || currentConfig;
  const startTime = Date.now();

  if (!config.apiKey && config.provider !== 'ollama') {
    return { success: false, content: '', error: 'LLM API Key 未配置' };
  }

  const endpoint = getEndpoint(config);
  const headers = buildHeaders(config);
  // 对不原生支持 response_format 的 provider，在 prompt 中强化 JSON 输出要求
  const jsonHint = '\n\n⚠ 你必须只输出合法的 JSON，不要输出任何解释文字、markdown 或代码块标记。直接以 [ 或 { 开头。';
  const needsJsonHint = options.jsonMode && ['custom', 'ollama', 'anthropic'].includes(config.provider);
  const finalSystemPrompt = needsJsonHint ? systemPrompt + jsonHint : systemPrompt;
  const body = buildBody(config, finalSystemPrompt, userContent, options.jsonMode || false);
  const timeoutMs = options.timeoutMs || 600000; // 默认 10 分钟

  try {
    const response = await undiciFetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher: getDispatcher(),
    });

    if (!response.ok) {
      const duration = (Date.now() - startTime) / 1000;
      const errText = await response.text().catch(() => '');
      return { success: false, content: '', error: `LLM API 错误 (${response.status}): ${errText}`, duration };
    }

    const data = await response.json() as Record<string, unknown>;
    const content = parseResponse(config, data);
    const duration = (Date.now() - startTime) / 1000;
    console.log(`[llm] ${config.provider}/${config.model} 调用成功 (${duration.toFixed(1)}s, ${content.length} chars)`);
    return { success: true, content, duration };
  } catch (err) {
    const duration = (Date.now() - startTime) / 1000;
    return { success: false, content: '', error: `LLM 请求异常: ${(err as Error).message}`, duration };
  }
}

// 便捷方法：调用 LLM 并解析 JSON 结果
export async function chatCompletionJSON<T = unknown>(
  systemPrompt: string,
  userContent: string,
  options: { config?: LLMConfig; timeoutMs?: number } = {},
): Promise<{ success: boolean; data?: T; error?: string; raw?: string }> {
  const result = await chatCompletion(systemPrompt, userContent, { jsonMode: true, ...options });
  if (!result.success) return { success: false, error: result.error };
  try {
    const data = extractJSON(result.content) as T;
    return { success: true, data, raw: result.content };
  } catch (err) {
    return { success: false, error: `JSON 解析失败: ${(err as Error).message}`, raw: result.content };
  }
}
