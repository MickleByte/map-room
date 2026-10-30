import { expect, test, type Page } from '@playwright/test';
import type { Coord, GameState } from '../src/core/types';

interface Hook {
  state: GameState;
  selectUnit(id: number): void;
  centreOnTile(c: Coord): void;
  camera: { zoom: number; centre: Coord; zoomAt(p: Coord, f: number): void };
}

// The sandbox puts a fortified blue infantry and a battery in the forest at (7,19),
// next to the red tank at (7,20).
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

/** Select the red tank next to the target and zoom in on them. */
async function selectTank(page: Page): Promise<number> {
  return page.evaluate((target) => {
    const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    const tank = Object.values(h.state.units).find(
      (u) => u.type === 'armour' && u.owner === 'red' && u.pos.x === 7 && u.pos.y === 20,
    )!;
    h.selectUnit(tank.id);
    h.centreOnTile(target);
    h.camera.zoomAt({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, 1.5);
    return tank.id;
  }, TARGET);
}

test('hovering an adjacent enemy shows the odds and the defence modifiers', async ({ page }) => {
  await boot(page);
  await selectTank(page);
  const p = await screenPoint(page, TARGET);
  await page.mouse.move(p.x, p.y);
  const tip = page.locator('.odds-tip');
  await expect(tip).toBeVisible();
  await expect(tip.locator('.odds')).toHaveText(/^\d+% to win$/);
  await expect(tip).toContainText('Forest');
  await expect(tip).toContainText('Fortified');
  await expect(tip).toContainText('×1.5 = 15');
  await expect(page.locator('.path-tip')).toBeHidden();
  await page.screenshot({ path: 'e2e/.results/combat-odds.png' });
});

test('right-clicking an adjacent enemy attacks and records it in the combat log', async ({ page }) => {
  await boot(page);
  const tankId = await selectTank(page);
  const p = await screenPoint(page, TARGET);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const log = page.locator('.combat-log');
  await expect(log).toBeVisible();
  await expect(log.locator('li').first()).toContainText('Red Battle Tank (24)');

  // A win kills the only defender, so the tank advances and captures the battery.
  const tank = await page.evaluate(
    (id) => (window as unknown as { __mapRoom: Hook }).__mapRoom.state.units[id],
    tankId,
  );
  if (tank) {
    expect(tank.pos).toEqual(TARGET);
    await expect(log).toContainText('Red captured Blue Field Battery.');
  }
  await page.screenshot({ path: 'e2e/.results/combat-log.png' });
});
