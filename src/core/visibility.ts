/**
 * Fog of war: what each player can see now and what they remember. Visible tiles
 * are worked out from units and cities on demand; remembered tiles are kept in
 * Player.remembered, which the reducer brings up to date after every action.
 */
import { indexToCoord, normalize, tileAt, tileIndex, tilesWithin } from './grid';
import { cityAt, typeOf, unitsAt } from './state';
import type { City, Coord, GameState, Player, PlayerId, RememberedTile, Unit } from './types';

export type Visibility = 'unseen' | 'remembered' | 'visible';

/** How far a unit sees: its type's sight plus its tile's bonus (hills and mountains). */
export function sightOf(state: GameState, unit: Unit): number {
  const terrain = state.ruleset.terrain[tileAt(state.map, unit.pos).terrain]!;
  return typeOf(state, unit).sight + terrain.sightBonus;
}

/** The tile indices a player can see right now, from their units and cities. */
export function visibleTiles(state: GameState, player: PlayerId): Set<number> {
  const seen = new Set<number>();
  const look = (from: Coord, radius: number) => {
    for (const c of tilesWithin(state.map, from, radius)) seen.add(tileIndex(state.map, c));
  };
  for (const unit of Object.values(state.units)) {
    if (unit.owner === player) look(unit.pos, sightOf(state, unit));
  }
  for (const city of Object.values(state.cities)) {
    if (city.owner === player) look(city.pos, state.ruleset.citySight);
  }
  return seen;
}

/** What a player notes about a tile they can see. */
function snapshot(state: GameState, c: Coord): RememberedTile {
  const city = cityAt(state, c);
  return { city: city ? { id: city.id, owner: city.owner, size: city.size, walls: city.walls } : null };
}

function sameMemory(a: RememberedTile | null, b: RememberedTile): boolean {
  if (!a) return false;
  if (!a.city || !b.city) return a.city === b.city;
  return (
    a.city.id === b.city.id &&
    a.city.owner === b.city.owner &&
    a.city.size === b.city.size &&
    a.city.walls === b.city.walls
  );
}

function remember(state: GameState, player: Player, tiles: Iterable<number>): void {
  for (const i of tiles) {
    const note = snapshot(state, indexToCoord(state.map, i));
    if (!sameMemory(player.remembered[i] ?? null, note)) player.remembered[i] = note;
  }
}

/** Record what every player can see right now. Mutates a draft state. */
export function updateMemory(state: GameState): void {
  for (const player of state.players) remember(state, player, visibleTiles(state, player.id));
}

/**
 * Record what a unit can see from where it stands, so tiles glimpsed partway along a
 * multi-step move are remembered too. Mutates a draft state.
 */
export function lookAround(state: GameState, unit: Unit): void {
  const player = state.players.find((p) => p.id === unit.owner);
  if (!player) return;
  const tiles = tilesWithin(state.map, unit.pos, sightOf(state, unit)).map((c) => tileIndex(state.map, c));
  remember(state, player, tiles);
}

/**
 * The player whose fog the screen shows: the human. In M1 the AI sees everything, so
 * with no human player there is no fog.
 */
export function fogViewer(state: GameState): PlayerId | null {
  return state.players.find((p) => p.control === 'human')?.id ?? null;
}

/** One player's view of the map. A null player sees everything. */
export class Vision {
  private readonly visible: Set<number> | null;
  private readonly memory: (RememberedTile | null)[];

  constructor(
    readonly state: GameState,
    readonly player: PlayerId | null,
  ) {
    this.visible = player === null ? null : visibleTiles(state, player);
    this.memory = state.players.find((p) => p.id === player)?.remembered ?? [];
  }

  at(c: Coord): Visibility {
    const i = this.index(c);
    if (!this.visible || this.visible.has(i)) return 'visible';
    return this.memory[i] ? 'remembered' : 'unseen';
  }

  /** Every unit on a tile, including cargo, or none if the tile is not visible. */
  unitsAt(c: Coord): Unit[] {
    return this.at(c) === 'visible' ? unitsAt(this.state, c) : [];
  }

  /** The city on a tile: as it is now if visible, as last seen if remembered. */
  cityAt(c: Coord): City | undefined {
    const i = this.index(c);
    if (!this.visible || this.visible.has(i)) return cityAt(this.state, c);
    const seen = this.memory[i]?.city;
    const city = seen && this.state.cities[seen.id];
    return city ? { ...city, owner: seen.owner, size: seen.size, walls: seen.walls } : undefined;
  }

  /** Every city the player knows about, as they know it. */
  cities(): City[] {
    return Object.values(this.state.cities).flatMap((c) => this.cityAt(c.pos) ?? []);
  }

  private index(c: Coord): number {
    const n = normalize(this.state.map, c);
    if (!n) throw new Error(`(${c.x}, ${c.y}) is off the map`);
    return tileIndex(this.state.map, n);
  }
}
