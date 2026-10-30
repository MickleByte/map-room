import { expect, test, type Page } from '@playwright/test';

interface DebugHook {
  centreOnTile(c: { x: number; y: number }): void;
  camera: { zoom: number; centre: { x: number; y: number }; zoomAt(p: unknown, f: number): void };
  selection: { x: number; y: number } | null;
}

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await page.waitForFunction(() => '__mapRoom' in window);
  expect(errors).toEqual([]);
}

/** Screen position of a tile's centre, computed in the page from the live camera. */
async function tileScreenPoint(page: Page, c: { x: number; y: number }) {
  return page.evaluate((c) => {
    const { camera } = (window as unknown as { __mapRoom: DebugHook }).__mapRoom;
    const wx = (2 * c.x + (c.y & 1) + 1) * 32;
    const wy = (c.y + 1) * 16;
    return {
      x: (wx - camera.centre.x) * camera.zoom + window.innerWidth / 2,
      y: (wy - camera.centre.y) * camera.zoom + window.innerHeight / 2,
    };
  }, c);
}

test('renders the map with a minimap', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.minimap')).toBeVisible();
  await page.screenshot({ path: 'e2e/.results/map-overview.png' });
});

test('clicking a tile selects it and shows its details', async ({ page }) => {
  await boot(page);
  await page.evaluate(() =>
    (window as unknown as { __mapRoom: DebugHook }).__mapRoom.centreOnTile({ x: 6, y: 8 }),
  );
  const p = await tileScreenPoint(page, { x: 6, y: 8 });
  await page.mouse.click(p.x, p.y);
  const panel = page.locator('.tile-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.coords')).toHaveText('(6, 8)');
  await page.screenshot({ path: 'e2e/.results/map-selected.png' });
});

test('dragging pans across the wrap seam', async ({ page }) => {
  await boot(page);
  await page.evaluate(() =>
    (window as unknown as { __mapRoom: DebugHook }).__mapRoom.centreOnTile({ x: 0, y: 24 }),
  );
  const before = await page.evaluate(
    () => (window as unknown as { __mapRoom: DebugHook }).__mapRoom.camera.centre.x,
  );
  await page.mouse.move(640, 400);
  await page.mouse.down();
  await page.mouse.move(900, 400, { steps: 10 });
  await page.mouse.up();
  const after = await page.evaluate(
    () => (window as unknown as { __mapRoom: DebugHook }).__mapRoom.camera.centre.x,
  );
  // Dragging right moves the camera left, past x = 0, so it wraps to the far end of the world.
  expect(before).toBeLessThan(100);
  expect(after).toBeGreaterThan(1000);
  await page.screenshot({ path: 'e2e/.results/map-seam.png' });
});
