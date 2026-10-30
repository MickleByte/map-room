/** Bombardment, through the reducer: who may bombard where, and what it does. */
import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../../tests/fixtures/build';
import { applyAction } from '../reducer';
import { seedRng } from '../rng';
import type { Action, ApplyResult, Coord, GameEvent, GameState } from '../types';
import { bombardRange, previewBombard } from './bombard';

/** Recorded from seed 7; changing how bombard draws from the RNG breaks saved games (ADR-0004). */
const SEED_7_SHOTS = { hits: 2, misses: 0 };

function reason(result: ApplyResult): string {
  if (result.ok) throw new Error('expected the action to be rejected');
  return result.reason;
}

function ok(result: ApplyResult) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

const bombard = (state: GameState, unitId: number, target: Coord) =>
  applyAction(state, { type: 'bombard', unitId, target } satisfies Action);

/** Results of the same action under many different RNG seeds. */
function outcomes(state: GameState, action: Action, seeds = 300) {
  return Array.from({ length: seeds }, (_, i) => ok(applyAction({ ...state, rng: seedRng(i + 1) }, action)));
}

function bombardedOf(events: GameEvent[]) {
  const e = events.find((x) => x.type === 'bombarded');
  if (!e || e.type !== 'bombarded') throw new Error('no bombarded event');
  return e;
}

describe('who may bombard where', () => {
  const state = makeState({
    cities: [{ name: 'Base', owner: 'red', x: 2, y: 3, size: 1, shieldsPerTurn: 1 }],
    units: [
      { type: 'artillery', owner: 'red', x: 2, y: 2 },
      { type: 'armour', owner: 'red', x: 2, y: 1 },
      { type: 'fighter', owner: 'red', x: 2, y: 3 },
      { type: 'infantry', owner: 'blue', x: 4, y: 2 },
      { type: 'infantry', owner: 'blue', x: 0, y: 2 },
    ],
  });
  const gun = unitOf(state, 'artillery');

  it('reaches as far as its bombard range, and no further', () => {
    expect(bombard(state, gun.id, { x: 4, y: 2 }).ok).toBe(true);
    expect(bombard(state, gun.id, { x: 0, y: 2 }).ok).toBe(true);
    const far = makeState({
      units: [
        { type: 'artillery', owner: 'red', x: 2, y: 2 },
        { type: 'infantry', owner: 'blue', x: 5, y: 2 },
      ],
    });
    expect(reason(bombard(far, unitOf(far, 'artillery').id, { x: 5, y: 2 }))).toMatch(/out of range/);
  });

  it('needs an enemy on the tile', () => {
    expect(reason(bombard(state, gun.id, { x: 3, y: 2 }))).toMatch(/no enemy/);
    expect(reason(bombard(state, gun.id, { x: 2, y: 1 }))).toMatch(/no enemy/);
  });

  it('hits across domains: land guns shell ships, ships shell the shore', () => {
    const s = makeState({
      terrain: ['gggcc', 'gggcc'],
      units: [
        { type: 'artillery', owner: 'red', x: 2, y: 0 },
        { type: 'destroyer', owner: 'blue', x: 3, y: 0 },
      ],
    });
    const r = ok(bombard(s, unitOf(s, 'artillery').id, { x: 3, y: 0 }));
    expect(bombardedOf(r.events).target).toBe(unitOf(s, 'destroyer').id);
  });

  it('is only for units with a bombard; aircraft bomb on missions instead', () => {
    expect(reason(bombard(state, unitOf(state, 'armour').id, { x: 4, y: 2 }))).toMatch(/cannot bombard/);
    expect(reason(bombard(state, unitOf(state, 'fighter').id, { x: 4, y: 2 }))).toMatch(/missions/);
  });

  it('needs movement left', () => {
    const spent = structuredClone(state);
    spent.units[gun.id]!.movesLeft = 0;
    expect(reason(bombard(spent, gun.id, { x: 4, y: 2 }))).toMatch(/no movement left/);
  });

  it('cannot bombard from aboard a ship', () => {
    const s = makeState({
      terrain: ['gggcc'],
      units: [
        { type: 'transport', owner: 'red', x: 3, y: 0, cargo: [{ type: 'artillery' }] },
        { type: 'infantry', owner: 'blue', x: 1, y: 0 },
      ],
    });
    expect(reason(bombard(s, unitOf(s, 'artillery').id, { x: 1, y: 0 }))).toMatch(/aboard a ship/);
  });

  it("rejects another player's units and tiles off the map", () => {
    expect(reason(bombard(state, unitOf(state, 'infantry', 'blue').id, { x: 2, y: 2 }))).toMatch(
      /another player/,
    );
    expect(reason(bombard(state, gun.id, { x: 2, y: -1 }))).toMatch(/off the map/);
  });
});

