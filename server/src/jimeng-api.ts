// 即梦 API 请求封装
import {
  JIMENG_BASE_URL,
  DEFAULT_ASSISTANT_ID,
  WEB_ID,
  FAKE_HEADERS,
  generateCookie,
  generateSign,
} from './utils.js';

// 通用即梦 API 请求
export async function jimengRequest(
  method: string,
  uri: string,
  sessionId: string,
  options: { data?: unknown; params?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Promise<Record<string, unknown>> {
  const { deviceTime, sign } = generateSign(uri);
  const fullUrl = new URL(`${JIMENG_BASE_URL}${uri}`);

  const defaultParams: Record<string, unknown> = {
    aid: DEFAULT_ASSISTANT_ID,
    device_platform: 'web',
    region: 'cn',
    webId: WEB_ID,
    da_version: '3.3.2',
    web_component_open_flag: 1,
    web_version: '7.5.0',
    aigc_features: 'app_lip_sync',
    ...(options.params || {}),
  };

  for (const [key, value] of Object.entries(defaultParams)) {
    fullUrl.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    ...FAKE_HEADERS,
    Cookie: generateCookie(sessionId),
    'Device-Time': String(deviceTime),
    Sign: sign,
    'Sign-Ver': '1',
    ...(options.headers || {}),
  };

  const fetchOptions: RequestInit = { method: method.toUpperCase(), headers };

  if (options.data) {
    headers['Content-Type'] = 'application/json';
    fetchOptions.body = JSON.stringify(options.data);
  }

  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        console.log(`  [jimeng] 重试 ${uri} (第${attempt}次)`);
      }
      const response = await fetch(fullUrl.toString(), { ...fetchOptions, signal: AbortSignal.timeout(45000) });
      const data = (await response.json()) as Record<string, unknown>;

      if (isFinite(Number(data.ret))) {
        if (String(data.ret) === '0') return data.data as Record<string, unknown>;
        const errMsg = (data.errmsg as string) || String(data.ret);
        const retCode = String(data.ret);
        if (retCode === '5000') throw new Error('即梦积分不足，请前往即梦官网领取积分');
        const err = new Error(`即梦API错误 (ret=${retCode}): ${errMsg}`);
        (err as Error & { isApiError: boolean }).isApiError = true;
        throw err;
      }
      return data;
    } catch (err: unknown) {
      const error = err as Error & { isApiError?: boolean };
      if (error.isApiError) throw error;
      if (attempt === 3) throw error;
      console.log(`  [jimeng] 请求 ${uri} 失败 (第${attempt + 1}次): ${error.message}`);
    }
  }
  throw new Error('请求失败');
}
