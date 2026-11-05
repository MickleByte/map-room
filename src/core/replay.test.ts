import { describe, expect, it } from 'vitest';
import { decide } from '../ai/decide';
import sandbox from '../data/scenarios/sandbox.json';
import { applyAction } from './reducer';
import { firstDifference, replay } from './replay';
import { loadScenario } from './scenario';
import type { Action, GameState } from './types';

/** Let the AI play both sides of the sandbox for a few turns, logging every action. */
function playSandbox(turns: number): { initial: GameState; actions: Action[]; state: GameState } {
  const initial = loadScenario(sandbox);
  let state = initial;
  const actions: Action[] = [];
  for (let t = 0; t < turns && !state.winner; t++) {
    for (const action of decide(state, state.players[state.currentPlayer]!.id)) {
      const result = applyAction(state, action);
      if (!result.ok) throw new Error(result.reason);
      actions.push(action);
      state = result.state;
    }
  }
  return { initial, actions, state };
}

describe('replay', { timeout: 30_000 }, () => {
  it('replaying the action log from the initial state gives exactly the same state', () => {
    const game = playSandbox(6);
    expect(game.actions.length).toBeGreaterThan(20);

    const result = replay(game.initial, game.actions);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state).toEqual(game.state);
    expect(firstDifference(result.state, game.state)).toBeNull();
  });

  it('reports which action the rules refused', () => {
    const initial = loadScenario(sandbox);
    const actions: Action[] = [{ type: 'endTurn' }, { type: 'fortify', unitId: 9999 }];

    expect(replay(initial, actions)).toEqual({ ok: false, index: 1, reason: 'No unit with id 9999' });
  });
});

describe('firstDifference', () => {
  it('names the path of the first value that differs', () => {
    const a = { units: { 3: { hp: 10, pos: { x: 1, y: 2 } } }, list: [1, 2, 3] };

    expect(firstDifference(a, structuredClone(a))).toBeNull();
    expect(firstDifference(a, { ...a, units: { 3: { hp: 9, pos: { x: 1, y: 2 } } } })).toBe('units.3.hp');
    expect(firstDifference(a, { ...a, list: [1, 2] })).toBe('list.length');
    expect(firstDifference(a, { ...a, units: {} })).toBe('units.3');
    expect(firstDifference(a, { ...a, extra: true })).toBe('extra');
  });

  it('ignores key order, and treats a missing key as undefined', () => {
    expect(firstDifference({ x: 1, y: 2 }, { y: 2, x: 1 })).toBeNull();
    expect(firstDifference({ x: 1, y: undefined }, { x: 1 })).toBeNull();
  });
});
