/**
 * Scenario JSON → initial GameState. Validates shape with zod, then game rules
 * (placement, cargo, bases), reporting every problem at once.
 */
import { z } from 'zod';
import { inBounds, neighbours, step, tileIndex } from './grid';
import { seedRng } from './rng';
import { defaultRuleset, formatIssues, maxHp, type Ruleset, type VeteranLevel } from './ruleset';
import type { City, Coord, GameMap, GameState, Player, Tile, Unit, UnitId } from './types';
import { newUnit } from './units';
import { updateMemory } from './visibility';

const int = z.number().int();
const xy = { x: int.nonnegative(), y: int.nonnegative() };
const veteran = z.enum(['conscript', 'regular', 'veteran', 'elite']);

const cargoSchema = z.object({
  type: z.string(),
  veteran: veteran.default('regular'),
  hp: int.positive().optional(),
});

const scenarioUnitSchema = z.object({
  type: z.string(),
  owner: z.string(),
  ...xy,
  veteran: veteran.default('regular'),
  hp: int.positive().optional(),
  fortified: z.boolean().default(false),
  cargo: z.array(cargoSchema).default([]),
});

export const scenarioSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(''),
  seed: int,
  map: z.object({
    width: int.positive(),
    height: int.positive(),
    wrapX: z.boolean().default(true),
    /** One string per row, one terrain char per tile. */
    terrain: z.array(z.string()),
    /** Each river segment lies on one edge of a tile. */
    rivers: z.array(z.object({ ...xy, side: z.enum(['NE', 'SE', 'SW', 'NW']) })).default([]),
    roads: z.array(z.tuple([int, int])).default([]),
    rails: z.array(z.tuple([int, int])).default([]),
    fortresses: z.array(z.tuple([int, int])).default([]),
  }),
  players: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        control: z.enum(['human', 'ai']),
        victoryConditions: z
          .array(z.object({ type: z.literal('captureAllCities') }))
          .default([{ type: 'captureAllCities' }]),
      }),
    )
    .min(2),
  cities: z
    .array(
      z.object({
        name: z.string().min(1),
        owner: z.string(),
        ...xy,
        size: int.positive(),
        walls: z.boolean().default(false),
        shieldsPerTurn: int.nonnegative(),
        queue: z.array(z.string()).default([]),
        repeat: z.boolean().default(false),
      }),
    )
    .default([]),
  units: z.array(scenarioUnitSchema).default([]),
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioInput = z.input<typeof scenarioSchema>;

export class ScenarioError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid scenario:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
  }
}

export function loadScenario(json: unknown, ruleset: Ruleset = defaultRuleset): GameState {
  const parsed = scenarioSchema.safeParse(json);
  if (!parsed.success) throw new ScenarioError(formatIssues(parsed.error));
  const s = parsed.data;
  const issues: string[] = [];

  const map = buildMap(s, ruleset, issues);
  if (!map) throw new ScenarioError(issues);

  const playerIds = new Set<string>();
  for (const p of s.players) {
    if (playerIds.has(p.id)) issues.push(`duplicate player id "${p.id}"`);
    playerIds.add(p.id);
  }
  const players: Player[] = s.players.map((p) => ({
    id: p.id,
    name: p.name,
    colour: p.colour,
    control: p.control,
    victoryConditions: p.victoryConditions,
    eliminated: false,
    remembered: map.tiles.map(() => null),
    revealed: [],
  }));

  let nextId = 1;
  const domainOf = (c: Coord) => ruleset.terrain[map.tiles[tileIndex(map, c)]!.terrain]!.domain;

  // ---- cities ----
  const cities: Record<number, City> = {};
  const cityAt = new Map<number, City>();
  s.cities.forEach((c, i) => {
    const where = `cities[${i}] "${c.name}"`;
    if (!playerIds.has(c.owner)) issues.push(`${where}: unknown owner "${c.owner}"`);
    if (!inBounds(map, c)) return issues.push(`${where}: (${c.x}, ${c.y}) is off the map`);
    if (domainOf(c) !== 'land') issues.push(`${where}: must be on a land tile`);
    if (cityAt.has(tileIndex(map, c))) issues.push(`${where}: another city is already at (${c.x}, ${c.y})`);
    for (const t of c.queue)
      if (!ruleset.unitTypes[t]) issues.push(`${where}: unknown unit type "${t}" in queue`);
    const city: City = {
      id: nextId++,
      name: c.name,
      owner: c.owner,
      pos: { x: c.x, y: c.y },
      size: c.size,
      walls: c.walls,
      shieldsPerTurn: c.shieldsPerTurn,
      shieldsStored: 0,
      queue: c.queue,
      repeat: c.repeat,
    };
    cities[city.id] = city;
    cityAt.set(tileIndex(map, c), city);
  });

  // ---- units ----
  const units: Record<UnitId, Unit> = {};
  const ownerAt = new Map<number, string>();
  const makeUnit = (
    type: string,
    owner: string,
    pos: Coord,
    vet: VeteranLevel,
    hp: number | undefined,
    where: string,
  ): Unit | null => {
    const def = ruleset.unitTypes[type];
    if (!def) {
      issues.push(`${where}: unknown unit type "${type}"`);
      return null;
    }
    const max = maxHp(ruleset, vet);
    if (hp !== undefined && hp > max) issues.push(`${where}: hp ${hp} exceeds ${vet} maximum of ${max}`);
    return newUnit(ruleset, nextId++, type, owner, pos, vet, hp);
  };

  s.units.forEach((u, i) => {
    const where = `units[${i}] (${u.type} at ${u.x}, ${u.y})`;
    if (!playerIds.has(u.owner)) issues.push(`${where}: unknown owner "${u.owner}"`);
    if (!inBounds(map, u)) return issues.push(`${where}: off the map`);
    const unit = makeUnit(u.type, u.owner, u, u.veteran, u.hp, where);
    if (!unit) return;
    const def = ruleset.unitTypes[u.type]!;
    const idx = tileIndex(map, u);
    const city = cityAt.get(idx);

    const occupant = ownerAt.get(idx);
    if (occupant && occupant !== u.owner) issues.push(`${where}: shares a tile with ${occupant}'s units`);
    ownerAt.set(idx, u.owner);
    if (city && city.owner !== u.owner)
      issues.push(`${where}: is inside ${city.owner}'s city "${city.name}"`);

    const terrainDomain = domainOf(u);
    if (def.domain === 'land' && terrainDomain !== 'land') issues.push(`${where}: land unit on a sea tile`);
    if (def.domain === 'sea') {
      const coastalCity = city && neighbours(map, u).some((n) => domainOf(n) === 'sea');
      if (terrainDomain !== 'sea' && !coastalCity)
        issues.push(`${where}: ship must be at sea or in a coastal city`);
    }
    if (def.domain === 'air') {
      if (city && city.owner === u.owner) unit.base = { kind: 'city', id: city.id };
      else issues.push(`${where}: aircraft must start in a friendly city or aboard a carrier`);
    }
    unit.fortified = u.fortified && def.domain === 'land';
    units[unit.id] = unit;

    if (u.cargo.length) {
      if (!def.cargo) return issues.push(`${where}: has cargo but cannot carry units`);
      if (u.cargo.length > def.cargo.capacity)
        issues.push(`${where}: carries ${u.cargo.length} units but capacity is ${def.cargo.capacity}`);
      u.cargo.forEach((c, j) => {
        const cWhere = `${where} cargo[${j}] (${c.type})`;
        const passenger = makeUnit(c.type, u.owner, u, c.veteran, c.hp, cWhere);
        if (!passenger) return;
        const pDef = ruleset.unitTypes[c.type]!;
        if (pDef.domain !== def.cargo!.domain)
          issues.push(`${cWhere}: ${def.name} carries ${def.cargo!.domain} units, not ${pDef.domain}`);
        passenger.carriedBy = unit.id;
        if (pDef.domain === 'air') passenger.base = { kind: 'carrier', id: unit.id };
        units[passenger.id] = passenger;
      });
    }
  });

  if (issues.length) throw new ScenarioError(issues);

  const state: GameState = {
    schemaVersion: 1,
    scenarioId: s.id,
    ruleset,
    map,
    players,
    currentPlayer: 0,
    turn: 1,
    units,
    cities,
    nextId,
    rng: seedRng(s.seed),
    winner: null,
  };
  updateMemory(state);
  return state;
}

