import { expect, test, type Page } from '@playwright/test';
import type { Action, Coord, GameState } from '../src/core/types';

interface Hook {
  state: GameState;
  refresh(): void;
  dispatch(action: Action): boolean;
  centreOnTile(c: Coord): void;
  camera: { zoom: number; centre: Coord; zoomAt(p: Coord, f: number): void };
}

// The sandbox's red city Ashford (6,8) makes 10 shields a turn and starts with an empty
// queue. Blue's cities are Dunmere (22,8), Eskvale (22,24) and Fallowby (21,38).
const ASHFORD = { x: 6, y: 8 };
const FALLOWBY = { x: 21, y: 38 };

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

/** Centre on Ashford and click it. */
async function openAshford(page: Page): Promise<void> {
  await page.evaluate((c) => (window as unknown as { __mapRoom: Hook }).__mapRoom.centreOnTile(c), ASHFORD);
  const p = await screenPoint(page, ASHFORD);
  await page.mouse.click(p.x, p.y);
}

/** Pick a unit type in the city panel and add it to the queue. */
async function add(page: Page, type: string): Promise<void> {
  const panel = page.locator('.city-panel');
  await panel.locator('select').selectOption(type);
  await panel.getByRole('button', { name: 'Add' }).click();
}

const ashford = (page: Page) =>
  page.evaluate(() =>
    Object.values((window as unknown as { __mapRoom: Hook }).__mapRoom.state.cities).find(
      (c) => c.name === 'Ashford',
    ),
  );

test('selecting your own city opens its production panel, where the queue can be edited', async ({
  page,
}) => {
  // Every queue edit redraws the whole map, which is slow in headless Chromium.
  test.slow();
  await boot(page);
  await openAshford(page);
  const panel = page.locator('.city-panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('h2')).toHaveText('Ashford');
  await expect(panel).toContainText('Nothing queued');

  await add(page, 'infantry');
  await add(page, 'armour');
  await expect(panel.locator('.queue li')).toHaveText(['Line Infantry×', 'Battle Tank×']);
  await expect(panel.locator('.shields')).toHaveText('Shields 0 / 90 (+10 a turn)');
  await expect(panel.locator('.eta')).toHaveText('Line Infantry in 9 turns');
  // Ashford is inland, so ships are greyed out.
  await expect(panel.locator('option[value="destroyer"]')).toBeDisabled();

  await panel.locator('.repeat input').click();
  await expect(panel.locator('.repeat input')).toBeChecked();
  expect(await ashford(page)).toMatchObject({ queue: ['infantry', 'armour'], repeat: true });

  await panel.locator('.queue li').first().locator('.remove').click();
  await expect(panel.locator('.queue li')).toHaveText(['Battle Tank×']);
  await panel.screenshot({ path: 'e2e/.results/city-panel.png' });
  await page.screenshot({ path: 'e2e/.results/city-panel-page.png' });
});

test('enemy cities have no production panel', async ({ page }) => {
  await boot(page);
  const dunmere = { x: 22, y: 8 };
  await page.evaluate((c) => (window as unknown as { __mapRoom: Hook }).__mapRoom.centreOnTile(c), dunmere);
  const p = await screenPoint(page, dunmere);
  await page.mouse.click(p.x, p.y);
  await expect(page.locator('.tile-panel')).toBeVisible();
  await expect(page.locator('.city-panel')).toBeHidden();
});

test('a finished unit appears in the city at the start of your turn', async ({ page }) => {
  test.slow();
  await boot(page);
  // Nearly enough for Line Infantry (90): the next 10 shields finish it.
  await page.evaluate(() => {
    const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    const s = structuredClone(h.state);
    Object.values(s.cities).find((c) => c.name === 'Ashford')!.shieldsStored = 85;
    h.state = s;
    h.refresh();
  });
  await openAshford(page);
  const panel = page.locator('.city-panel');
  await add(page, 'infantry');
  await expect(panel.locator('.eta')).toHaveText('Line Infantry next turn');

  const infantryInAshford = () =>
    page.evaluate(
      (c) =>
        Object.values((window as unknown as { __mapRoom: Hook }).__mapRoom.state.units).filter(
          (u) => u.pos.x === c.x && u.pos.y === c.y && u.type === 'infantry',
        ).length,
      ASHFORD,
    );
  const before = await infantryInAshford();
  await page.locator('.end-turn').click();
  // Skip Blue's turn; the toast comes once it is over.
  await page.keyboard.press('Escape');
  await expect(page.locator('.toast')).toHaveText('Ashford built Line Infantry.', { timeout: 30_000 });
  expect(await infantryInAshford()).toBe(before + 1);
  expect(await ashford(page)).toMatchObject({ queue: [], shieldsStored: 5 });
});

test('taking the last enemy city shows the victory screen', async ({ page }) => {
  await boot(page);
  // Hand Red every blue city but Fallowby, empty Fallowby, and put a red infantry next to it.
  const infantry = await page.evaluate((target) => {
    const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    const s = structuredClone(h.state);
    for (const c of Object.values(s.cities)) if (c.name !== 'Fallowby') c.owner = 'red';
    for (const u of Object.values(s.units))
      if (u.pos.x === target.x && u.pos.y === target.y) delete s.units[u.id];
    // Fallowby's row is even, so these are its four edge neighbours.
    const around = [-1, 1].flatMap((dy) => [0, -1].map((dx) => ({ x: target.x + dx, y: target.y + dy })));
    const land = around.find((c) => {
      const t = s.map.tiles[c.y * s.map.width + c.x]!.terrain;
      const empty = !Object.values(s.units).some((u) => u.pos.x === c.x && u.pos.y === c.y);
      return t !== 'coast' && t !== 'ocean' && empty;
    })!;
    const inf = Object.values(s.units).find((u) => u.type === 'infantry' && u.owner === 'red')!;
    inf.pos = land;
    inf.carriedBy = null;
    inf.movesLeft = 3;
    inf.fortified = false;
    h.state = s;
    h.centreOnTile(target);
    h.refresh();
    return inf.id;
  }, FALLOWBY);

  const ok = await page.evaluate(
    ({ id, to }) =>
      (window as unknown as { __mapRoom: Hook }).__mapRoom.dispatch({ type: 'move', unitId: id, to }),
    { id: infantry, to: FALLOWBY },
  );
  expect(ok).toBe(true);

  const screen = page.locator('.end-screen');
  await expect(screen).toBeVisible();
  await expect(screen.locator('h1')).toHaveText('Victory');
  await expect(screen).toContainText('Red took every enemy city');
  await expect(page.locator('.combat-log')).toContainText('Red has taken every enemy city and won the game.');
  await page.screenshot({ path: 'e2e/.results/victory.png' });

  await screen.getByRole('button', { name: 'View the map' }).click();
  await expect(screen).toBeHidden();
  await page.locator('.end-turn').click();
  await expect(page.locator('.toast')).toHaveText('The game is over');
});
