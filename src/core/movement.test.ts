import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../tests/fixtures/build';
import { cannotEnter, findPath, stepCost } from './movement';

describe('stepCost', () => {
  const state = makeState({
    terrain: ['ghmgg', 'ggggg', 'ggggg'],
    roads: [
      [0, 1],
      [1, 1],
      [3, 2],
    ],
    rails: [
      [2, 1],
      [3, 1],
    ],
    cities: [{ name: 'Town', owner: 'red', x: 4, y: 2, size: 1, shieldsPerTurn: 1 }],
    units: [{ type: 'armour', owner: 'red', x: 0, y: 0 }],
  });
  const tank = unitOf(state, 'armour');

  it('uses the terrain cost in thirds', () => {
    expect(stepCost(state, tank, { x: 0, y: 0 }, { x: 0, y: 1 })).toBe(3);
    expect(stepCost(state, tank, { x: 0, y: 0 }, { x: 1, y: 0 })).toBe(6);
    expect(stepCost(state, tank, { x: 1, y: 0 }, { x: 2, y: 0 })).toBe(9);
  });

  it('costs 1/3 along a road and nothing along a rail', () => {
    expect(stepCost(state, tank, { x: 0, y: 1 }, { x: 1, y: 1 })).toBe(1);
    expect(stepCost(state, tank, { x: 2, y: 1 }, { x: 3, y: 1 })).toBe(0);
  });

  it('needs the feature at both ends', () => {
    expect(stepCost(state, tank, { x: 1, y: 1 }, { x: 2, y: 1 })).toBe(1); // rail implies road
    expect(stepCost(state, tank, { x: 1, y: 1 }, { x: 1, y: 2 })).toBe(3);
  });

  it('treats a city as having a road', () => {
    expect(stepCost(state, tank, { x: 3, y: 2 }, { x: 4, y: 2 })).toBe(1);
  });
});

describe('cannotEnter', () => {
  const state = makeState({
    terrain: ['ggcoo', 'gggco', 'ggggc'],
    cities: [
      { name: 'Port', owner: 'red', x: 2, y: 1, size: 1, shieldsPerTurn: 1 },
      { name: 'Enemy', owner: 'blue', x: 0, y: 2, size: 1, shieldsPerTurn: 1 },
    ],
    units: [
      { type: 'infantry', owner: 'red', x: 0, y: 0 },
      { type: 'artillery', owner: 'red', x: 1, y: 0 },
      { type: 'destroyer', owner: 'red', x: 3, y: 0 },
      { type: 'fighter', owner: 'red', x: 2, y: 1 },
      { type: 'infantry', owner: 'blue', x: 1, y: 1 },
    ],
  });
  const inf = unitOf(state, 'infantry', 'red');

  it('keeps land units on land and ships at sea or in friendly cities', () => {
    expect(cannotEnter(state, inf, { x: 2, y: 0 })).toMatch(/cannot enter the sea/);
    const ship = unitOf(state, 'destroyer');
    expect(cannotEnter(state, ship, { x: 4, y: 0 })).toBeNull();
    expect(cannotEnter(state, ship, { x: 2, y: 1 })).toBeNull();
    expect(cannotEnter(state, ship, { x: 1, y: 0 })).toMatch(/only enter the sea or a friendly city/);
  });

  it('blocks tiles with enemy units', () => {
    expect(cannotEnter(state, inf, { x: 1, y: 1 })).toMatch(/attack instead/);
  });

  it('only lets city-capturing units into enemy cities', () => {
    expect(cannotEnter(state, unitOf(state, 'artillery'), { x: 0, y: 2 })).toMatch(/cannot capture cities/);
  });

  it('never moves aircraft', () => {
    expect(cannotEnter(state, unitOf(state, 'fighter'), { x: 1, y: 2 })).toMatch(/missions or rebase/);
  });
});

describe('findPath', () => {
  it('splits a long route into turns by movement', () => {
    const state = makeState({ units: [{ type: 'armour', owner: 'red', x: 0, y: 6 }] });
    const path = findPath(state, unitOf(state, 'armour'), { x: 5, y: 6 })!;
    expect(path.map((s) => s.pos)).toEqual([1, 2, 3, 4, 5].map((x) => ({ x, y: 6 })));
    expect(path.map((s) => s.turn)).toEqual([0, 0, 0, 1, 1]);
  });

  it('lets a slow unit enter expensive terrain one tile per turn', () => {
    const state = makeState({
      terrain: ['gmmmg'],
      units: [{ type: 'infantry', owner: 'red', x: 0, y: 0 }],
    });
    const path = findPath(state, unitOf(state, 'infantry'), { x: 4, y: 0 })!;
    expect(path.map((s) => s.turn)).toEqual([0, 1, 2, 3]);
  });

  it('prefers a longer road over a shorter cross-country route', () => {
    // Infantry (1 MP): straight along row 4 takes 4 turns; the road detour via row 0 takes 2.
    const state = makeState({
      terrain: ['ggggg', 'ggggg', 'ggggg', 'ggggg', 'ggggg'],
      roads: [
        [0, 4],
        [0, 2],
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [4, 0],
        [4, 2],
        [4, 4],
      ],
      units: [{ type: 'infantry', owner: 'red', x: 0, y: 4 }],
    });
    const path = findPath(state, unitOf(state, 'infantry'), { x: 4, y: 4 })!;
    expect(path.at(-1)!.turn).toBeLessThan(3);
    expect(path.length).toBeGreaterThan(4);
  });

  it('crosses the wrap seam', () => {
    const state = makeState({ wrapX: true, units: [{ type: 'armour', owner: 'red', x: 0, y: 4 }] });
    expect(findPath(state, unitOf(state, 'armour'), { x: 11, y: 4 })).toEqual([
      { pos: { x: 11, y: 4 }, turn: 0 },
    ]);
  });

  it('routes around enemy units and fails when completely blocked', () => {
    const open = makeState({
      units: [
        { type: 'armour', owner: 'red', x: 0, y: 4 },
        { type: 'infantry', owner: 'blue', x: 1, y: 4 },
      ],
    });
    const path = findPath(open, unitOf(open, 'armour'), { x: 2, y: 4 })!;
    expect(path.some((s) => s.pos.x === 1 && s.pos.y === 4)).toBe(false);

    const blocked = makeState({
      terrain: ['ooooo', 'ooooo', 'oggoo', 'ooooo', 'ooooo'],
      units: [
        { type: 'armour', owner: 'red', x: 1, y: 2 },
        { type: 'infantry', owner: 'blue', x: 2, y: 2 },
      ],
    });
    expect(findPath(blocked, unitOf(blocked, 'armour'), { x: 3, y: 2 })).toBeNull();
  });

  it('starts next turn when the unit has no movement left', () => {
    const state = makeState({ units: [{ type: 'armour', owner: 'red', x: 0, y: 0 }] });
    const tank = { ...unitOf(state, 'armour'), movesLeft: 0 };
    expect(findPath(state, tank, { x: 1, y: 0 })).toEqual([{ pos: { x: 1, y: 0 }, turn: 1 }]);
  });

  it('puts a free rail step into the next turn when the unit is out of movement', () => {
    const state = makeState({
      rails: [
        [0, 0],
        [1, 0],
      ],
      units: [{ type: 'armour', owner: 'red', x: 0, y: 0 }],
    });
    const tank = { ...unitOf(state, 'armour'), movesLeft: 0 };
    expect(findPath(state, tank, { x: 1, y: 0 })![0]!.turn).toBe(1);
  });
});
