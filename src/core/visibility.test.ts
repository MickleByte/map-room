import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../tests/fixtures/build';
import { applyAction, applyActions } from './reducer';
import type { GameState } from './types';
import { fogViewer, Vision } from './visibility';

function ok(result: ReturnType<typeof applyAction>): GameState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe('sight', () => {
  it('lets a unit see the tiles next to it and no further', () => {
    const state = makeState({ units: [{ type: 'infantry', owner: 'red', x: 5, y: 6 }] });
    const vision = new Vision(state, 'red');
    expect(vision.at({ x: 5, y: 6 })).toBe('visible');
    expect(vision.at({ x: 5, y: 4 })).toBe('visible'); // N, one step
    expect(vision.at({ x: 6, y: 6 })).toBe('visible'); // E, one step
    expect(vision.at({ x: 5, y: 2 })).toBe('unseen'); // two steps north
    expect(vision.at({ x: 7, y: 6 })).toBe('unseen');
  });

  it.each([
    ['hills', 'h'],
    ['mountains', 'm'],
  ])('sees one tile further from %s', (_name, char) => {
    const terrain = Array.from({ length: 12 }, () => 'g'.repeat(12).split(''));
    terrain[6]![5] = char;
    const state = makeState({
      terrain: terrain.map((r) => r.join('')),
      units: [{ type: 'infantry', owner: 'red', x: 5, y: 6 }],
    });
    const vision = new Vision(state, 'red');
    expect(vision.at({ x: 5, y: 2 })).toBe('visible'); // two steps north
    expect(vision.at({ x: 7, y: 6 })).toBe('visible'); // two steps east
    expect(vision.at({ x: 5, y: 0 })).toBe('unseen'); // three steps north
  });

  it('uses the unit type’s sight', () => {
    const state = makeState({
      terrain: Array.from({ length: 12 }, () => 'o'.repeat(12)),
      units: [{ type: 'destroyer', owner: 'red', x: 5, y: 6 }],
    });
    const vision = new Vision(state, 'red');
    expect(vision.at({ x: 7, y: 6 })).toBe('visible');
    expect(vision.at({ x: 8, y: 6 })).toBe('unseen');
  });

  it('lets a city see 2 tiles', () => {
    const state = makeState({
      cities: [{ name: 'Town', owner: 'red', x: 5, y: 6, size: 1, shieldsPerTurn: 1 }],
    });
    const vision = new Vision(state, 'red');
    expect(vision.at({ x: 7, y: 6 })).toBe('visible');
    expect(vision.at({ x: 5, y: 2 })).toBe('visible');
    expect(vision.at({ x: 8, y: 6 })).toBe('unseen');
  });

  it('does not share sight with other players', () => {
    const state = makeState({
      units: [
        { type: 'infantry', owner: 'red', x: 2, y: 2 },
        { type: 'infantry', owner: 'blue', x: 9, y: 9 },
      ],
      cities: [{ name: 'Blue Town', owner: 'blue', x: 9, y: 2, size: 1, shieldsPerTurn: 1 }],
    });
    const vision = new Vision(state, 'red');
    expect(vision.at({ x: 9, y: 9 })).toBe('unseen');
    expect(vision.at({ x: 9, y: 2 })).toBe('unseen');
  });

  it('sees across the wrap', () => {
    const state = makeState({ wrapX: true, units: [{ type: 'infantry', owner: 'red', x: 0, y: 6 }] });
    expect(new Vision(state, 'red').at({ x: 11, y: 6 })).toBe('visible');
  });
});

describe('whose fog', () => {
  const state = makeState({
    units: [
      { type: 'infantry', owner: 'red', x: 2, y: 2 },
      { type: 'infantry', owner: 'blue', x: 9, y: 9 },
    ],
  });

  it('is the human player’s', () => {
    expect(fogViewer(state)).toBe('red');
  });

  it('is nobody’s when no one is human, so everything is visible', () => {
    const aiOnly = produce(state, (s) => {
      for (const p of s.players) p.control = 'ai';
    });
    expect(fogViewer(aiOnly)).toBeNull();
    const vision = new Vision(aiOnly, null);
    expect(vision.at({ x: 9, y: 9 })).toBe('visible');
    expect(vision.unitsAt({ x: 9, y: 9 })).toHaveLength(1);
  });
});

