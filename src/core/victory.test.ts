import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../tests/fixtures/build';
import { applyAction, applyActions } from './reducer';
import type { Action } from './types';

describe('victory by capturing every enemy city', () => {
  const state = makeState({
    victory: true,
    cities: [
      { name: 'Home', owner: 'red', x: 1, y: 1, size: 3, shieldsPerTurn: 10 },
      { name: 'Keep', owner: 'blue', x: 4, y: 2, size: 3, shieldsPerTurn: 10 },
      { name: 'Hold', owner: 'blue', x: 4, y: 6, size: 3, shieldsPerTurn: 10 },
    ],
    units: [
      { type: 'infantry', owner: 'red', x: 3, y: 2 },
      { type: 'armour', owner: 'red', x: 3, y: 6 },
    ],
  });
  const takeKeep: Action = { type: 'move', unitId: unitOf(state, 'infantry').id, to: { x: 4, y: 2 } };
  const takeHold: Action = { type: 'move', unitId: unitOf(state, 'armour').id, to: { x: 4, y: 6 } };

  it('is not won while the opponent still owns a city', () => {
    const r = applyAction(state, takeKeep);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.winner).toBeNull();
    expect(r.events.map((e) => e.type)).not.toContain('gameWon');
  });

  it('is won by the action that takes the opponent’s last city', () => {
    const r = applyActions(state, [takeKeep, takeHold]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.winner).toBe('red');
    expect(r.events.at(-1)).toEqual({ type: 'gameWon', winner: 'red' });
  });

  it('ends the game: no further action is accepted', () => {
    const r = applyActions(state, [takeKeep, takeHold, { type: 'endTurn' }]);
    expect(r).toEqual({ ok: false, reason: 'The game is over' });
  });

  it('only counts for players who have the victory condition', () => {
    const noGoal = structuredClone(state);
    noGoal.players[0]!.victoryConditions = [];
    const r = applyActions(noGoal, [takeKeep, takeHold]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.winner).toBeNull();
  });
});
