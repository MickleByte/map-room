/** Air queries for the UI and AI: mission reach, bomb previews, bases and drop zones. */
import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../../tests/fixtures/build';
import { applyAction } from '../reducer';
import type { GameState } from '../types';
import { missionRange, paradropRange, previewMission, rebaseTargets } from './air';

const done = (state: GameState, r: ReturnType<typeof applyAction>) => {
  if (!r.ok) throw new Error(r.reason);
  return r.state;
};

describe('mission range', () => {
  const state = makeState({
    width: 20,
    height: 3,
    cities: [{ name: 'Field', owner: 'red', x: 9, y: 1, size: 3, shieldsPerTurn: 1 }],
    units: [
      { type: 'fighter', owner: 'red', x: 9, y: 1 },
      { type: 'infantry', owner: 'red', x: 9, y: 1 },
    ],
  });
  const fighter = unitOf(state, 'fighter');

  it('is every tile within operational range but the base', () => {
    const tiles = missionRange(state, fighter);
    expect(tiles).toContainEqual({ x: 15, y: 1 });
    expect(tiles).not.toContainEqual({ x: 16, y: 1 });
    expect(tiles).not.toContainEqual({ x: 9, y: 1 });
  });

  it('is empty once the aircraft has flown, and for ground units', () => {
    const flown = done(state, applyAction(state, { type: 'airSuperiority', unitId: fighter.id }));
    expect(missionRange(flown, flown.units[fighter.id]!)).toEqual([]);
    expect(missionRange(state, unitOf(state, 'infantry'))).toEqual([]);
  });
});

describe('bombing preview', () => {
  const state = makeState({
    cities: [{ name: 'Field', owner: 'red', x: 1, y: 1, size: 3, shieldsPerTurn: 1 }],
    units: [
      { type: 'bomber', owner: 'red', x: 1, y: 1 },
      { type: 'infantry', owner: 'blue', x: 4, y: 1, fortified: true },
    ],
  });

  it('shows the shots, the chance of each and the target’s defence', () => {
    const p = previewMission(state, unitOf(state, 'bomber'), { x: 4, y: 1 });
    if (typeof p === 'string') throw new Error(p);
    expect(p).toMatchObject({ strength: 16, shots: 3, lethal: false });
    expect(p.target.type).toBe('infantry');
    expect(p.defence.strength).toBe(12.5);
    expect(p.hitChance).toBeCloseTo(16 / 28.5);
  });

  it('gives the reason when the mission is not allowed', () => {
    expect(previewMission(state, unitOf(state, 'bomber'), { x: 5, y: 1 })).toMatch(/no enemy/);
  });
});

describe('rebase targets', () => {
  it('lists friendly cities and carriers with room within range', () => {
    const state = makeState({
      terrain: ['ggggggcccccc'],
      cities: [
        { name: 'Home', owner: 'red', x: 0, y: 0, size: 3, shieldsPerTurn: 1 },
        { name: 'Near', owner: 'red', x: 5, y: 0, size: 3, shieldsPerTurn: 1 },
        { name: 'Theirs', owner: 'blue', x: 3, y: 0, size: 3, shieldsPerTurn: 1 },
      ],
      units: [
        { type: 'fighter', owner: 'red', x: 0, y: 0 },
        { type: 'carrier', owner: 'red', x: 6, y: 0 },
        { type: 'carrier', owner: 'red', x: 7, y: 0 },
      ],
    });
    const [carrier] = Object.values(state.units).filter((u) => u.type === 'carrier');
    const near = Object.values(state.cities).find((c) => c.name === 'Near')!;
    expect(rebaseTargets(state, unitOf(state, 'fighter'))).toEqual([
      { kind: 'city', id: near.id },
      { kind: 'carrier', id: carrier!.id },
    ]);
  });
});

describe('drop zone', () => {
  const state = makeState({
    terrain: ['ggggggggggggg', 'gggggocgggggg', 'ggggggggggggg'],
    cities: [{ name: 'Drop', owner: 'red', x: 6, y: 0, size: 3, shieldsPerTurn: 1 }],
    units: [
      { type: 'paratrooper', owner: 'red', x: 6, y: 0 },
      { type: 'infantry', owner: 'blue', x: 8, y: 0 },
    ],
  });
  const para = unitOf(state, 'paratrooper');

  it('is the land tiles within reach with no enemies, the city itself excluded', () => {
    const tiles = paradropRange(state, para);
    expect(tiles).toContainEqual({ x: 12, y: 0 });
    expect(tiles).toContainEqual({ x: 7, y: 0 });
    expect(tiles).not.toContainEqual({ x: 6, y: 0 });
    expect(tiles).not.toContainEqual({ x: 8, y: 0 });
    expect(tiles).not.toContainEqual({ x: 5, y: 1 });
  });

  it('is empty when the unit has moved', () => {
    const moved = done(state, applyAction(state, { type: 'move', unitId: para.id, to: { x: 5, y: 0 } }));
    expect(paradropRange(moved, moved.units[para.id]!)).toEqual([]);
  });
});
