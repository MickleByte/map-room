/**
 * The Straits, the Milestone 1 sample scenario: checked through what loadScenario
 * builds from it, against the brief in docs/plan.md §4 and issue #14.
 */
import { describe, expect, it } from 'vitest';
import straits from '../data/scenarios/the-straits.json';
import { indexToCoord, neighbours, tileAt, tileIndex } from './grid';
import { loadScenario } from './scenario';
import { cargoOf, cityAt, typeOf } from './state';
import type { City, Coord, GameState, Unit } from './types';

const state = loadScenario(straits);
const isLand = (c: Coord) => state.ruleset.terrain[tileAt(state.map, c).terrain]!.domain === 'land';
const citiesOf = (owner: string) => Object.values(state.cities).filter((c) => c.owner === owner);
/** The city-size tier a size falls in, by its minimum size. */
const tierOf = (size: number) =>
  Math.max(...state.ruleset.combat.cityTiers.filter((t) => t.minSize <= size).map((t) => t.minSize));
const unitsOf = (owner: string) => Object.values(state.units).filter((u) => u.owner === owner);

/** Every land tile reachable from `from` over land, skipping tiles `blocked` rejects. */
function landReach(from: Coord, blocked: (c: Coord) => boolean = () => false): Set<number> {
  const seen = new Set([tileIndex(state.map, from)]);
  const queue = [from];
  while (queue.length) {
    for (const n of neighbours(state.map, queue.pop()!)) {
      const i = tileIndex(state.map, n);
      if (seen.has(i) || !isLand(n) || blocked(n)) continue;
      seen.add(i);
      queue.push(n);
    }
  }
  return seen;
}

describe('The Straits', () => {
  it('is a 60 × 80-row map (60 × 40 tiles on screen) that wraps east–west', () => {
    expect(state.map).toMatchObject({ width: 60, height: 80, wrapX: true });
  });

  it('has two continents split by a channel 3 to 6 tiles wide', () => {
    const channelRows = [];
    for (let y = 0; y < state.map.height; y++) {
      // The channel runs down the middle of the map; measure the sea between the shores.
      const row = Array.from({ length: 21 }, (_, i) => isLand({ x: 20 + i, y }));
      const west = row.indexOf(true);
      const east = row.lastIndexOf(true);
      if (west === -1 || row.every(Boolean)) continue;
      const gap = row.slice(west, east + 1).filter((land) => !land).length;
      channelRows.push(gap);
    }
    expect(channelRows.length).toBeGreaterThan(50);
    for (const gap of channelRows) {
      expect(gap).toBeGreaterThanOrEqual(3);
      expect(gap).toBeLessThanOrEqual(6);
    }
  });

  it('joins the continents by one land bridge, guarded by a fortress line', () => {
    const red = citiesOf('red');
    const blue = citiesOf('blue');
    const reach = landReach(red[0]!.pos);
    for (const city of [...red, ...blue]) expect(reach.has(tileIndex(state.map, city.pos))).toBe(true);

    const fortress = (c: Coord) => tileAt(state.map, c).fortress;
    const fortresses = state.map.tiles.filter((t) => t.fortress).length;
    expect(fortresses).toBeGreaterThanOrEqual(4);
    // Without the fortress line nothing on land connects the two sides.
    const cut = landReach(red[0]!.pos, fortress);
    for (const city of red) expect(cut.has(tileIndex(state.map, city.pos))).toBe(true);
    for (const city of blue) expect(cut.has(tileIndex(state.map, city.pos))).toBe(false);
  });

  it('has rivers, hills and a mountain spine', () => {
    const tiles = state.map.tiles;
    const count = (terrain: string) => tiles.filter((t) => t.terrain === terrain).length;
    expect(tiles.filter((t) => t.riverSE || t.riverSW).length).toBeGreaterThan(20);
    expect(count('hills')).toBeGreaterThan(20);
    expect(count('mountains')).toBeGreaterThan(20);
    // The spine: one column band holds a mountain in most rows of the continent.
    const rowsWithMountain = new Set(
      tiles.flatMap((t, i) => (t.terrain === 'mountains' ? [indexToCoord(state.map, i).y] : [])),
    );
    expect(rowsWithMountain.size).toBeGreaterThan(40);
  });

  it('gives each side 6 cities of sizes 3–14, every size tier on each side, some walled', () => {
    for (const owner of ['red', 'blue']) {
      const cities = citiesOf(owner);
      expect(cities).toHaveLength(6);
      const tiers = new Set(cities.map((c: City) => tierOf(c.size)));
      expect([...tiers].sort((a, b) => a - b)).toEqual(state.ruleset.combat.cityTiers.map((t) => t.minSize));
      expect(cities.some((c) => c.walls)).toBe(true);
      for (const c of cities) {
        expect(c.size).toBeGreaterThanOrEqual(3);
        expect(c.size).toBeLessThanOrEqual(14);
        expect(c.shieldsPerTurn).toBeGreaterThan(0);
      }
    }
    const sizes = Object.values(state.cities).map((c) => c.size);
    expect(Math.min(...sizes)).toBe(3);
    expect(Math.max(...sizes)).toBe(14);
  });

  describe.each(['red', 'blue'])('%s starting forces', (owner) => {
    const units = unitsOf(owner);
    const has = (type: string, where: (u: Unit) => boolean = () => true) =>
      units.some((u) => u.type === type && where(u));
    const inCity = (u: Unit) => cityAt(state, u.pos)?.owner === owner;

    it('dig infantry and tank hunters in on the fortress line', () => {
      const dugIn = (u: Unit) => u.fortified && tileAt(state.map, u.pos).fortress;
      expect(has('infantry', dugIn)).toBe(true);
      expect(has('antiTank', dugIn)).toBe(true);
    });

    it('have armour, mechanised infantry and guns at the front', () => {
      for (const type of ['armour', 'mechInfantry', 'artillery', 'radarArtillery'])
        expect(has(type)).toBe(true);
    });

    it('have a destroyer and battleship task force, a loaded transport and a carrier with fighters', () => {
      const atSea = (u: Unit) => !isLand(u.pos);
      expect(has('destroyer', atSea)).toBe(true);
      expect(has('battleship', atSea)).toBe(true);
      expect(has('transport', (u) => cargoOf(state, u.id).length > 0)).toBe(true);
      expect(has('carrier', (u) => cargoOf(state, u.id).some((c) => c.type === 'fighter'))).toBe(true);
    });

    it('base fighters and bombers in cities, with paratroopers in a rear city', () => {
      expect(has('fighter', (u) => u.carriedBy === null && inCity(u))).toBe(true);
      expect(has('bomber', inCity)).toBe(true);
      expect(has('paratrooper', inCity)).toBe(true);
    });

    it('garrison every city', () => {
      for (const city of citiesOf(owner)) {
        const here = units.filter((u) => u.pos.x === city.pos.x && u.pos.y === city.pos.y);
        expect(here.some((u) => typeOf(state, u).domain === 'land' && typeOf(state, u).defence > 0)).toBe(
          true,
        );
      }
    });
  });

  it('is the state a fresh game starts from', () => {
    expect(state satisfies GameState).toMatchObject({ scenarioId: 'the-straits', turn: 1, winner: null });
    expect(state.players.map((p) => [p.id, p.control])).toEqual([
      ['red', 'human'],
      ['blue', 'ai'],
    ]);
  });
});
