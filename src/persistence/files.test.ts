import { describe, expect, it, vi } from 'vitest';
import { decide } from '../ai/decide';
import { applyAction } from '../core/reducer';
import type { GameState } from '../core/types';
import sandbox from '../data/scenarios/sandbox.json';
import {
  createSave,
  ImportError,
  newGame,
  parseImport,
  saveToJson,
  scenarioToJson,
  type Game,
} from './files';

const played = new Map<number, Game>();

/** A sandbox game the AI has played for a few turns on both sides (made once per length). */
function playedGame(turns = 4): Game {
  const known = played.get(turns);
  if (known) return known;
  const game = newGame(sandbox);
  played.set(turns, game);
  for (let t = 0; t < turns && !game.state.winner; t++) {
    for (const action of decide(game.state, game.state.players[game.state.currentPlayer]!.id)) {
      const result = applyAction(game.state, action);
      if (!result.ok) throw new Error(result.reason);
      game.actions.push(action);
      game.state = result.state;
    }
  }
  return game;
}

const SAVED_AT = '2026-10-30T12:00:00.000Z';

describe('save files', { timeout: 30_000 }, () => {
  it('a save exported to JSON imports as the same game, its log replaying to its snapshot', () => {
    const game = playedGame();
    const save = createSave(game, 'Before the push', SAVED_AT);

    const imported = parseImport(saveToJson(save));

    expect(imported.kind).toBe('save');
    if (imported.kind !== 'save') return;
    expect(imported.save.name).toBe('Before the push');
    expect(imported.save.savedAt).toBe(SAVED_AT);
    expect(imported.save.schemaVersion).toBe(1);
    expect(imported.save.scenario.name).toBe(sandbox.name);
    expect(imported.save.actions).toEqual(game.actions);
    expect(imported.save.initialState).toEqual(game.initialState);
    expect(imported.save.state).toEqual(game.state);
  });

  it('a save is stamped with the time it was made', () => {
    vi.useFakeTimers({ now: new Date(SAVED_AT) });
    try {
      expect(createSave(newGame(sandbox), 'Now').savedAt).toBe(SAVED_AT);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a new game starts with an empty log from the scenario’s initial state', () => {
    const game = newGame(sandbox);

    expect(game.actions).toEqual([]);
    expect(game.state).toBe(game.initialState);
    expect(game.scenario.id).toBe(sandbox.id);
  });
});

describe('importing an invalid file', { timeout: 30_000 }, () => {
  const json = (value: unknown) => JSON.stringify(value);
  const errorOf = (text: string): ImportError => {
    try {
      parseImport(text);
    } catch (e) {
      if (e instanceof ImportError) return e;
      throw e;
    }
    throw new Error('the import was accepted');
  };
  const savedJson = () =>
    JSON.parse(saveToJson(createSave(playedGame(2), 'Test', SAVED_AT))) as {
      state: GameState;
      initialState: GameState;
      actions: unknown[];
      schemaVersion: number;
    };

  it('rejects text that is not JSON', () => {
    expect(errorOf('{ not json').message).toMatch(/^This file is not valid JSON/);
  });

  it('rejects a save whose snapshot does not match a replay of its log', () => {
    const save = savedJson();
    const unit = Object.values(save.state.units)[0]!;
    unit.hp -= 1;

    const error = errorOf(json(save));

    expect(error.message).toContain('Invalid save');
    expect(error.issues).toEqual([
      `the action log does not replay to the saved state (first difference at state.units.${unit.id}.hp)`,
    ]);
  });

  it('rejects a save whose log has an action the rules refuse', () => {
    const save = savedJson();
    save.actions.splice(1, 0, { type: 'fortify', unitId: 9999 });

    expect(errorOf(json(save)).issues).toEqual(['actions[1] (fortify) was refused: No unit with id 9999']);
  });

  it('lists every malformed field with its path', () => {
    const save = savedJson();
    const unit = Object.values(save.state.units)[0]!;
    (unit as { hp: unknown }).hp = 'lots';
    save.actions[0] = { type: 'teleport' };
    delete (save as { name?: string }).name;

    const issues = errorOf(json(save)).issues;

    expect(issues).toContain(`state.units.${unit.id}.hp: Invalid input: expected number, received string`);
    expect(issues.some((i) => i.startsWith('actions.0'))).toBe(true);
    expect(issues.some((i) => i.startsWith('name:'))).toBe(true);
  });

  it('rejects a save from another schema version with a clear reason', () => {
    const save = savedJson();
    save.schemaVersion = 2;

    expect(errorOf(json(save)).issues).toEqual([
      'this save uses schema version 2, but this version of Map Room reads version 1',
    ]);
  });

  it('rejects an invalid scenario, listing the scenario’s problems', () => {
    const broken = { ...sandbox, players: [sandbox.players[0]] };

    const error = errorOf(json(broken));

    expect(error.message).toContain('Invalid scenario');
    expect(error.issues).toEqual(['players: Too small: expected array to have >=2 items']);
  });
});

describe('scenario files', { timeout: 30_000 }, () => {
  it('a scenario imports as a new game', () => {
    const imported = parseImport(JSON.stringify(sandbox));

    expect(imported.kind).toBe('scenario');
    if (imported.kind !== 'scenario') return;
    expect(imported.game.actions).toEqual([]);
    expect(imported.game.state).toEqual(newGame(sandbox).state);
  });

  it('a game’s scenario exports to a file that starts the same game again', () => {
    const game = playedGame(2);

    const imported = parseImport(scenarioToJson(game.scenario));

    expect(imported.kind).toBe('scenario');
    if (imported.kind !== 'scenario') return;
    expect(imported.game.scenario.name).toBe(sandbox.name);
    expect(imported.game.state).toEqual(game.initialState);
  });
});
