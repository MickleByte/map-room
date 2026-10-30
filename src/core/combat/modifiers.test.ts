import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../../tests/fixtures/build';
import { defenceOf } from './modifiers';

/** Row 0 even, row 1 odd: (2,2)'s south-east neighbour is (2,3); its north-west is (1,1). */
describe('defenceOf', () => {
  const inf = (x: number, y: number, extra: object = {}) => ({
    type: 'infantry',
    owner: 'blue',
    x,
    y,
    ...extra,
  });

  it('is the base defence on open ground', () => {
    const s = makeState({ units: [inf(2, 2)] });
    expect(defenceOf(s, unitOf(s, 'infantry'), { x: 2, y: 3 })).toEqual({
      base: 10,
      items: [],
      multiplier: 1,
      strength: 10,
    });
  });

  it('adds the terrain bonus', () => {
    const s = makeState({ terrain: ['ggggg', 'ggggg', 'gghgg', 'ggggg'], units: [inf(2, 2)] });
    const d = defenceOf(s, unitOf(s, 'infantry'), { x: 2, y: 3 });
    expect(d.items).toEqual([{ label: 'Hills', bonus: 0.5 }]);
    expect(d.strength).toBe(15);
  });

  it('adds the river bonus only when the attack crosses the river', () => {
    const s = makeState({ rivers: [{ x: 2, y: 2, side: 'SE' }], units: [inf(2, 2)] });
    const unit = unitOf(s, 'infantry');
    expect(defenceOf(s, unit, { x: 2, y: 3 }).items).toEqual([{ label: 'River', bonus: 0.25 }]);
    expect(defenceOf(s, unit, { x: 1, y: 1 }).items).toEqual([]);
  });

  it('adds the fortified bonus', () => {
    const s = makeState({ units: [inf(2, 2, { fortified: true })] });
    expect(defenceOf(s, unitOf(s, 'infantry'), { x: 2, y: 3 }).items).toEqual([
      { label: 'Fortified', bonus: 0.25 },
    ]);
  });

  it('counts a unit in a fortress as fortified, on top of the fortress bonus', () => {
    const s = makeState({ fortresses: [[2, 2]], units: [inf(2, 2)] });
    const d = defenceOf(s, unitOf(s, 'infantry'), { x: 2, y: 3 });
    expect(d.items).toEqual([
      { label: 'Fortified', bonus: 0.25 },
      { label: 'Fortress', bonus: 0.5 },
    ]);
    expect(d.strength).toBe(17.5);
  });

  describe('city size tiers', () => {
    const inCity = (size: number, walls: boolean) => {
      const s = makeState({
        cities: [{ name: 'Town', owner: 'blue', x: 2, y: 2, size, walls, shieldsPerTurn: 1 }],
        units: [inf(2, 2)],
      });
      return defenceOf(s, unitOf(s, 'infantry'), { x: 2, y: 3 }).items;
    };

    it('gives small cities nothing, or +100% with walls', () => {
      expect(inCity(6, false)).toEqual([]);
      expect(inCity(1, true)).toEqual([{ label: 'City walls', bonus: 1 }]);
      expect(inCity(6, true)).toEqual([{ label: 'City walls', bonus: 1 }]);
    });

    it('gives size 7–12 +50% and ignores walls', () => {
      expect(inCity(7, false)).toEqual([{ label: 'City size 7', bonus: 0.5 }]);
      expect(inCity(12, true)).toEqual([{ label: 'City size 12', bonus: 0.5 }]);
    });

    it('gives size 13+ +100% and ignores walls', () => {
      expect(inCity(13, true)).toEqual([{ label: 'City size 13', bonus: 1 }]);
    });
  });

  it('adds bonuses together, then multiplies once', () => {
    // Hills 50% + fortified 25% + river 25% = ×2.0 (not 1.5 × 1.25 × 1.25).
    const s = makeState({
      terrain: ['ggggg', 'ggggg', 'gghgg', 'ggggg'],
      rivers: [{ x: 2, y: 2, side: 'SE' }],
      units: [inf(2, 2, { fortified: true })],
    });
    const d = defenceOf(s, unitOf(s, 'infantry'), { x: 2, y: 3 });
    expect(d.multiplier).toBe(2);
    expect(d.strength).toBe(20);
  });
});
