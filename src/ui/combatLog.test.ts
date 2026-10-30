import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../tests/fixtures/build';
import type { GameEvent } from '../core/types';
import { describeEvents } from './combatLog';

describe('describeEvents', () => {
  const before = makeState({
    cities: [{ name: 'Keep', owner: 'blue', x: 3, y: 2, size: 4, shieldsPerTurn: 1 }],
    units: [
      { type: 'armour', owner: 'red', x: 2, y: 2 },
      { type: 'infantry', owner: 'blue', x: 3, y: 2 },
      { type: 'artillery', owner: 'blue', x: 3, y: 2 },
    ],
  });
  const tank = unitOf(before, 'armour').id;
  const inf = unitOf(before, 'infantry').id;
  const gun = unitOf(before, 'artillery').id;
  const defence = {
    base: 10,
    items: [{ label: 'Fortified', bonus: 0.25 }],
    multiplier: 1.25,
    strength: 12.5,
  };

  it('describes a won attack, its promotion, captures and the city taken', () => {
    const events: GameEvent[] = [
      {
        type: 'combat',
        attacker: tank,
        defender: inf,
        rounds: ['A', 'D', 'A', 'A'],
        winner: tank,
        attack: 24,
        defence,
      },
      { type: 'unitDestroyed', unitId: inf },
      { type: 'unitPromoted', unitId: tank, to: 'veteran' },
      { type: 'unitCaptured', unitId: gun, newOwner: 'red' },
      { type: 'unitMoved', unitId: tank, from: { x: 2, y: 2 }, to: { x: 3, y: 2 } },
      { type: 'cityCaptured', cityId: Object.values(before.cities)[0]!.id, newOwner: 'red' },
    ];
    expect(describeEvents(before, events)).toEqual([
      'Red Battle Tank (24) defeated Blue Line Infantry (12.5), winning 3 rounds to 1.',
      'Red Battle Tank was promoted to Veteran.',
      'Red captured Blue Field Battery.',
      'Red captured Keep.',
    ]);
  });

  it('describes a lost attack, and units lost outside combat', () => {
    const events: GameEvent[] = [
      {
        type: 'combat',
        attacker: tank,
        defender: inf,
        rounds: ['D', 'A', 'D', 'D'],
        winner: inf,
        attack: 24,
        defence,
      },
      { type: 'unitDestroyed', unitId: tank },
      { type: 'unitDestroyed', unitId: gun },
    ];
    expect(describeEvents(before, events)).toEqual([
      'Red Battle Tank (24) was destroyed attacking Blue Line Infantry (12.5), winning 1 round to 3.',
      'Blue Field Battery was destroyed.',
    ]);
  });
});
