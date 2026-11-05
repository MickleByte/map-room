/** Which ships can take which units aboard. Transports carry land units, carriers aircraft. */
import { coordsEqual } from './grid';
import { isAircraft } from './ruleset';
import { cargoOf, cityAt, typeOf, unitsAt } from './state';
import type { Coord, GameState, Unit, UnitId } from './types';

/** Why a unit may not board a ship in port, or null if it may. At sea, units move onto the ship instead. */
export function cannotBoard(state: GameState, unit: Unit, carrierId: UnitId): string | null {
  const ship = state.units[carrierId];
  if (!ship) return `No unit with id ${carrierId}`;
  if (!coordsEqual(unit.pos, ship.pos)) return 'The unit and the ship must be on the same tile';
  if (!cityAt(state, unit.pos)) return 'Units board in a city; at sea, move onto the ship';
  if (unit.carriedBy !== null) return 'This unit is already aboard a ship';
  return cannotCarry(state, ship, unit);
}

/** Put a unit aboard a ship (see cannotBoard); an aircraft makes it its base. Mutates a draft state. */
export function resolveBoard(state: GameState, unit: Unit, carrierId: UnitId): void {
  unit.carriedBy = carrierId;
  unit.fortified = false;
  unit.orders = null;
  if (isAircraft(typeOf(state, unit))) unit.base = { kind: 'carrier', id: carrierId };
}

/** Why a ship could not take a unit aboard, or null if it could. */
export function cannotCarry(state: GameState, ship: Unit, unit: Unit): string | null {
  const hold = typeOf(state, ship).cargo;
  if (ship.id === unit.id || !hold) return `A ${typeOf(state, ship).name} cannot carry units`;
  if (ship.owner !== unit.owner) return 'Units can only board their own ships';
  if (ship.carriedBy !== null) return 'That ship is itself aboard another';
  const domain = typeOf(state, unit).domain;
  if (domain !== hold.domain) return `A ${typeOf(state, ship).name} carries ${hold.domain} units only`;
  if (cargoOf(state, ship.id).filter((u) => u.id !== unit.id).length >= hold.capacity)
    return `That ${typeOf(state, ship).name} is full (${hold.capacity} units)`;
  return null;
}

/** The friendly ship on a tile that would take this unit aboard (oldest first), if any. */
export function shipFor(state: GameState, unit: Unit, c: Coord): Unit | undefined {
  return unitsAt(state, c)
    .sort((a, b) => a.id - b.id)
    .find((ship) => !cannotCarry(state, ship, unit));
}

/**
 * Why no ship on a tile would take this unit aboard, or null if one would. When a
 * friendly ship of the right kind is there, the reason is about that ship (it is full).
 */
export function cannotBoardAt(state: GameState, unit: Unit, c: Coord, otherwise: string): string | null {
  if (shipFor(state, unit, c)) return null;
  const domain = typeOf(state, unit).domain;
  const ship = unitsAt(state, c)
    .sort((a, b) => a.id - b.id)
    .find((s) => s.owner === unit.owner && s.carriedBy === null && typeOf(state, s).cargo?.domain === domain);
  return ship ? cannotCarry(state, ship, unit) : otherwise;
}
