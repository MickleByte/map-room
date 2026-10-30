/** What the animator shows of an action: only what the viewer can see. */
import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../tests/fixtures/build';
import { coordsEqual } from '../core/grid';
import { applyAction } from '../core/reducer';
import type { Action, Coord, GameState } from '../core/types';
import { effectsOf } from './effects';

function run(state: GameState, action: Action) {
  const result = applyAction(state, action);
  if (!result.ok) throw new Error(result.reason);
  return result.events;
}

const only = (tiles: Coord[]) => (c: Coord) => tiles.some((t) => coordsEqual(t, c));
const everywhere = () => true;

describe('effectsOf', () => {
  const state = makeState({
    units: [
      { type: 'armour', owner: 'red', x: 2, y: 2 },
      { type: 'artillery', owner: 'red', x: 1, y: 2 },
      { type: 'infantry', owner: 'blue', x: 3, y: 2, hp: 1 },
    ],
  });
  const tank = unitOf(state, 'armour');
  const gun = unitOf(state, 'artillery');

  it('shows a move as a trail from tile to tile in the mover’s colour', () => {
    const events = run(state, { type: 'move', unitId: tank.id, to: { x: 2, y: 4 } });
    expect(effectsOf(state, events, everywhere)).toEqual([
      { kind: 'move', from: { x: 2, y: 2 }, to: { x: 2, y: 4 }, colour: '#cc3333' },
    ]);
  });

  it('leaves out a move the viewer cannot see at either end', () => {
    const events = run(state, { type: 'move', unitId: tank.id, to: { x: 2, y: 4 } });
    expect(effectsOf(state, events, only([{ x: 9, y: 9 }]))).toEqual([]);
    expect(effectsOf(state, events, only([{ x: 2, y: 4 }]))).toHaveLength(1);
  });

  it('shows a fight as a strike from the attacker to the defender', () => {
    const events = run(state, { type: 'attack', unitId: tank.id, target: { x: 3, y: 2 } });
    expect(effectsOf(state, events, everywhere)[0]).toEqual({
      kind: 'strike',
      from: { x: 2, y: 2 },
      to: { x: 3, y: 2 },
      colour: '#cc3333',
    });
  });

  it('shows a bombard as a strike, and a destroyed unit as a blast where it stood', () => {
    const events = run(state, { type: 'bombard', unitId: gun.id, target: { x: 3, y: 2 } });
    expect(effectsOf(state, events, everywhere)).toContainEqual({
      kind: 'strike',
      from: { x: 1, y: 2 },
      to: { x: 3, y: 2 },
      colour: '#cc3333',
    });
    const fight = run(state, { type: 'attack', unitId: tank.id, target: { x: 3, y: 2 } });
    const lost = fight.find((e) => e.type === 'unitDestroyed');
    if (lost?.type !== 'unitDestroyed') throw new Error('expected a unit to be destroyed');
    const where = state.units[lost.unitId]!.pos;
    expect(effectsOf(state, fight, everywhere)).toContainEqual({ kind: 'blast', at: where });
  });
});
