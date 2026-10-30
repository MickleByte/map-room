import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../tests/fixtures/build';
import { applyActions } from '../core/reducer';
import type { GameEvent } from '../core/types';
import { describeBuilt, describeEvents } from './combatLog';

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

  it('describes a bombard: hits, misses and the damage done', () => {
    const shot = { type: 'bombarded', unitId: gun, target: tank, strength: 12, defence } as const;
    expect(
      describeEvents(before, [
        { ...shot, hits: 1, misses: 1, damage: 1 },
        { ...shot, hits: 3, misses: 0, damage: 2 },
        { ...shot, hits: 2, misses: 0, damage: 0 },
      ]),
    ).toEqual([
      'Blue Field Battery (12) bombarded Red Battle Tank (12.5): 1 hit, 1 miss, 1 HP lost.',
      'Blue Field Battery (12) bombarded Red Battle Tank (12.5): 3 hits, 0 misses, 2 HP lost.',
      'Blue Field Battery (12) bombarded Red Battle Tank (12.5): 2 hits, 0 misses, no damage.',
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

  it('describes interceptions either way', () => {
    const air = makeState({
      cities: [
        { name: 'Red', owner: 'red', x: 1, y: 1, size: 3, shieldsPerTurn: 1 },
        { name: 'Blue', owner: 'blue', x: 5, y: 1, size: 3, shieldsPerTurn: 1 },
      ],
      units: [
        { type: 'fighter', owner: 'red', x: 1, y: 1 },
        { type: 'bomber', owner: 'blue', x: 5, y: 1 },
      ],
    });
    const fighter = unitOf(air, 'fighter').id;
    const bomber = unitOf(air, 'bomber').id;
    const meet = { type: 'intercepted', fighter, bomber } as const;
    expect(
      describeEvents(air, [
        { ...meet, rounds: ['A', 'D', 'A', 'A'], winner: fighter },
        { type: 'unitDestroyed', unitId: bomber },
      ]),
    ).toEqual(['Red Interceptor intercepted and shot down Blue Strategic Bomber, winning 3 rounds to 1.']);
    expect(
      describeEvents(air, [
        { ...meet, rounds: ['D', 'D'], winner: bomber },
        { type: 'unitDestroyed', unitId: fighter },
      ]),
    ).toEqual([
      'Red Interceptor intercepted Blue Strategic Bomber and was shot down, winning 0 rounds to 2.',
    ]);
  });

  it('announces the winner', () => {
    expect(describeEvents(before, [{ type: 'gameWon', winner: 'red' }])).toEqual([
      'Red has taken every enemy city and won the game.',
    ]);
  });

  it('says which units went down with a sunk ship', () => {
    const sea = makeState({
      terrain: ['ccoo'],
      units: [{ type: 'transport', owner: 'blue', x: 2, y: 0, cargo: [{ type: 'armour' }] }],
    });
    const ship = unitOf(sea, 'transport').id;
    const cargo = unitOf(sea, 'armour').id;
    const events: GameEvent[] = [
      { type: 'unitDestroyed', unitId: cargo },
      { type: 'unitDestroyed', unitId: ship },
    ];
    expect(describeEvents(sea, events)).toEqual([
      'Blue Battle Tank went down with Blue Troopship.',
      'Blue Troopship was destroyed.',
    ]);
  });
});

describe('describeBuilt', () => {
  const state = makeState({
    cities: [
      { name: 'Home', owner: 'red', x: 1, y: 1, size: 3, shieldsPerTurn: 100, queue: ['infantry'] },
      { name: 'Away', owner: 'blue', x: 5, y: 1, size: 3, shieldsPerTurn: 140, queue: ['armour'] },
    ],
  });
  // Blue's turn starts (Away builds), then Red's (Home builds).
  const r = applyActions(state, [{ type: 'endTurn' }, { type: 'endTurn' }]);
  if (!r.ok) throw new Error(r.reason);

  it("lists the units finished in the viewer's own cities only", () => {
    expect(describeBuilt(r.state, r.events, 'red')).toEqual(['Home built Line Infantry.']);
  });

  it('lists every city when there is no fog', () => {
    expect(describeBuilt(r.state, r.events, null)).toEqual([
      'Away built Battle Tank.',
      'Home built Line Infantry.',
    ]);
  });
});
