import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../tests/fixtures/build';
import { applyAction } from './reducer';
import { seedRng } from './rng';

describe('city capture', () => {
  const state = makeState({
    cities: [
      {
        name: 'Keep',
        owner: 'blue',
        x: 3,
        y: 2,
        size: 4,
        walls: true,
        shieldsPerTurn: 5,
        queue: ['infantry'],
        repeat: true,
      },
    ],
    units: [
      { type: 'infantry', owner: 'red', x: 2, y: 2 },
      { type: 'artillery', owner: 'red', x: 2, y: 3 },
    ],
  });

  it('happens when a unit that can capture cities moves into an empty enemy city', () => {
    const r = applyAction(state, { type: 'move', unitId: unitOf(state, 'infantry').id, to: { x: 3, y: 2 } });
    if (!r.ok) throw new Error(r.reason);
    const city = Object.values(r.state.cities)[0]!;
    expect(city).toMatchObject({ owner: 'red', size: 3, walls: true, queue: [], repeat: false });
    expect(r.events).toContainEqual({ type: 'cityCaptured', cityId: city.id, newOwner: 'red' });
  });

  it('loses the shields stored toward the old owner’s queue', () => {
    const saving = structuredClone(state);
    Object.values(saving.cities)[0]!.shieldsStored = 40;
    const r = applyAction(saving, {
      type: 'move',
      unitId: unitOf(saving, 'infantry').id,
      to: { x: 3, y: 2 },
    });
    if (!r.ok) throw new Error(r.reason);
    expect(Object.values(r.state.cities)[0]!.shieldsStored).toBe(0);
  });

  it('happens when an attacker destroys the last defender and advances in', () => {
    const held = makeState({
      cities: [{ name: 'Keep', owner: 'blue', x: 3, y: 2, size: 4, walls: true, shieldsPerTurn: 5 }],
      units: [
        { type: 'armour', owner: 'red', x: 2, y: 2, veteran: 'elite' },
        { type: 'infantry', owner: 'blue', x: 3, y: 2, veteran: 'conscript', hp: 1 },
      ],
    });
    // An elite tank against a 1 HP conscript: try seeds until the attack wins.
    for (let seed = 1; seed < 20; seed++) {
      const s = structuredClone(held);
      s.rng = seedRng(seed);
      const r = applyAction(s, { type: 'attack', unitId: unitOf(s, 'armour').id, target: { x: 3, y: 2 } });
      if (!r.ok) throw new Error(r.reason);
      if (!r.state.units[unitOf(s, 'armour').id]) continue;
      expect(Object.values(r.state.cities)[0]).toMatchObject({ owner: 'red', size: 3, walls: true });
      return;
    }
    throw new Error('the tank never won');
  });

  it('never shrinks a city below size 1', () => {
    const tiny = structuredClone(state);
    Object.values(tiny.cities)[0]!.size = 1;
    const r = applyAction(tiny, { type: 'move', unitId: unitOf(tiny, 'infantry').id, to: { x: 3, y: 2 } });
    if (!r.ok) throw new Error(r.reason);
    expect(Object.values(r.state.cities)[0]!.size).toBe(1);
  });

  it('is refused to units without canCaptureCities', () => {
    const r = applyAction(state, { type: 'move', unitId: unitOf(state, 'artillery').id, to: { x: 3, y: 2 } });
    expect(r).toMatchObject({ ok: false, reason: expect.stringMatching(/cannot capture cities/) });
  });
});
