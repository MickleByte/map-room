import { GameController } from './app/controller';
import sandbox from './data/scenarios/sandbox.json';
import { newGame, type Game } from './persistence/files';

let current: GameController | null = null;

/** Show a game, replacing the one on screen (a load, an import or a new game). */
async function open(game: Game): Promise<void> {
  const stage = document.getElementById('stage');
  const ui = document.getElementById('ui');
  if (!stage || !ui) throw new Error('#stage or #ui element missing');

  current?.destroy();
  current = await GameController.start(stage, ui, game, {
    open,
    newGame: () => open(newGame(sandbox)),
  });

  // Test hook for Playwright: lets e2e tests drive the camera and selection directly.
  if (import.meta.env.DEV) Object.assign(window, { __mapRoom: current });
}

void open(newGame(sandbox));
