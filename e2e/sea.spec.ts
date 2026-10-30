import { expect, test, type Page } from '@playwright/test';
import type { Coord, GameState, Unit } from '../src/core/types';

interface Hook {
  state: GameState;
  selectUnit(id: number): void;
  centreOnTile(c: Coord): void;
  camera: { zoom: number; centre: Coord; zoomAt(p: Coord, f: number): void };
}

// The sandbox has a red troopship in port at Corrow (6,36) with an infantry aboard, an
// empty troopship at sea at (5,34) next to the red tank at (6,34), and a red destroyer
// at (4,36) next to a blue one at (3,36).
const CORROW = { x: 6, y: 36 };

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

/** Select a unit by type, owner and tile, and zoom in on it. Returns its id. */
async function select(page: Page, type: string, owner: string, at: Coord): Promise<number> {
  return page.evaluate(
    ({ type, owner, at }) => {
      const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
      const unit = Object.values(h.state.units).find(
        (u) => u.type === type && u.owner === owner && u.pos.x === at.x && u.pos.y === at.y,
      )!;
      h.selectUnit(unit.id);
      h.centreOnTile(at);
      h.camera.zoomAt({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, 1.5);
      return unit.id;
    },
    { type, owner, at },
  );
}

async function unit(page: Page, id: number): Promise<Unit | undefined> {
  return page.evaluate((id) => (window as unknown as { __mapRoom: Hook }).__mapRoom.state.units[id], id);
}

test('a unit boards a troopship in port, and goes ashore again', async ({ page }) => {
  await boot(page);
  const id = await select(page, 'mechInfantry', 'red', CORROW);
  const panel = page.locator('.unit-panel');
  await expect(panel.locator('.unit-row', { hasText: 'Troopship' })).toContainText('Cargo 1/4');
  await panel.getByRole('button', { name: 'Board (B)' }).click();
  expect((await unit(page, id))!.carriedBy).not.toBeNull();
  await expect(panel.locator('.unit-row', { hasText: 'Troopship' })).toContainText('Cargo 2/4');
  await expect(panel.locator('.unit-row.cargo', { hasText: 'Mechanised Infantry' })).toContainText('Aboard');
  await expect(panel.locator('.hint')).toContainText('Aboard ship');
  await page.screenshot({ path: 'e2e/.results/sea-board.png' });

  await panel.getByRole('button', { name: 'Go ashore' }).click();
  expect(await unit(page, id)).toMatchObject({ carriedBy: null, pos: CORROW });
  await expect(panel.locator('.unit-row', { hasText: 'Troopship' })).toContainText('Cargo 1/4');
});

test('a tank boards a troopship at sea by moving onto it, and lands by moving ashore', async ({ page }) => {
  await boot(page);
  const id = await select(page, 'armour', 'red', { x: 6, y: 34 });
  const sea = await screenPoint(page, { x: 5, y: 34 });
  await page.mouse.click(sea.x, sea.y, { button: 'right' });
  expect(await unit(page, id)).toMatchObject({ pos: { x: 5, y: 34 } });
  expect((await unit(page, id))!.carriedBy).not.toBeNull();
  await page.screenshot({ path: 'e2e/.results/sea-aboard.png' });

  await expect(page.locator('.unit-panel .hint')).toContainText('Aboard ship');
  const land = await screenPoint(page, { x: 6, y: 34 });
  await page.mouse.click(land.x, land.y, { button: 'right' });
  expect(await unit(page, id)).toMatchObject({ pos: { x: 6, y: 34 }, carriedBy: null });
});

test('ships fight ships at sea', async ({ page }) => {
  await boot(page);
  const id = await select(page, 'destroyer', 'red', { x: 4, y: 36 });
  const enemy = await screenPoint(page, { x: 3, y: 36 });
  await page.mouse.move(enemy.x, enemy.y);
  await expect(page.locator('.odds-tip .odds')).toHaveText(/^\d+% to win$/);
  await page.mouse.click(enemy.x, enemy.y, { button: 'right' });
  const log = page.locator('.combat-log li').first();
  await expect(log).toContainText(
    /^Red Escort Destroyer \(12\) (defeated|was destroyed attacking) Blue Escort Destroyer/,
  );
  const after = await unit(page, id);
  if (after) expect(after.pos).toEqual({ x: 3, y: 36 });
  await page.screenshot({ path: 'e2e/.results/sea-combat.png' });
});