function buildMap(s: Scenario, ruleset: Ruleset, issues: string[]): GameMap | null {
  const { width, height, wrapX } = s.map;
  const byChar = new Map(Object.entries(ruleset.terrain).map(([id, t]) => [t.char, id]));

  if (s.map.terrain.length !== height) {
    issues.push(`map.terrain has ${s.map.terrain.length} rows but height is ${height}`);
    return null;
  }
  const tiles: Tile[] = [];
  s.map.terrain.forEach((row, y) => {
    if (row.length !== width) issues.push(`map.terrain[${y}] has ${row.length} tiles but width is ${width}`);
    for (let x = 0; x < width; x++) {
      const ch = row[x] ?? '?';
      const terrain = byChar.get(ch);
      if (!terrain) issues.push(`map.terrain[${y}][${x}]: unknown terrain char "${ch}"`);
      tiles.push({
        terrain: terrain ?? 'ocean',
        riverSE: false,
        riverSW: false,
        road: false,
        rail: false,
        fortress: false,
      });
    }
  });
  if (issues.length) return null;
  const map: GameMap = { width, height, wrapX, tiles };
  const tile = (c: Coord) => tiles[tileIndex(map, c)]!;
  const isLand = (c: Coord) => ruleset.terrain[tile(c).terrain]!.domain === 'land';

  s.map.rivers.forEach((r, i) => {
    if (!inBounds(map, r)) return issues.push(`map.rivers[${i}]: (${r.x}, ${r.y}) is off the map`);
    const across = step(map, r, r.side);
    if (!across) return issues.push(`map.rivers[${i}]: ${r.side} edge of (${r.x}, ${r.y}) is the map edge`);
    // Every river edge is stored as the SE or SW edge of the tile above it.
    if (r.side === 'SE') tile(r).riverSE = true;
    else if (r.side === 'SW') tile(r).riverSW = true;
    else if (r.side === 'NE') tile(across).riverSW = true;
    else tile(across).riverSE = true;
  });

  const place = (list: [number, number][], name: string, apply: (t: Tile) => void) =>
    list.forEach(([x, y], i) => {
      const c = { x, y };
      if (!inBounds(map, c)) return issues.push(`map.${name}[${i}]: (${x}, ${y}) is off the map`);
      if (!isLand(c)) return issues.push(`map.${name}[${i}]: (${x}, ${y}) is not land`);
      apply(tile(c));
    });
  place(s.map.roads, 'roads', (t) => (t.road = true));
  place(s.map.rails, 'rails', (t) => {
    t.road = true;
    t.rail = true;
  });
  place(s.map.fortresses, 'fortresses', (t) => (t.fortress = true));

  return map;
}
