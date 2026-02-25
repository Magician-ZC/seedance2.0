// Playwright 浏览器代理服务 (绕过 shark 反爬)
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const SESSION_IDLE_TIMEOUT = 10 * 60 * 1000;
const BDMS_READY_TIMEOUT = 30000;

interface BrowserSession {
  context: BrowserContext;
  page: Page;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout>;
  pageReady: boolean; // 页面是否已完成初始化（弹窗已关闭等）
}

// 图片生成 UI 操作返回的结果
interface UIGenerateResult {
  historyId: string;
}

class BrowserService {
  private browser: Browser | null = null;
  private sessions = new Map<string, BrowserSession>();
  // 图片生成需要串行（同一页面同时只能有一个生成操作）
  private imageGenLock = Promise.resolve();

  async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    console.log('[browser] 正在启动 Chromium...');
    this.browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run', '--no-zygote', '--single-process'],
    });
    console.log('[browser] Chromium 已启动');
    return this.browser;
  }

  async getSession(sessionId: string, webId: number, userId: string): Promise<BrowserSession> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastUsed = Date.now();
      clearTimeout(existing.idleTimer);
      existing.idleTimer = setTimeout(() => this.closeSession(sessionId), SESSION_IDLE_TIMEOUT);
      return existing;
    }

    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
    });

    await context.addCookies([
      { name: '_tea_web_id', value: String(webId), domain: '.jianying.com', path: '/' },
      { name: 'is_staff_user', value: 'false', domain: '.jianying.com', path: '/' },
      { name: 'store-region', value: 'cn-gd', domain: '.jianying.com', path: '/' },
      { name: 'uid_tt', value: String(userId), domain: '.jianying.com', path: '/' },
      { name: 'sid_tt', value: sessionId, domain: '.jianying.com', path: '/' },
      { name: 'sessionid', value: sessionId, domain: '.jianying.com', path: '/' },
      { name: 'sessionid_ss', value: sessionId, domain: '.jianying.com', path: '/' },
    ]);

    const page = await context.newPage();
    console.log(`[browser] 正在导航到 jimeng.jianying.com (session: ${sessionId.substring(0, 8)}...)`);
    await page.goto('https://jimeng.jianying.com/ai-tool/image/generate', { waitUntil: 'networkidle', timeout: 60000 });

    try {
      await page.waitForFunction(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = globalThis as any;
        return w.bdms?.init || w.byted_acrawler || w.fetch.toString().indexOf('native code') === -1;
      }, { timeout: BDMS_READY_TIMEOUT });
      console.log('[browser] bdms SDK 已就绪');
    } catch { console.warn('[browser] bdms SDK 等待超时，继续尝试...'); }

    // 等待页面稳定并关闭弹窗
    await new Promise(r => setTimeout(r, 3000));
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 1000));

    const session: BrowserSession = {
      context, page, lastUsed: Date.now(), pageReady: true,
      idleTimer: setTimeout(() => this.closeSession(sessionId), SESSION_IDLE_TIMEOUT),
    };
    this.sessions.set(sessionId, session);
    console.log(`[browser] 会话已创建 (session: ${sessionId.substring(0, 8)}...)`);
    return session;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    clearTimeout(session.idleTimer);
    try { await session.context.close(); } catch { /* ignore */ }
    this.sessions.delete(sessionId);
    console.log(`[browser] 会话已关闭 (session: ${sessionId.substring(0, 8)}...)`);
  }

  // 通过模拟官网 UI 操作生成图片（绕过 sign 签名校验）
  async generateImageViaUI(
    sessionId: string, webId: number, userId: string, prompt: string,
  ): Promise<UIGenerateResult> {
    // 串行锁：同一页面同时只能有一个生成操作
    const prev = this.imageGenLock;
    let resolve!: () => void;
    this.imageGenLock = new Promise<void>(r => { resolve = r; });

    try {
      await prev;
      const session = await this.getSession(sessionId, webId, userId);
      const { page } = session;

      console.log(`[browser] UI生图: "${prompt.substring(0, 60)}..."`);

      // 注册一次性响应监听，捕获 generate 接口的返回
      const resultPromise = new Promise<UIGenerateResult>((res, rej) => {
        const timeout = setTimeout(() => rej(new Error('UI生图超时(30s)')), 30000);
        const handler = async (resp: import('playwright-core').Response) => {
          if (!resp.url().includes('aigc_draft/generate') || resp.request().method() !== 'POST') return;
          try {
            const data = await resp.json() as Record<string, unknown>;
            page.off('response', handler);
            clearTimeout(timeout);
            if (String(data.ret) !== '0') {
              rej(new Error(`生图失败 (ret=${data.ret}): ${data.errmsg || '未知错误'}`));
            } else {
              const aigcData = (data.data as Record<string, unknown>)?.aigc_data as Record<string, unknown>;
              const historyId = aigcData?.history_record_id as string;
              if (!historyId) rej(new Error('生图未获取到记录ID'));
              else res({ historyId });
            }
          } catch (e) { /* 忽略非 JSON 响应 */ }
        };
        page.on('response', handler);
      });

      // 1. 清空并输入 prompt
      const textarea = await page.$('textarea');
      if (!textarea) throw new Error('找不到输入框');
      await textarea.click({ force: true });
      await new Promise(r => setTimeout(r, 200));
      await page.keyboard.down('Meta');
      await page.keyboard.press('a');
      await page.keyboard.up('Meta');
      await page.keyboard.press('Backspace');
      await new Promise(r => setTimeout(r, 200));
      await page.keyboard.type(prompt, { delay: 10 });
      await new Promise(r => setTimeout(r, 300));

      // 2. 点击生成按钮
      const submitBtn = await page.$('button[class*="submit"]');
      if (!submitBtn) throw new Error('找不到生成按钮');
      await submitBtn.click({ force: true });

      // 3. 等待响应
      return await resultPromise;
    } finally {
      resolve();
    }
  }

  // 原始 fetch 代理（用于视频生成等其他接口）
  async fetch(sessionId: string, webId: number, userId: string, url: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<unknown> {
    const session = await this.getSession(sessionId, webId, userId);
    const { method = 'GET', headers = {}, body } = options;
    console.log(`[browser] 通过浏览器代理请求: ${method} ${url.substring(0, 80)}...`);
    return session.page.evaluate(async ({ url, method, headers, body }) => {
      const resp = await fetch(url, { method, headers, body: body || undefined, credentials: 'include' });
      return resp.json();
    }, { url, method, headers, body });
  }

  async close(): Promise<void> {
    for (const [sessionId] of this.sessions) await this.closeSession(sessionId);
    if (this.browser) {
      try { await this.browser.close(); } catch { /* ignore */ }
      this.browser = null;
      console.log('[browser] Chromium 已关闭');
    }
  }
}

const browserService = new BrowserService();
export default browserService;