describe('bombard range across the wrap', () => {
  // On a 12-wide wrapping map, (10,4) is 2 tiles west of (0,4) the short way round.
  const opts = {
    units: [
      { type: 'artillery', owner: 'red', x: 0, y: 4 },
      { type: 'infantry', owner: 'blue', x: 10, y: 4 },
      { type: 'infantry', owner: 'blue', x: 9, y: 4 },
    ],
  };
  const wrapped = makeState({ ...opts, wrapX: true });
  const flat = makeState({ ...opts, wrapX: false });
  const gun = unitOf(wrapped, 'artillery');

  it('measures range the short way round a wrapping map', () => {
    expect(bombard(wrapped, gun.id, { x: 10, y: 4 }).ok).toBe(true);
    expect(bombard(wrapped, gun.id, { x: -2, y: 4 }).ok).toBe(true);
    expect(reason(bombard(wrapped, gun.id, { x: 9, y: 4 }))).toMatch(/out of range/);
  });

  it('does not wrap on a map that does not', () => {
    expect(reason(bombard(flat, gun.id, { x: 10, y: 4 }))).toMatch(/out of range/);
  });

  it('shows the range overlay across the seam', () => {
    const key = (c: Coord) => `${c.x},${c.y}`;
    const wrappedTiles = bombardRange(wrapped, gun).map(key);
    // Range 2 is a 5 × 5 block of tiles around the gun, its own tile excluded.
    expect(wrappedTiles).toHaveLength(24);
    expect(wrappedTiles).toEqual(
      expect.arrayContaining(['10,4', '11,4', '11,3', '0,3', '1,4', '0,0', '0,8']),
    );
    expect(wrappedTiles).not.toContain('0,4');
    const flatTiles = bombardRange(flat, unitOf(flat, 'artillery')).map(key);
    expect(flatTiles).toHaveLength(14);
    expect(flatTiles).not.toContain('10,4');
  });

  it('has no range for units that cannot bombard', () => {
    const s = makeState({ units: [{ type: 'armour', owner: 'red', x: 2, y: 4 }] });
    expect(bombardRange(s, unitOf(s, 'armour'))).toEqual([]);
  });
});

describe('previewBombard', () => {
  const state = makeState({
    terrain: ['ggggg', 'ggggg', 'gggfg', 'ggggg'],
    units: [
      { type: 'artillery', owner: 'red', x: 1, y: 2 },
      { type: 'infantry', owner: 'blue', x: 3, y: 2, fortified: true },
      { type: 'artillery', owner: 'blue', x: 3, y: 2 },
    ],
  });
  const gun = unitOf(state, 'artillery', 'red');

  it('names the target, its itemised defence and the chance of each hit, without rolling', () => {
    const p = previewBombard(state, gun, { x: 3, y: 2 });
    if (typeof p === 'string') throw new Error(p);
    // Forest 25% + fortified 25%: 10 × 1.5 = 15.
    expect(p.target).toBe(unitOf(state, 'infantry'));
    expect(p.defence).toMatchObject({ strength: 15, items: [{ label: 'Forest' }, { label: 'Fortified' }] });
    expect(p).toMatchObject({ strength: 12, shots: 2, lethal: false });
    expect(p.hitChance).toBeCloseTo(12 / 27, 12);
  });

  it('gives the reason when the bombard is not allowed', () => {
    expect(previewBombard(state, gun, { x: 2, y: 2 })).toMatch(/no enemy/);
  });
});

