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

// 构建请求头
function buildHeaders(config: LLMConfig): Record<string, string> {
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
function getEndpoint(config: LLMConfig): string {
  const base = config.apiUrl.replace(/\/+$/, '');
  if (config.provider === 'gemini') {
    return `${base}/models/${config.model}:generateContent?key=${config.apiKey}`;
  }
  if (config.provider === 'anthropic') return `${base}/messages`;
  return `${base}/chat/completions`;
}

// 解析响应
function parseResponse(config: LLMConfig, data: Record<string, unknown>): string {
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
  // 尝试找到 JSON 对象或数组
  const match = cleaned.match(/[\[{][\s\S]*[\]}]/);
  if (match) return JSON.parse(match[0]);
  return JSON.parse(cleaned);
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
  options: { jsonMode?: boolean; config?: LLMConfig } = {},
): Promise<LLMResult> {
  const config = options.config || currentConfig;
  const startTime = Date.now();

  if (!config.apiKey && config.provider !== 'ollama') {
    return { success: false, content: '', error: 'LLM API Key 未配置' };
  }

  const endpoint = getEndpoint(config);
  const headers = buildHeaders(config);
  const body = buildBody(config, systemPrompt, userContent, options.jsonMode || false);

  try {
    const response = await undiciFetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000), // 5 分钟超时
      dispatcher: getDispatcher(),
    });

    const duration = (Date.now() - startTime) / 1000;

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      return { success: false, content: '', error: `LLM API 错误 (${response.status}): ${errText}`, duration };
    }

    const data = await response.json() as Record<string, unknown>;
    const content = parseResponse(config, data);
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
  options: { config?: LLMConfig } = {},
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
