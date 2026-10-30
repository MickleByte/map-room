import { expect, test } from '@playwright/test';

test('app boots and shows the game canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await expect(page.locator('#stage canvas')).toBeVisible();
  await page.screenshot({ path: 'e2e/.results/smoke.png' });

  expect(errors).toEqual([]);
});