describe('bombarding', () => {
  // Field Battery: 12 strength, range 2, rate of fire 2. Two tiles east of (2,2) is (4,2).
  const T = { x: 4, y: 2 };
  const state = makeState({
    units: [
      { type: 'artillery', owner: 'red', x: 2, y: 2 },
      { type: 'infantry', owner: 'blue', x: 4, y: 2, fortified: true },
    ],
  });
  const gun = unitOf(state, 'artillery');
  const inf = unitOf(state, 'infantry');
  const fire: Action = { type: 'bombard', unitId: gun.id, target: T };

  it('fires its rate of fire at the best defender, each hit taking 1 HP', () => {
    for (const r of outcomes(state, fire, 50)) {
      const e = bombardedOf(r.events);
      expect(e).toMatchObject({ unitId: gun.id, target: inf.id });
      expect(e.hits + e.misses).toBe(2);
      expect(e.damage).toBe(e.hits);
      expect(r.state.units[inf.id]!.hp).toBe(3 - e.hits);
    }
  });

  it('hits as often as bombard strength against modified defence says', () => {
    const results = outcomes(state, fire, 2000);
    const hits = results.reduce((n, r) => n + bombardedOf(r.events).hits, 0) / (2 * results.length);
    // 12 against fortified infantry 10 × 1.25 = 12.5.
    expect(Math.abs(hits - 12 / 24.5)).toBeLessThan(0.03);
    expect(bombardedOf(results[0]!.events).defence).toMatchObject({ strength: 12.5 });
  });

  it('costs all remaining movement and counts as acting; the target never fires back', () => {
    const s = makeState({
      terrain: ['ggggg', 'ggggg', 'ggggc', 'ggggc'],
      units: [
        { type: 'battleship', owner: 'red', x: 4, y: 2 },
        { type: 'infantry', owner: 'blue', x: 2, y: 2 },
      ],
    });
    const ship = unitOf(s, 'battleship');
    s.units[ship.id]!.movesLeft = 7; // part-used
    for (const r of outcomes(s, { type: 'bombard', unitId: ship.id, target: { x: 2, y: 2 } }, 50)) {
      expect(r.state.units[ship.id]).toMatchObject({ movesLeft: 0, actedThisTurn: true, hp: ship.hp });
    }
  });

  it('gives the same result for the same state, and a known result for a known seed', () => {
    const a = ok(applyAction({ ...state, rng: seedRng(7) }, fire));
    expect(a).toEqual(applyAction({ ...state, rng: seedRng(7) }, fire));
    expect(bombardedOf(a.events)).toMatchObject(SEED_7_SHOTS);
  });

  it('never promotes anyone', () => {
    for (const r of outcomes(state, fire, 500)) {
      expect(r.events.some((e) => e.type === 'unitPromoted')).toBe(false);
    }
  });

  it('leaves the target in place and the bombarding unit where it is', () => {
    const r = outcomes(state, fire, 1)[0]!;
    expect(r.state.units[gun.id]!.pos).toEqual({ x: 2, y: 2 });
    expect(r.state.units[inf.id]).toMatchObject({ pos: T, owner: 'blue' });
  });
});

describe('the 1 HP floor', () => {
  // Radar Battery: 18 strength, range 3, rate of fire 3. A lone enemy battery has no
  // defence, so every shot hits.
  const T = { x: 5, y: 2 };
  const state = makeState({
    units: [
      { type: 'radarArtillery', owner: 'red', x: 2, y: 2 },
      { type: 'artillery', owner: 'blue', x: 5, y: 2 },
    ],
  });
  const gun = unitOf(state, 'radarArtillery');
  const target = unitOf(state, 'artillery');

  it('stops hits taking the target below 1 HP', () => {
    const r = ok(bombard(state, gun.id, T));
    expect(bombardedOf(r.events)).toMatchObject({ hits: 3, misses: 0, damage: 2 });
    expect(r.state.units[target.id]).toMatchObject({ hp: 1, owner: 'blue' });
    expect(r.events.some((e) => e.type === 'unitDestroyed')).toBe(false);
  });

  it('does nothing to a target already on 1 HP', () => {
    const s = structuredClone(state);
    s.units[target.id]!.hp = 1;
    const r = ok(bombard(s, gun.id, T));
    expect(bombardedOf(r.events)).toMatchObject({ hits: 3, damage: 0 });
    expect(r.state.units[target.id]!.hp).toBe(1);
  });

  it('lets a lethalBombard unit destroy its target', () => {
    const s = structuredClone(state);
    s.ruleset.unitTypes.radarArtillery!.lethalBombard = true;
    const r = ok(bombard(s, gun.id, T));
    expect(bombardedOf(r.events)).toMatchObject({ damage: 3 });
    expect(r.state.units[target.id]).toBeUndefined();
    expect(r.events).toContainEqual({ type: 'unitDestroyed', unitId: target.id });
  });
});
