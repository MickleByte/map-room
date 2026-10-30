import { describe, expect, it } from 'vitest';
import { makeState } from '../../tests/fixtures/build';
import { applyActions } from './reducer';
import type { Action, GameState } from './types';

const endTurn: Action = { type: 'endTurn' };

function hpAfter(state: GameState, actions: Action[]): number[] {
  const r = applyActions(state, actions);
  if (!r.ok) throw new Error(r.reason);
  return Object.values(r.state.units).map((u) => u.hp);
}

describe('healing at the start of the owner’s turn', () => {
  const state = makeState({
    cities: [{ name: 'Home', owner: 'red', x: 6, y: 6, size: 3, shieldsPerTurn: 1 }],
    units: [
      { type: 'infantry', owner: 'red', x: 2, y: 2, hp: 1 },
      { type: 'infantry', owner: 'red', x: 6, y: 6, veteran: 'elite', hp: 1 },
      { type: 'armour', owner: 'red', x: 2, y: 8 },
    ],
  });
  const [field, garrison] = Object.values(state.units).map((u) => u.id);

  it('heals 1 HP in the field, fully in a friendly city, and never above the maximum', () => {
    expect(hpAfter(state, [endTurn, endTurn])).toEqual([2, 5, 3]);
  });

  it('skips units that acted during their last turn', () => {
    const moves: Action[] = [
      { type: 'move', unitId: field!, to: { x: 3, y: 2 } },
      { type: 'move', unitId: garrison!, to: { x: 7, y: 6 } },
    ];
    expect(hpAfter(state, [...moves, endTurn, endTurn])).toEqual([1, 1, 3]);
  });

  it('heals a fortified unit, since fortifying is not acting', () => {
    expect(hpAfter(state, [{ type: 'fortify', unitId: field! }, endTurn, endTurn])[0]).toBe(2);
  });

  it("does not heal on the other player's turn", () => {
    expect(hpAfter(state, [endTurn])).toEqual([1, 1, 3]);
  });
});
