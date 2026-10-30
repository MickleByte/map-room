/** Read-only lookups over GameState shared by core, AI and UI. */
import { coordsEqual } from './grid';
import { unitType, type UnitTypeDef } from './ruleset';
import type { City, Coord, GameState, Player, Unit, UnitId } from './types';

export function currentPlayer(state: GameState): Player {
  return state.players[state.currentPlayer]!;
}

export function typeOf(state: GameState, unit: Unit): UnitTypeDef {
  return unitType(state.ruleset, unit.type);
}

export function cityAt(state: GameState, c: Coord): City | undefined {
  return Object.values(state.cities).find((city) => coordsEqual(city.pos, c));
}

/** Every unit on a tile, including cargo. */
export function unitsAt(state: GameState, c: Coord): Unit[] {
  return Object.values(state.units).filter((u) => coordsEqual(u.pos, c));
}

export function cargoOf(state: GameState, carrierId: UnitId): Unit[] {
  return Object.values(state.units).filter((u) => u.carriedBy === carrierId);
}

export function hasEnemyUnits(state: GameState, c: Coord, player: string): boolean {
  return unitsAt(state, c).some((u) => u.owner !== player);
}

export function unitsOf(state: GameState, player: string): Unit[] {
  return Object.values(state.units).filter((u) => u.owner === player);
}

/**
 * An index of what stands on each tile, for code that queries many tiles at once
 * (pathfinding, AI). Build it from a state and discard it when the state changes.
 */
export class Board {
  private readonly cities = new Map<number, City>();
  private readonly owners = new Map<number, Set<string>>();

  constructor(readonly state: GameState) {
    const key = (c: Coord) => c.y * state.map.width + c.x;
    for (const city of Object.values(state.cities)) this.cities.set(key(city.pos), city);
    for (const u of Object.values(state.units)) {
      const k = key(u.pos);
      const set = this.owners.get(k) ?? new Set();
      set.add(u.owner);
      this.owners.set(k, set);
    }
  }

  cityAt(c: Coord): City | undefined {
    return this.cities.get(c.y * this.state.map.width + c.x);
  }

  hasOwn(c: Coord, player: string): boolean {
    return !!this.owners.get(c.y * this.state.map.width + c.x)?.has(player);
  }

  hasEnemy(c: Coord, player: string): boolean {
    const set = this.owners.get(c.y * this.state.map.width + c.x);
    return !!set && [...set].some((o) => o !== player);
  }
}
