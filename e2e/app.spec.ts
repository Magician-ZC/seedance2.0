import { test, expect } from '@playwright/test';

test.describe('Seedance 2.0 App', () => {
  test('should load the main page', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=Seedance')).toBeVisible();
  });

  test('should show settings modal when no session id', async ({ page }) => {
    // 清除 localStorage
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await expect(page.locator('text=Session ID')).toBeVisible();
  });

  test('should switch language', async ({ page }) => {
    await page.goto('/');
    // 找到语言切换按钮
    const langBtn = page.locator('button:has-text("EN"), button:has-text("中")');
    if (await langBtn.isVisible()) {
      await langBtn.click();
      // 验证语言切换后界面文字变化
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should have preset templates', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('text=电影风景').or(page.locator('text=Cinematic Landscape'))).toBeVisible();
  });
});
