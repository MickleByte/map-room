import { expect, test, type Page } from '@playwright/test';
import type { Action, Coord, GameState } from '../src/core/types';

// The Straits is the game a fresh page starts. Red (the human) holds the west, Blue
// (the AI) the east; the only land route between them is the fortified bridge.

interface Hook {
  state: GameState;
  busy: boolean;
  selectUnit(id: number): void;
  centreOnTile(c: Coord): void;
  dispatch(action: Action): boolean;
  camera: { zoom: number; centre: Coord };
}

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/');
  await page.waitForFunction(() => '__mapRoom' in window);
  return errors;
}

const state = (page: Page) => page.evaluate(() => (window as unknown as { __mapRoom: Hook }).__mapRoom.state);

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

test('a new game starts The Straits, with both sides massed at the bridge', async ({ page }) => {
  const errors = await boot(page);
  await expect(page.locator('.top-bar')).toContainText('The Straits');
  await expect(page.locator('.turn-info')).toContainText('Turn 1');
  const s = await state(page);
  expect(s.scenarioId).toBe('the-straits');
  expect(s.map).toMatchObject({ width: 60, height: 80, wrapX: true });
  // The first unit up is a Red tank behind the fortress line.
  await expect(page.locator('.unit-row.selected')).toContainText('Battle Tank');
  await page.screenshot({ path: 'e2e/.results/straits-start.png' });
  expect(errors).toEqual([]);
});

test('The Straits can be played through to the end', async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const errors = await boot(page);
  await page.locator('.ai-speed').selectOption('fast');

  // Turn 1, by hand: right-click a tile beside the selected tank to move it there.
  const { tankId, from, to } = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const grid = (await load('/src/core/grid.ts')) as typeof import('../src/core/grid');
    const movement = (await load('/src/core/movement.ts')) as typeof import('../src/core/movement');
    const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    const tank = Object.values(h.state.units).find((u) => u.type === 'armour' && u.owner === 'red')!;
    h.selectUnit(tank.id);
    h.centreOnTile(tank.pos);
    const to = grid.neighbours(h.state.map, tank.pos).find((c) => !movement.cannotEnter(h.state, tank, c))!;
    return { tankId: tank.id, from: tank.pos, to };
  });
  const at = await screenPoint(page, to);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  const moved = (await state(page)).units[tankId]!;
  expect(moved.pos).toEqual(to);
  expect(moved.pos).not.toEqual(from);
  await page.screenshot({ path: 'e2e/.results/straits-turn1.png' });

  // From then on Red's orders come from the same planner the AI uses, given through the
  // controller exactly as the human's clicks are, and each turn is ended with the button.
  const shots = new Set([2, 6, 12]);
  for (let turn = 1; turn <= 120; turn++) {
    const s = await state(page);
    if (s.winner) break;
    if (turn > 1) {
      const refused = await page.evaluate(async () => {
        const load = (path: string) => import(/* @vite-ignore */ path);
        const ai = (await load('/src/ai/decide.ts')) as typeof import('../src/ai/decide');
        const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
        const plan = ai.decide(h.state, 'red').filter((a) => a.type !== 'endTurn');
        return plan.filter((a) => !h.dispatch(a)).length;
      });
      expect(refused).toBe(0);
    }
    if (shots.has(s.turn)) await page.screenshot({ path: `e2e/.results/straits-turn${s.turn}.png` });
    if ((await state(page)).winner) break;
    await page.locator('.end-turn').click();
    // Blue's turn plays back; skip the animation, then wait for Red's next turn (or the end).
    await page
      .locator('.top-bar .skip')
      .click({ timeout: 5_000 })
      .catch(() => {});
    await page.waitForFunction(
      () => {
        const h = (window as unknown as { __mapRoom: Hook }).__mapRoom;
        return !h.busy && (h.state.winner !== null || h.state.players[h.state.currentPlayer]!.id === 'red');
      },
      undefined,
      { timeout: 120_000 },
    );
  }

  const end = await state(page);
  expect(end.winner).not.toBeNull();
  expect(Object.values(end.cities).every((c) => c.owner === end.winner)).toBe(true);
  const card = page.locator('.end-card');
  await expect(card).toBeVisible();
  await expect(card.locator('h1')).toHaveText(end.winner === 'red' ? 'Victory' : 'Defeat');
  await page.screenshot({ path: 'e2e/.results/straits-end.png' });
  expect(errors).toEqual([]);
});
