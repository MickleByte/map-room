import { expect, test, type Page } from '@playwright/test';
import type { GameState } from '../src/core/types';

interface Hook {
  state: GameState;
}

// In the sandbox Blue is the AI. On its first turn its battery at (7,19) shells the red
// stack at (7,20) and its destroyer at (3,36) fires on the red destroyer: both in Red's sight.

async function boot(page: Page): Promise<{ errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'warning' || msg.type() === 'error') warnings.push(msg.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => '__mapRoom' in window);
  expect(errors).toEqual([]);
  return { errors, warnings };
}

const blueQueues = (page: Page) =>
  page.evaluate(() =>
    Object.values((window as unknown as { __mapRoom: Hook }).__mapRoom.state.cities)
      .filter((c) => c.owner === 'blue')
      .map((c) => c.queue),
  );

test('the AI plays its turn from the worker, animated where Red can see', async ({ page }) => {
  test.slow();
  const { errors, warnings } = await boot(page);
  const info = page.locator('.turn-info');
  const skip = page.locator('.top-bar .skip');
  await expect(skip).toBeHidden();
  expect(await blueQueues(page)).toEqual([[], [], []]);

  await page.locator('.ai-speed').selectOption('slow');
  await page.locator('.end-turn').click();
  await expect(info).toContainText('Blue is moving…');
  await expect(skip).toBeVisible();
  await expect(page.locator('.end-turn')).toBeDisabled();

  // The battery's shot is logged as it starts to play; catch the strike mid-flight.
  await expect(page.locator('.combat-log')).toContainText('Blue Field Battery (12) bombarded', {
    timeout: 20_000,
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'e2e/.results/ai-turn.png' });

  await expect(info).toContainText('Turn 2', { timeout: 30_000 });
  await expect(info).toContainText('Red');
  await expect(skip).toBeHidden();
  await expect(page.locator('.end-turn')).toBeEnabled();
  await expect(page.locator('.combat-log')).toContainText('Blue Escort Destroyer (6) bombarded');
  expect(await blueQueues(page)).toEqual([['armour'], ['armour'], ['armour']]);
  await page.screenshot({ path: 'e2e/.results/ai-turn-done.png' });
  expect(errors).toEqual([]);
  expect(warnings.filter((w) => w.includes('AI'))).toEqual([]);
});

test('Skip and Escape apply the rest of the AI turn at once, and the speed is remembered', async ({
  page,
}) => {
  test.slow();
  await boot(page);
  const info = page.locator('.turn-info');
  // Slow, so there is time to skip before the turn plays out.
  await page.locator('.ai-speed').selectOption('slow');
  await page.locator('.end-turn').click();
  await expect(info).toContainText('Blue is moving…');
  await page.locator('.top-bar .skip').click();
  await expect(info).toContainText('Turn 2', { timeout: 30_000 });
  // Skipped actions still happen, and what Red could see is still logged.
  expect(await blueQueues(page)).toEqual([['armour'], ['armour'], ['armour']]);
  await expect(page.locator('.combat-log')).toContainText('Blue Field Battery (12) bombarded');

  await page.locator('.end-turn').click();
  await expect(info).toContainText('Blue is moving…');
  await page.keyboard.press('Escape');
  await expect(info).toContainText('Turn 3', { timeout: 30_000 });

  await page.reload();
  await page.waitForFunction(() => '__mapRoom' in window);
  await expect(page.locator('.ai-speed')).toHaveValue('slow');
});
