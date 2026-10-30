import { expect, test, type Page } from '@playwright/test';
import type { Coord, GameState } from '../src/core/types';

interface Hook {
  state: GameState;
  selectUnit(id: number): void;
  centreOnTile(c: Coord): void;
  camera: { zoom: number; centre: Coord; zoomAt(p: Coord, f: number): void };
}

// The sandbox puts a fortified blue infantry and a battery in the forest at (7,19),
// next to the red tank and battery at (7,20).
const TARGET = { x: 7, y: 19 };

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await page.waitForFunction(() => '__mapRoom' in window);
  expect(errors).toEqual([]);
}

async function screenPoint(page: Page, c: Coord) {
  return page.evaluate((c) => {
    const { camera } = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    const wx = (2 * c.x + (c.y & 1) + 1) * 32;
    const wy = (c.y + 1) * 16;
    return {
      x: (wx - camera.centre.x) * camera.zoom + window.innerWidth / 2,
      y: (wy - camera.centre.y) * camera.zoom + window.innerHeight / 2,
    };
  }, c);
}

/** Select the red battery next to the target and zoom in on them. */
async function selectBattery(page: Page): Promise<number> {
  return page.evaluate((target) => {
    const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    const gun = Object.values(h.state.units).find(
      (u) => u.type === 'artillery' && u.owner === 'red' && u.pos.x === 7 && u.pos.y === 20,
    )!;
    h.selectUnit(gun.id);
    h.centreOnTile(target);
    h.camera.zoomAt({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, 1.5);
    return gun.id;
  }, TARGET);
}

test('a selected battery shows its range, and hovering an enemy shows the bombard odds', async ({ page }) => {
  await boot(page);
  await selectBattery(page);
  const p = await screenPoint(page, TARGET);
  await page.mouse.move(p.x, p.y);
  const tip = page.locator('.odds-tip');
  await expect(tip).toBeVisible();
  await expect(tip.locator('.odds')).toHaveText(/^2 shots at \d+% each$/);
  await expect(tip).toContainText('Forest');
  await expect(tip).toContainText('Fortified');
  await expect(tip).toContainText('×1.5 = 15');
  await expect(tip).toContainText('cannot fall below 1 HP');
  await page.screenshot({ path: 'e2e/.results/bombard-range.png' });
});

test('right-clicking an enemy in range bombards it and logs the result', async ({ page }) => {
  await boot(page);
  const gunId = await selectBattery(page);
  const p = await screenPoint(page, TARGET);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const log = page.locator('.combat-log');
  await expect(log).toBeVisible();
  await expect(log.locator('li').first()).toContainText(
    /^Red Field Battery \(12\) bombarded Blue Line Infantry \(15\): \d hits?, \d miss(es)?, /,
  );
  const gun = await page.evaluate(
    (id) => (window as unknown as { __mapRoom: Hook }).__mapRoom.state.units[id],
    gunId,
  );
  expect(gun).toMatchObject({ pos: { x: 7, y: 20 }, movesLeft: 0 });
  await page.screenshot({ path: 'e2e/.results/bombard-log.png' });
});