describe('memory', () => {
  it('remembers tiles a unit could see once it moves away', () => {
    const start = makeState({ units: [{ type: 'infantry', owner: 'red', x: 5, y: 6 }] });
    const inf = unitOf(start, 'infantry');
    // Two turns of walking east, one tile a turn.
    const state = ok(
      applyActions(start, [
        { type: 'move', unitId: inf.id, to: { x: 6, y: 6 } },
        { type: 'endTurn' },
        { type: 'endTurn' },
        { type: 'move', unitId: inf.id, to: { x: 7, y: 6 } },
      ]),
    );
    const vision = new Vision(state, 'red');
    expect(vision.at({ x: 4, y: 6 })).toBe('remembered'); // seen from the start tile only
    expect(vision.at({ x: 5, y: 6 })).toBe('remembered');
    expect(vision.at({ x: 6, y: 6 })).toBe('visible');
    expect(vision.at({ x: 8, y: 6 })).toBe('visible');
    expect(vision.at({ x: 3, y: 6 })).toBe('unseen');
  });

  it('remembers tiles passed on the way along a go-to order', () => {
    const start = makeState({ units: [{ type: 'armour', owner: 'red', x: 2, y: 6 }] });
    const tank = unitOf(start, 'armour');
    const state = ok(
      applyAction(start, {
        type: 'setOrders',
        unitId: tank.id,
        orders: { kind: 'goto', target: { x: 5, y: 6 } },
      }),
    );
    expect(unitOf(state, 'armour').pos).toEqual({ x: 5, y: 6 });
    const vision = new Vision(state, 'red');
    // The tank drove east through (3, 6) and (4, 6). The tile north of its first step
    // is out of sight now but was seen on the way.
    expect(vision.at({ x: 3, y: 4 })).toBe('remembered');
    expect(vision.at({ x: 1, y: 6 })).toBe('remembered');
  });
});

describe('what a player is shown', () => {
  // Red's infantry starts next to a blue city held by a blue tank, then walks away.
  const start = makeState({
    units: [
      { type: 'infantry', owner: 'red', x: 5, y: 6 },
      { type: 'armour', owner: 'blue', x: 4, y: 6 },
      { type: 'infantry', owner: 'blue', x: 9, y: 9 },
    ],
    cities: [
      { name: 'Bluehaven', owner: 'blue', x: 4, y: 6, size: 3, shieldsPerTurn: 1 },
      { name: 'Farport', owner: 'blue', x: 10, y: 2, size: 5, shieldsPerTurn: 1 },
    ],
  });
  const inf = unitOf(start, 'infantry', 'red');
  const walked = ok(
    applyActions(start, [
      { type: 'move', unitId: inf.id, to: { x: 6, y: 6 } },
      { type: 'endTurn' },
      { type: 'endTurn' },
      { type: 'move', unitId: inf.id, to: { x: 7, y: 6 } },
    ]),
  );
  // Meanwhile, out of red's sight, the city grows and gets walls.
  const later = produce(walked, (s) => {
    const city = Object.values(s.cities).find((c) => c.name === 'Bluehaven')!;
    city.size = 4;
    city.walls = true;
  });

  it('shows units only on visible tiles', () => {
    const before = new Vision(start, 'red');
    expect(before.unitsAt({ x: 4, y: 6 }).map((u) => u.type)).toEqual(['armour']);
    const after = new Vision(later, 'red');
    expect(after.at({ x: 4, y: 6 })).toBe('remembered');
    expect(after.unitsAt({ x: 4, y: 6 })).toEqual([]);
    expect(after.unitsAt({ x: 9, y: 9 })).toEqual([]);
    expect(after.unitsAt({ x: 7, y: 6 }).map((u) => u.owner)).toEqual(['red']);
  });

  it('shows a remembered city as it was last seen', () => {
    const city = new Vision(later, 'red').cityAt({ x: 4, y: 6 });
    expect(city).toMatchObject({ name: 'Bluehaven', owner: 'blue', size: 3, walls: false });
  });

  it('shows a visible city as it is now', () => {
    const city = new Vision(later, 'blue').cityAt({ x: 4, y: 6 });
    expect(city).toMatchObject({ size: 4, walls: true });
  });

  it('hides cities on unseen tiles', () => {
    const vision = new Vision(later, 'red');
    expect(vision.cityAt({ x: 10, y: 2 })).toBeUndefined();
    expect(vision.cities().map((c) => c.name)).toEqual(['Bluehaven']);
  });
});
