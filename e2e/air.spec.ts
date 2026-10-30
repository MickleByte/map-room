import { expect, test, type Page } from '@playwright/test';
import type { Coord, GameState, Unit } from '../src/core/types';

interface Hook {
  state: GameState;
  selectUnit(id: number): void;
  centreOnTile(c: Coord): void;
  camera: { zoom: number; centre: Coord; zoomAt(p: Coord, f: number): void };
}

// The sandbox has a red bomber and a red paratrooper in Brindle (7,22), and a red
// fighter in Ashford (6,8). The blue infantry and battery at (7,19) are in bombing range.
const BRINDLE = { x: 7, y: 22 };
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

/** Select a unit by type, owner and tile, and centre on it. Returns its id. */
async function select(page: Page, type: string, at: Coord, zoom = 1): Promise<number> {
  return page.evaluate(
    ({ type, at, zoom }) => {
      const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
      const unit = Object.values(h.state.units).find(
        (u) => u.type === type && u.owner === 'red' && u.pos.x === at.x && u.pos.y === at.y,
      )!;
      h.selectUnit(unit.id);
      h.centreOnTile(at);
      h.camera.zoomAt({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, zoom);
      return unit.id;
    },
    { type, at, zoom },
  );
}

async function unit(page: Page, id: number): Promise<Unit | undefined> {
  return page.evaluate((id) => (window as unknown as { __mapRoom: Hook }).__mapRoom.state.units[id], id);
}

test('a bomber shows its mission range and bombs an enemy in it', async ({ page }) => {
  await boot(page);
  const id = await select(page, 'bomber', BRINDLE, 0.8);
  const panel = page.locator('.unit-panel');
  await expect(panel.locator('.hint')).toContainText('Right-click in the blue range');

  const p = await screenPoint(page, TARGET);
  await page.mouse.move(p.x, p.y);
  const tip = page.locator('.odds-tip');
  await expect(tip.locator('.odds')).toHaveText(/^3 shots at \d+% each$/);
  await expect(tip).toContainText('fighters may intercept');
  await page.screenshot({ path: 'e2e/.results/air-range.png' });

  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.locator('.combat-log li').first()).toContainText(
    /^Red Strategic Bomber \(16\) bombarded Blue Line Infantry/,
  );
  expect(await unit(page, id)).toMatchObject({ pos: BRINDLE, actedThisTurn: true });
  await expect(panel.locator('.unit-row.selected')).toContainText('Flown');
});

test('recon reveals a hidden area, and a rebase moves the bomber', async ({ page }) => {
  test.slow();
  await boot(page);
  const id = await select(page, 'bomber', BRINDLE, 0.7);
  const scout = { x: 14, y: 22 };
  const before = await page.evaluate(
    (c) => (window as unknown as { __mapRoom: { vision: { at(c: Coord): string } } }).__mapRoom.vision.at(c),
    scout,
  );
  expect(before).toBe('unseen');
  const p = await screenPoint(page, scout);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('.path-tip')).toHaveText(/^Recon/);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  const after = await page.evaluate(
    (c) => (window as unknown as { __mapRoom: { vision: { at(c: Coord): string } } }).__mapRoom.vision.at(c),
    scout,
  );
  expect(after).toBe('visible');
  await page.screenshot({ path: 'e2e/.results/air-recon.png' });

  // Next turn, fly it to Corrow (6,36), 8 tiles away.
  await page.keyboard.press('Enter');
  // Skip Blue's turn (if it is still playing).
  await page.keyboard.press('Escape');
  await expect(page.locator('.turn-info')).toContainText('Turn 2', { timeout: 30_000 });
  await select(page, 'bomber', BRINDLE, 0.7);
  const corrow = await screenPoint(page, { x: 6, y: 36 });
  await page.mouse.move(corrow.x, corrow.y);
  await expect(page.locator('.path-tip')).toHaveText('Rebase to Corrow');
  await page.mouse.click(corrow.x, corrow.y, { button: 'right' });
  expect(await unit(page, id)).toMatchObject({ pos: { x: 6, y: 36 }, base: { kind: 'city' } });
});

test('a fighter goes on air superiority', async ({ page }) => {
  await boot(page);
  const id = await select(page, 'fighter', { x: 6, y: 8 });
  const panel = page.locator('.unit-panel');
  await panel.getByRole('button', { name: 'Air superiority (A)' }).click();
  expect((await unit(page, id))!.stance).toBe('airSuperiority');
  await expect(panel.locator('.unit-row.selected')).toContainText('Air superiority');
  await expect(panel.locator('.hint')).toContainText('intercepts the first enemy bomber');
});

test('a paratrooper shows its drop zone and drops into it', async ({ page }) => {
  await boot(page);
  const id = await select(page, 'paratrooper', BRINDLE, 0.8);
  const panel = page.locator('.unit-panel');
  await panel.getByRole('button', { name: 'Paradrop (P)' }).click();
  await expect(panel.locator('.hint')).toContainText('green zone');
  // Pick a tile in the zone four rows down (two tiles away).
  const zone = await page.evaluate(() => {
    const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    return h.state.map.tiles[(22 + 4) * h.state.map.width + 7]!.terrain;
  });
  expect(zone).not.toMatch(/coast|ocean/);
  const drop = { x: 7, y: 26 };
  const p = await screenPoint(page, drop);
  await page.mouse.move(p.x, p.y);
  await expect(page.locator('.path-tip')).toHaveText('Paradrop here');
  await page.screenshot({ path: 'e2e/.results/air-paradrop.png' });
  await page.mouse.click(p.x, p.y, { button: 'right' });
  expect(await unit(page, id)).toMatchObject({ pos: drop, movesLeft: 0, justParadropped: true });
  await expect(panel.locator('.unit-row.selected')).toContainText('Dropped');
});
