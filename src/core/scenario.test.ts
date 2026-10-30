import { describe, expect, it } from 'vitest';
import { miniScenario } from '../../tests/fixtures/mini';
import { hasRiver, tileAt } from './grid';
import { loadScenario, ScenarioError, type ScenarioInput } from './scenario';
import type { GameState, Unit } from './types';

const unitsOf = (s: GameState, type: string) => Object.values(s.units).filter((u) => u.type === type);

function issuesFor(mutate: (s: ScenarioInput) => void): string[] {
  const s = miniScenario();
  mutate(s);
  try {
    loadScenario(s);
  } catch (e) {
    if (e instanceof ScenarioError) return e.issues;
    throw e;
  }
  throw new Error('expected the scenario to be rejected');
}

describe('loadScenario', () => {
  const state = loadScenario(miniScenario());

  it('builds the map, players and cities', () => {
    expect(state.map.tiles).toHaveLength(48);
    expect(tileAt(state.map, { x: 3, y: 3 }).terrain).toBe('mountains');
    expect(state.players.map((p) => p.id)).toEqual(['red', 'blue']);
    expect(state.players[0]!.victoryConditions).toEqual([{ type: 'captureAllCities' }]);
    expect(state.players[0]!.remembered).toHaveLength(48);
    expect(Object.values(state.cities).map((c) => c.name)).toEqual(['Redhold', 'Bluehaven']);
    expect(state.currentPlayer).toBe(0);
    expect(state.turn).toBe(1);
  });

  it('places rivers, roads, rails and fortresses', () => {
    expect(hasRiver(state.map, { x: 3, y: 2 }, 'SE')).toBe(true);
    expect(hasRiver(state.map, { x: 3, y: 3 }, 'NW')).toBe(true);
    expect(tileAt(state.map, { x: 2, y: 1 }).road).toBe(true);
    expect(tileAt(state.map, { x: 4, y: 1 })).toMatchObject({ road: true, rail: true });
    expect(tileAt(state.map, { x: 4, y: 2 }).fortress).toBe(true);
  });

  it('gives every unit and city a unique id', () => {
    const ids = [...Object.keys(state.units), ...Object.keys(state.cities)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(state.nextId).toBe(ids.length + 1);
  });

  it('sets HP from veteran level and full movement in thirds', () => {
    const fighter = unitsOf(state, 'fighter').find((u) => u.owner === 'red')!;
    expect(fighter.hp).toBe(4);
    const armour = unitsOf(state, 'armour').find((u) => u.owner === 'blue')!;
    expect(armour.hp).toBe(3);
    expect(armour.movesLeft).toBe(9);
  });

  it('loads cargo aboard its transport or carrier', () => {
    const transport = unitsOf(state, 'transport')[0]!;
    const aboard = Object.values(state.units).filter((u) => u.carriedBy === transport.id);
    expect(aboard.map((u) => u.type).sort()).toEqual(['armour', 'infantry']);
    expect(aboard.every((u) => u.pos.x === 1 && u.pos.y === 2)).toBe(true);

    const carrier = unitsOf(state, 'carrier')[0]!;
    const blueFighter = unitsOf(state, 'fighter').find((u) => u.owner === 'blue')!;
    expect(blueFighter.carriedBy).toBe(carrier.id);
    expect(blueFighter.base).toEqual({ kind: 'carrier', id: carrier.id });
  });

  it('bases aircraft in the city they start in', () => {
    const fighter = unitsOf(state, 'fighter').find((u) => u.owner === 'red')!;
    const redhold = Object.values(state.cities).find((c) => c.name === 'Redhold')!;
    expect(fighter.base).toEqual({ kind: 'city', id: redhold.id });
  });

  it('only lets land units start fortified', () => {
    const infantry = unitsOf(state, 'infantry').find((u: Unit) => u.carriedBy === null)!;
    expect(infantry.fortified).toBe(true);
  });

  it('seeds the RNG from the scenario seed', () => {
    expect(loadScenario(miniScenario()).rng).toEqual(state.rng);
    const other = miniScenario();
    other.seed = 43;
    expect(loadScenario(other).rng).not.toEqual(state.rng);
  });

  it('stores unit positions as bare coordinates', () => {
    for (const u of Object.values(state.units)) expect(Object.keys(u.pos).sort()).toEqual(['x', 'y']);
  });

  it('produces plain JSON data', () => {
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});

describe('loadScenario validation', () => {
  it('rejects malformed JSON with field paths', () => {
    expect(issuesFor((s) => ((s as { seed: unknown }).seed = 'abc'))).toEqual([
      expect.stringMatching(/^seed:/),
    ]);
  });

  it('rejects rows of the wrong length and unknown terrain', () => {
    const issues = issuesFor((s) => {
      s.map.terrain[1] = 'ocggg';
      s.map.terrain[2] = 'ocgXfpco';
    });
    expect(issues).toContainEqual(expect.stringMatching(/terrain\[1\] has 5 tiles/));
    expect(issues).toContainEqual(expect.stringMatching(/unknown terrain char "X"/));
  });

  it('rejects units placed in the wrong domain', () => {
    const issues = issuesFor((s) => {
      s.units!.push({ type: 'infantry', owner: 'red', x: 0, y: 0 });
      s.units!.push({ type: 'destroyer', owner: 'red', x: 3, y: 2 });
      s.units!.push({ type: 'bomber', owner: 'red', x: 3, y: 1 });
    });
    expect(issues).toContainEqual(expect.stringMatching(/land unit on a sea tile/));
    expect(issues).toContainEqual(expect.stringMatching(/ship must be at sea or in a coastal city/));
    expect(issues).toContainEqual(expect.stringMatching(/aircraft must start in a friendly city/));
  });

  it('rejects overloaded or mismatched cargo', () => {
    const issues = issuesFor((s) => {
      s.units!.push({
        type: 'transport',
        owner: 'red',
        x: 1,
        y: 3,
        cargo: Array.from({ length: 5 }, () => ({ type: 'infantry' })),
      });
      s.units!.push({ type: 'carrier', owner: 'red', x: 1, y: 4, cargo: [{ type: 'infantry' }] });
      s.units!.push({ type: 'destroyer', owner: 'red', x: 2, y: 4, cargo: [{ type: 'infantry' }] });
    });
    expect(issues).toContainEqual(expect.stringMatching(/carries 5 units but capacity is 4/));
    expect(issues).toContainEqual(expect.stringMatching(/carries air units, not land/));
    expect(issues).toContainEqual(expect.stringMatching(/cannot carry units/));
  });

  it('rejects unknown owners and types, excess HP, and rivers on the map edge', () => {
    const issues = issuesFor((s) => {
      s.units!.push({ type: 'infantry', owner: 'green', x: 3, y: 1 });
      s.units!.push({ type: 'zeppelin', owner: 'red', x: 3, y: 1 });
      s.units!.push({ type: 'infantry', owner: 'red', x: 4, y: 1, veteran: 'conscript', hp: 3 });
      s.map.rivers!.push({ x: 0, y: 2, side: 'SW' });
    });
    expect(issues).toContainEqual(expect.stringMatching(/unknown owner "green"/));
    expect(issues).toContainEqual(expect.stringMatching(/unknown unit type "zeppelin"/));
    expect(issues).toContainEqual(expect.stringMatching(/hp 3 exceeds conscript maximum of 2/));
    expect(issues).toContainEqual(expect.stringMatching(/SW edge of \(0, 2\) is the map edge/));
  });

  it('rejects enemies sharing a tile and units inside an enemy city', () => {
    const issues = issuesFor((s) => {
      s.units!.push({ type: 'infantry', owner: 'red', x: 5, y: 3 });
    });
    expect(issues).toContainEqual(expect.stringMatching(/shares a tile with blue's units/));
    expect(issues).toContainEqual(expect.stringMatching(/inside blue's city "Bluehaven"/));
  });

  it('allows a river on the west side of column 0 when the map wraps', () => {
    const s = miniScenario();
    s.map.wrapX = true;
    s.map.rivers!.push({ x: 0, y: 2, side: 'SW' }, { x: 0, y: 2, side: 'NW' });
    const state = loadScenario(s);
    expect(hasRiver(state.map, { x: 7, y: 3 }, 'NE')).toBe(true);
    expect(tileAt(state.map, { x: 7, y: 1 }).riverSE).toBe(true);
  });
});
