import { expect, test, type Page } from '@playwright/test';
import type { Coord, GameState } from '../src/core/types';

interface Hook {
  state: GameState;
  selectUnit(id: number): void;
  centreOnTile(c: Coord): void;
  camera: { zoom: number; centre: Coord };
}

const hook = (page: Page) => page.evaluate.bind(page);

async function boot(page: Page): Promise<void> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await page.waitForFunction(() => '__mapRoom' in window);
  expect(errors).toEqual([]);
}

async function screenPoint(page: Page, c: Coord) {
  return hook(page)((c) => {
    const { camera } = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    const wx = (2 * c.x + (c.y & 1) + 1) * 32;
    const wy = (c.y + 1) * 16;
    return {
      x: (wx - camera.centre.x) * camera.zoom + window.innerWidth / 2,
      y: (wy - camera.centre.y) * camera.zoom + window.innerHeight / 2,
    };
  }, c);
}

/**
 * A red tank and a tile it can reach this turn in two or more steps, worked out in the
 * page with the real core modules (served by Vite).
 */
async function plannedMove(page: Page): Promise<{ tankId: number; target: Coord }> {
  return page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const grid = (await load('/src/core/grid.ts')) as typeof import('../src/core/grid');
    const movement = (await load('/src/core/movement.ts')) as typeof import('../src/core/movement');
    const { state } = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    const tank = Object.values(state.units).find((u) => u.type === 'armour' && u.owner === 'red')!;
    for (let i = 0; i < state.map.tiles.length; i++) {
      const c = grid.indexToCoord(state.map, i);
      if (grid.distance(state.map, tank.pos, c) !== 2) continue;
      const path = movement.findPath(state, tank, c);
      if (path && path.at(-1)!.turn === 0) return { tankId: tank.id, target: c };
    }
    throw new Error('no reachable target for the test tank');
  });
}

test('a unit is selected at the start and the stack is listed', async ({ page }) => {
  await boot(page);
  await expect(page.locator('.unit-panel')).toBeVisible();
  await expect(page.locator('.unit-row.selected')).toHaveCount(1);
  await expect(page.locator('.turn-info')).toContainText('Turn 1');
  await page.screenshot({ path: 'e2e/.results/units-start.png' });
});

test('hovering previews a path and right-clicking moves the unit', async ({ page }) => {
  await boot(page);
  const { tankId, target } = await plannedMove(page);
  await hook(page)(
    ({ tankId, target }) => {
      const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
      h.selectUnit(tankId);
      h.centreOnTile(target);
    },
    { tankId, target },
  );
  const p = await screenPoint(page, target);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('.path-tip')).toHaveText('This turn');
  await page.screenshot({ path: 'e2e/.results/units-path.png' });

  await page.mouse.click(p.x, p.y, { button: 'right' });
  const pos = await hook(page)(
    (id) => (window as unknown as { __mapRoom: Hook }).__mapRoom.state.units[id]!.pos,
    tankId,
  );
  expect(pos).toEqual(target);
  await page.screenshot({ path: 'e2e/.results/units-moved.png' });
});

test('ending the turn plays the AI turn and starts turn 2', async ({ page }) => {
  test.slow();
  await boot(page);
  await page.locator('.end-turn').click();
  // Blue's turn plays back at normal speed first.
  await expect(page.locator('.turn-info')).toContainText('Turn 2', { timeout: 30_000 });
  await expect(page.locator('.turn-info')).toContainText('Red');
});
