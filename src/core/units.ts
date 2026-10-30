/** Unit state changes shared by several actions. All functions mutate a draft state. */
import { findPath, stepUses } from './movement';
import { shipFor } from './cargo';
import { normalize, tileAt } from './grid';
import { captureCity } from './cities';
import { maxHp, THIRDS_PER_MP, unitType, type Ruleset, type VeteranLevel } from './ruleset';
import { cargoOf, cityAt, typeOf } from './state';
import type { Coord, GameEvent, GameState, PlayerId, Unit, UnitId } from './types';
import { lookAround } from './visibility';

/** A fresh unit at full movement, ready to act (full HP unless `hp` is given). */
export function newUnit(
  ruleset: Ruleset,
  id: UnitId,
  type: string,
  owner: PlayerId,
  pos: Coord,
  veteran: VeteranLevel = 'regular',
  hp?: number,
): Unit {
  return {
    id,
    type,
    owner,
    pos: { x: pos.x, y: pos.y },
    hp: hp ?? maxHp(ruleset, veteran),
    veteran,
    movesLeft: unitType(ruleset, type).movement * THIRDS_PER_MP,
    fortified: false,
    actedThisTurn: false,
    carriedBy: null,
    base: null,
    stance: 'none',
    interceptsLeft: ruleset.air.interceptsPerTurn,
    orders: null,
    justParadropped: false,
  };
}

/** Step a unit (and anything it carries) into an adjacent tile it is allowed to enter. */
export function moveUnit(state: GameState, unit: Unit, to: Coord, events: GameEvent[]): void {
  unit.movesLeft -= stepUses(state, unit, unit.pos, normalize(state.map, to)!);
  placeUnit(state, unit, to, events);
}

/**
 * Put a unit (and its cargo) on an adjacent tile without spending movement, as when an
 * attacker advances. Entering an enemy city captures it.
 */
export function placeUnit(state: GameState, unit: Unit, to: Coord, events: GameEvent[]): void {
  // Copy coordinates: events outlive the draft, so they must not hold draft objects.
  const from = { ...unit.pos };
  const dest = { ...normalize(state.map, to)! };
  if (typeOf(state, unit).domain === 'land') {
    // Stepping onto a sea tile boards a ship there; stepping onto land goes ashore.
    const atSea = state.ruleset.terrain[tileAt(state.map, dest).terrain]!.domain === 'sea';
    unit.carriedBy = atSea ? shipFor(state, unit, dest)!.id : null;
  }
  unit.pos = { ...dest };
  unit.fortified = false;
  unit.actedThisTurn = true;
  for (const passenger of cargoOf(state, unit.id)) passenger.pos = { ...dest };
  lookAround(state, unit);
  events.push({ type: 'unitMoved', unitId: unit.id, from, to: dest });
  const city = cityAt(state, dest);
  if (city && city.owner !== unit.owner) captureCity(city, unit.owner, events);
}

/** Remove a unit from the game, and its cargo with it. */
export function destroyUnit(state: GameState, unit: Unit, events: GameEvent[]): void {
  for (const passenger of cargoOf(state, unit.id)) destroyUnit(state, passenger, events);
  delete state.units[unit.id];
  events.push({ type: 'unitDestroyed', unitId: unit.id });
}

/**
 * Follow a unit's go-to order as far as its movement allows this turn. The order is
 * cleared on arrival or when the route is blocked.
 */
export function advanceOrders(state: GameState, unit: Unit, events: GameEvent[]): void {
  const order = unit.orders;
  if (!order) return;
  const path = findPath(state, unit, order.target);
  if (!path) {
    unit.orders = null;
    return;
  }
  for (const step of path) {
    if (step.turn > 0 || unit.movesLeft <= 0) return;
    moveUnit(state, unit, step.pos, events);
  }
  unit.orders = null;
}
