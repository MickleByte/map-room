import { expect, test, type Page } from '@playwright/test';
import type { Coord, GameState } from '../src/core/types';
import type { Visibility } from '../src/core/visibility';

interface Hook {
  state: GameState;
  vision: { at(c: Coord): Visibility };
  dispatch(action: unknown): boolean;
  selectUnit(id: number): void;
  centreOnTile(c: Coord): void;
  camera: { zoom: number; centre: Coord; zoomAt(p: Coord, f: number): void };
}

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await page.waitForFunction(() => '__mapRoom' in window);
  expect(errors).toEqual([]);
}

async function clickTile(page: Page, c: Coord): Promise<void> {
  const p = await page.evaluate((c) => {
    const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    h.centreOnTile(c);
    const wx = (2 * c.x + (c.y & 1) + 1) * 32;
    const wy = (c.y + 1) * 16;
    return {
      x: (wx - h.camera.centre.x) * h.camera.zoom + window.innerWidth / 2,
      y: (wy - h.camera.centre.y) * h.camera.zoom + window.innerHeight / 2,
    };
  }, c);
  await page.mouse.click(p.x, p.y);
}

test('the enemy’s side of the map starts unseen', async ({ page }) => {
  await boot(page);
  // Blue's city Dunmere, held by blue units, is far from any red unit.
  await clickTile(page, { x: 22, y: 8 });
  await expect(page.locator('.tile-panel h2')).toHaveText('Unseen');
  await expect(page.locator('.unit-panel')).toBeHidden();
  await page.screenshot({ path: 'e2e/.results/fog-unseen.png' });

  await page.evaluate(() => {
    const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    h.centreOnTile({ x: 8, y: 10 });
    h.camera.zoomAt({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, 0.6);
  });
  await page.screenshot({ path: 'e2e/.results/fog-start.png' });
});

test('tiles stay remembered, without units, after a unit drives away', async ({ page }) => {
  await boot(page);
  const remembered = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const grid = (await load('/src/core/grid.ts')) as typeof import('../src/core/grid');
    const reducer = (await load('/src/core/reducer.ts')) as typeof import('../src/core/reducer');
    const visibility = (await load('/src/core/visibility.ts')) as typeof import('../src/core/visibility');
    const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    const { state } = h;
    const tank = Object.values(state.units).find((u) => u.type === 'armour' && u.owner === 'red')!;
    // Try go-to orders for the tank until one leaves a tile it saw on the way out of sight.
    for (let i = 0; i < state.map.tiles.length; i++) {
      const target = grid.indexToCoord(state.map, i);
      if (grid.distance(state.map, tank.pos, target) !== 3) continue;
      const action = { type: 'setOrders', unitId: tank.id, orders: { kind: 'goto', target } } as const;
      const result = reducer.applyAction(state, action);
      if (!result.ok) continue;
      const vision = new visibility.Vision(result.state, 'red');
      const j = result.state.map.tiles.findIndex(
        (_, j) => vision.at(grid.indexToCoord(state.map, j)) === 'remembered',
      );
      if (j < 0) continue;
      h.dispatch(action);
      h.selectUnit(tank.id);
      h.centreOnTile(target);
      return grid.indexToCoord(state.map, j);
    }
    return null;
  });
  expect(remembered).not.toBeNull();

  await page.evaluate(() => {
    const { camera } = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    camera.zoomAt({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, 1.6);
  });
  await clickTile(page, remembered!);
  await expect(page.locator('.tile-panel .hint')).toHaveText(
    'Out of sight: showing what was last seen here.',
  );
  await expect(page.locator('.unit-panel')).toBeHidden();
  await page.screenshot({ path: 'e2e/.results/fog-remembered.png' });
});
