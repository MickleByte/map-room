import { GameController } from './app/controller';
import sandbox from './data/scenarios/sandbox.json';
import theStraits from './data/scenarios/the-straits.json';
import { newGame, type Game } from './persistence/files';

/** The scenarios a new game can start from, by id. The Straits is the default. */
const scenarios: Record<string, unknown> = { 'the-straits': theStraits, sandbox };

/** The scenario named by `?scenario=<id>` (the e2e tests use the sandbox), else The Straits. */
const scenario = scenarios[new URLSearchParams(window.location.search).get('scenario') ?? ''] ?? theStraits;

let current: GameController | null = null;

/** Show a game, replacing the one on screen (a load, an import or a new game). */
async function open(game: Game): Promise<void> {
  const stage = document.getElementById('stage');
  const ui = document.getElementById('ui');
  if (!stage || !ui) throw new Error('#stage or #ui element missing');

  current?.destroy();
  current = await GameController.start(stage, ui, game, {
    open,
    newGame: () => open(newGame(scenario)),
  });

  // Test hook for Playwright: lets e2e tests drive the camera and selection directly.
  if (import.meta.env.DEV) Object.assign(window, { __mapRoom: current });
}

void open(newGame(scenario));
