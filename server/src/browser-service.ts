// Playwright 浏览器代理服务 (绕过 shark 反爬)
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

const SESSION_IDLE_TIMEOUT = 10 * 60 * 1000;
const BDMS_READY_TIMEOUT = 30000;
const BLOCKED_RESOURCE_TYPES = ['image', 'font', 'stylesheet', 'media'];
const SCRIPT_WHITELIST_DOMAINS = ['vlabstatic.com', 'bytescm.com', 'jianying.com', 'byteimg.com'];

interface BrowserSession {
  context: BrowserContext;
  page: Page;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout>;
}

class BrowserService {
  private browser: Browser | null = null;
  private sessions = new Map<string, BrowserSession>();

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

    await context.route('**/*', (route) => {
      const request = route.request();
      const resourceType = request.resourceType();
      const url = request.url();
      if (BLOCKED_RESOURCE_TYPES.includes(resourceType)) return route.abort();
      if (resourceType === 'script') {
        const isWhitelisted = SCRIPT_WHITELIST_DOMAINS.some((d) => url.includes(d));
        if (!isWhitelisted) return route.abort();
      }
      return route.continue();
    });

    const page = await context.newPage();
    console.log(`[browser] 正在导航到 jimeng.jianying.com (session: ${sessionId.substring(0, 8)}...)`);
    await page.goto('https://jimeng.jianying.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

    try {
      await page.waitForFunction(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = globalThis as any;
        return w.bdms?.init || w.byted_acrawler || w.fetch.toString().indexOf('native code') === -1;
      }, { timeout: BDMS_READY_TIMEOUT });
      console.log('[browser] bdms SDK 已就绪');
    } catch { console.warn('[browser] bdms SDK 等待超时，继续尝试...'); }

    const session: BrowserSession = {
      context, page, lastUsed: Date.now(),
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
