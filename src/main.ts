import { GameController } from './app/controller';
import { loadScenario } from './core/scenario';
import sandbox from './data/scenarios/sandbox.json';

async function start(): Promise<void> {
  const stage = document.getElementById('stage');
  const ui = document.getElementById('ui');
  if (!stage || !ui) throw new Error('#stage or #ui element missing');

  const state = loadScenario(sandbox);
  const controller = await GameController.start(stage, ui, state, sandbox.name);

  // Test hook for Playwright: lets e2e tests drive the camera and selection directly.
  if (import.meta.env.DEV) Object.assign(window, { __mapRoom: controller });
}

void start();
