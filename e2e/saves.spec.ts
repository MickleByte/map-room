import { expect, test, type Page } from '@playwright/test';
import type { Action, GameState } from '../src/core/types';
import type { Game } from '../src/persistence/files';

interface Hook {
  state: GameState;
  game: Game;
  dispatch(action: Action): boolean;
}

/** Hand the menu's import picker a file made in the page. */
async function chooseFile(page: Page, name: string, text: string): Promise<void> {
  await page.evaluate(
    ({ name, text }) => {
      const input = document.querySelector<HTMLInputElement>('.game-menu input[type=file]')!;
      const files = new DataTransfer();
      files.items.add(new File([text], name, { type: 'application/json' }));
      input.files = files.files;
      input.dispatchEvent(new Event('change'));
    },
    { name, text },
  );
}

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto('/?scenario=sandbox');
  await page.waitForFunction(() => '__mapRoom' in window);
  return errors;
}

/** Fortify Red's first two free land units and queue a tank in Ashford: three logged actions. */
async function playALittle(page: Page): Promise<void> {
  const ok = await page.evaluate(() => {
    const game = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    const free = Object.values(game.state.units)
      .filter(
        (u) =>
          u.owner === 'red' &&
          !u.fortified &&
          u.carriedBy === null &&
          ['infantry', 'armour', 'mechInfantry', 'antiTank'].includes(u.type),
      )
      .slice(0, 2);
    const ashford = Object.values(game.state.cities).find((c) => c.name === 'Ashford')!;
    return [
      ...free.map((u) => game.dispatch({ type: 'fortify', unitId: u.id })),
      game.dispatch({ type: 'setProduction', cityId: ashford.id, queue: ['armour'], repeat: false }),
    ];
  });
  expect(ok).toEqual([true, true, true]);
}

const stateJson = (page: Page) =>
  page.evaluate(() => JSON.stringify((window as unknown as { __mapRoom: Hook }).__mapRoom.state));

/** Whether the game's log replays, in the page, to its current state. */
const replaysToState = (page: Page) =>
  page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { replay, firstDifference } = (await load(
      '/src/core/replay.ts',
    )) as typeof import('../src/core/replay');
    const { game } = (window as unknown as { __mapRoom: Hook }).__mapRoom;
    const result = replay(game.initialState, game.actions);
    return result.ok ? firstDifference(result.state, game.state) : `refused: ${result.reason}`;
  });

const menu = (page: Page) => page.locator('.game-menu');

async function openMenu(page: Page): Promise<void> {
  await page.locator('.top-bar .menu-button').click();
  await expect(menu(page)).toBeVisible();
}

test('a game saved to a slot loads back after a reload, exactly as it was', async ({ page }) => {
  test.slow();
  const errors = await boot(page);
  await playALittle(page);
  const saved = await stateJson(page);
  expect(
    await page.evaluate(() => (window as unknown as { __mapRoom: Hook }).__mapRoom.game.actions.length),
  ).toBe(3);

  await openMenu(page);
  await menu(page).locator('input.save-name').fill('Dug in');
  await menu(page).getByRole('button', { name: 'Save', exact: true }).click();
  const row = menu(page).locator('.slot', { hasText: 'Dug in' });
  await expect(row).toContainText('Turn 1');
  await page.screenshot({ path: 'e2e/.results/saves-menu.png' });

  await page.reload();
  await page.waitForFunction(() => '__mapRoom' in window);
  expect(await stateJson(page)).not.toEqual(saved);

  await openMenu(page);
  await menu(page).locator('.slot', { hasText: 'Dug in' }).getByRole('button', { name: 'Load' }).click();
  await expect(menu(page)).toBeHidden();
  await page.waitForFunction(
    () => (window as unknown as { __mapRoom: Hook }).__mapRoom.game.actions.length === 3,
  );
  expect(await stateJson(page)).toEqual(saved);
  expect(await replaysToState(page)).toBeNull();

  // The loaded game plays on, and its log keeps growing.
  await page.locator('.end-turn').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.turn-info')).toContainText('Turn 2', { timeout: 30_000 });
  expect(await replaysToState(page)).toBeNull();
  expect(errors).toEqual([]);
});

test('the start of each human turn is autosaved', async ({ page }) => {
  test.slow();
  const errors = await boot(page);
  await playALittle(page);
  await page.locator('.end-turn').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.turn-info')).toContainText('Turn 2', { timeout: 30_000 });
  const turn2 = await stateJson(page);

  await openMenu(page);
  const autosave = menu(page).locator('.slot', { hasText: 'Autosave' });
  await expect(autosave).toContainText('Turn 2');
  await page.reload();
  await page.waitForFunction(() => '__mapRoom' in window);
  await openMenu(page);
  await menu(page).locator('.slot', { hasText: 'Autosave' }).getByRole('button', { name: 'Load' }).click();
  await page.waitForFunction(() => (window as unknown as { __mapRoom: Hook }).__mapRoom.state.turn === 2);
  expect(await stateJson(page)).toEqual(turn2);
  expect(errors).toEqual([]);
});

test('games and scenarios export to JSON and import again; a bad file is refused clearly', async ({
  page,
}, info) => {
  test.slow();
  const errors = await boot(page);
  await playALittle(page);
  const saved = await stateJson(page);
  await openMenu(page);

  const [gameDownload] = await Promise.all([
    page.waitForEvent('download'),
    menu(page).getByRole('button', { name: 'Export game' }).click(),
  ]);
  expect(gameDownload.suggestedFilename()).toMatch(/\.json$/);
  const gameFile = info.outputPath('game.json');
  await gameDownload.saveAs(gameFile);

  const [scenarioDownload] = await Promise.all([
    page.waitForEvent('download'),
    menu(page).getByRole('button', { name: 'Export scenario' }).click(),
  ]);
  expect(scenarioDownload.suggestedFilename()).toBe('sandbox.json');
  const scenarioFile = info.outputPath('scenario.json');
  await scenarioDownload.saveAs(scenarioFile);

  // A broken save: its snapshot no longer matches its log.
  const broken = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const files = (await load('/src/persistence/files.ts')) as typeof import('../src/persistence/files');
    const save = structuredClone(
      files.createSave((window as unknown as { __mapRoom: Hook }).__mapRoom.game, 'Broken', 'now'),
    );
    save.state.turn = 7;
    return files.saveToJson(save);
  });

  await page.reload();
  await page.waitForFunction(() => '__mapRoom' in window);
  await openMenu(page);
  await chooseFile(page, 'broken.json', broken);
  await expect(menu(page).locator('.menu-message.error')).toContainText('Invalid save');
  await expect(menu(page).locator('.menu-message.error')).toContainText('first difference at state.turn');
  await page.screenshot({ path: 'e2e/.results/saves-import-error.png' });

  await menu(page).locator('input[type=file]').setInputFiles(gameFile);
  await expect(menu(page)).toBeHidden();
  await page.waitForFunction(
    () => (window as unknown as { __mapRoom: Hook }).__mapRoom.game.actions.length === 3,
  );
  expect(await stateJson(page)).toEqual(saved);

  // The scenario starts a fresh game.
  await openMenu(page);
  await menu(page).locator('input[type=file]').setInputFiles(scenarioFile);
  await expect(menu(page)).toBeHidden();
  await page.waitForFunction(
    () => (window as unknown as { __mapRoom: Hook }).__mapRoom.game.actions.length === 0,
  );
  await expect(page.locator('.turn-info')).toContainText('Turn 1');
  expect(errors).toEqual([]);
});
