/**
 * Air operations. Aircraft sit at their base (a friendly city or carrier) and fly one
 * sortie a turn: a mission (a round trip to bomb or scout a tile within operational
 * range), a rebase, or air superiority, a stance that intercepts enemy bombers during
 * the enemy's turn (ADR-0002). Paradrops live here too: airborne infantry dropping
 * from a friendly city, never intercepted.
 */
import { coordsEqual, distance, normalize, tileAt, tilesWithin } from '../grid';
import { cannotOccupy, fullMoves } from '../movement';
import { cityAt, hasEnemyUnits, typeOf } from '../state';
import type { Coord, GameEvent, GameState, PlayerId, Unit } from '../types';
import { cannotCarry } from '../cargo';
import { Rng } from '../rng';
import { destroyUnit, placeUnit } from '../units';
import { bombardTarget, fireShots, type BombardPreview } from './bombard';
import { roundChance } from './odds';
import { combatRounds } from './resolve';

export type MissionKind = 'bomb' | 'recon';

/** Why a unit can't fly a sortie (mission, rebase or air superiority) now, or null if it can. */
export function cannotSortie(state: GameState, unit: Unit): string | null {
  if (typeOf(state, unit).domain !== 'air') return 'Only aircraft fly missions';
  if (unit.actedThisTurn) return 'This aircraft has already flown this turn';
  return null;
}

/** Why an aircraft may not fly a mission to a tile, or null if it may. */
export function cannotFlyMission(
  state: GameState,
  unit: Unit,
  mission: MissionKind,
  target: Coord,
): string | null {
  const to = normalize(state.map, target);
  if (!to) return 'That tile is off the map';
  const why = cannotSortie(state, unit);
  if (why) return why;
  const def = typeOf(state, unit);
  if (mission === 'bomb' && (def.bombardStrength <= 0 || def.rateOfFire <= 0))
    return `A ${def.name} cannot bomb`;
  if (distance(state.map, unit.pos, to) > def.operationalRange) return 'That tile is out of range';
  if (mission === 'bomb' && !bombardTarget(state, unit, to)) return 'There is no enemy there';
  return null;
}

/** The tiles an aircraft could fly a mission to now, its own excluded. */
export function missionRange(state: GameState, unit: Unit): Coord[] {
  if (cannotSortie(state, unit)) return [];
  return tilesWithin(state.map, unit.pos, typeOf(state, unit).operationalRange).filter(
    (c) => !coordsEqual(c, unit.pos),
  );
}

/**
 * What a bombing mission would face, for the tooltip and the AI; or why it isn't
 * allowed. Interceptors are left out: the enemy's stances are not the player's to see.
 */
export function previewMission(state: GameState, unit: Unit, target: Coord): BombardPreview | string {
  const why = cannotFlyMission(state, unit, 'bomb', target);
  if (why) return why;
  const def = typeOf(state, unit);
  const victim = bombardTarget(state, unit, normalize(state.map, target)!)!;
  return {
    strength: def.bombardStrength,
    target: victim.unit,
    defence: victim.defence,
    hitChance: roundChance(def.bombardStrength, victim.defence.strength),
    shots: def.rateOfFire,
    lethal: def.lethalBombard,
  };
}

/** Fly a legal mission (see cannotFlyMission) to an on-map tile. Mutates a draft state. */
export function resolveMission(
  state: GameState,
  unit: Unit,
  mission: MissionKind,
  to: Coord,
  events: GameEvent[],
): void {
  unit.actedThisTurn = true;
  for (const fighter of interceptorsOf(state, unit, to)) {
    intercept(state, fighter, unit, events);
    if (!state.units[unit.id]) return;
  }
  if (mission === 'bomb') fireShots(state, unit, bombardTarget(state, unit, to)!, events);
  else reveal(state, unit.owner, to);
}

export type AirBase = NonNullable<Unit['base']>;

/** Where a base is, or why it can't take this aircraft. */
function basePos(state: GameState, unit: Unit, to: AirBase): Coord | string {
  if (to.kind === 'city') {
    const city = state.cities[to.id];
    if (!city || city.owner !== unit.owner) return 'Aircraft can only rebase to a friendly city or carrier';
    return city.pos;
  }
  const ship = state.units[to.id];
  if (!ship) return `No unit with id ${to.id}`;
  return cannotCarry(state, ship, unit) ?? ship.pos;
}

/** Why an aircraft may not rebase, or null if it may. */
export function cannotRebase(state: GameState, unit: Unit, to: AirBase): string | null {
  const why = cannotSortie(state, unit);
  if (why) return why;
  if (unit.base?.kind === to.kind && unit.base.id === to.id) return 'This aircraft is already based there';
  const pos = basePos(state, unit, to);
  if (typeof pos === 'string') return pos;
  if (distance(state.map, unit.pos, pos) > typeOf(state, unit).operationalRange)
    return 'That base is out of range';
  return null;
}

/** Fly a legal rebase (see cannotRebase). Mutates a draft state. */
export function resolveRebase(state: GameState, unit: Unit, to: AirBase, events: GameEvent[]): void {
  placeUnit(state, unit, basePos(state, unit, to) as Coord, events);
  unit.carriedBy = to.kind === 'carrier' ? to.id : null;
  unit.base = { ...to };
}

/** The bases an aircraft could rebase to now. */
export function rebaseTargets(state: GameState, unit: Unit): AirBase[] {
  const cities: AirBase[] = Object.values(state.cities).map((c) => ({ kind: 'city', id: c.id }));
  const ships: AirBase[] = Object.values(state.units)
    .filter((u) => typeOf(state, u).cargo?.domain === 'air')
    .map((u) => ({ kind: 'carrier', id: u.id }));
  return [...cities, ...ships].filter((b) => !cannotRebase(state, unit, b));
}

/** Why a unit may not paradrop onto a tile, or null if it may. */
export function cannotParadrop(state: GameState, unit: Unit, target: Coord): string | null {
  const to = normalize(state.map, target);
  if (!to) return 'That tile is off the map';
  const why = cannotDrop(state, unit);
  if (why) return why;
  const range = distance(state.map, unit.pos, to);
  if (range === 0) return 'Paratroopers must drop somewhere else';
  if (range > typeOf(state, unit).paradropRange) return 'That tile is out of range';
  if (state.ruleset.terrain[tileAt(state.map, to).terrain]!.domain !== 'land')
    return 'Paratroopers must drop onto land';
  if (hasEnemyUnits(state, to, unit.owner)) return 'Paratroopers cannot drop onto enemy units';
  return cannotOccupy(state, unit, to);
}

/**
 * Carry out a legal paradrop (see cannotParadrop). The unit can't move or attack
 * again this turn. Landing in an empty enemy city takes it. Mutates a draft state.
 */
export function resolveParadrop(state: GameState, unit: Unit, to: Coord, events: GameEvent[]): void {
  placeUnit(state, unit, to, events);
  unit.movesLeft = 0;
  unit.orders = null;
  unit.justParadropped = true;
}

/** Why a unit can't paradrop anywhere right now, or null if it can. */
export function cannotDrop(state: GameState, unit: Unit): string | null {
  if (typeOf(state, unit).paradropRange <= 0) return 'This unit cannot paradrop';
  const city = cityAt(state, unit.pos);
  if (unit.carriedBy !== null || city?.owner !== unit.owner) return 'Paratroopers drop from a friendly city';
  if (unit.movesLeft < fullMoves(state, unit)) return 'This unit has already moved this turn';
  return null;
}

/** The tiles a unit could paradrop onto now. */
export function paradropRange(state: GameState, unit: Unit): Coord[] {
  if (cannotDrop(state, unit)) return [];
  const reach = typeOf(state, unit).paradropRange;
  return tilesWithin(state.map, unit.pos, reach).filter((c) => !cannotParadrop(state, unit, c));
}

/** Why a unit may not go on air superiority, or null if it may. */
export function cannotPatrol(state: GameState, unit: Unit): string | null {
  const why = cannotSortie(state, unit);
  if (why) return why;
  const def = typeOf(state, unit);
  if (!def.airSuperiority) return `A ${def.name} cannot fly air superiority`;
  return null;
}

/** Put a fighter on air superiority until its owner's next turn. Mutates a draft state. */
export function startPatrol(unit: Unit): void {
  unit.actedThisTurn = true;
  unit.stance = 'airSuperiority';
}

/** Bombers are the aircraft that can't fly air superiority themselves. */
function isBomber(state: GameState, unit: Unit): boolean {
  const def = typeOf(state, unit);
  return def.domain === 'air' && !def.airSuperiority;
}

/**
 * The enemy fighters that would intercept an aircraft flying a mission to a tile, in
 * the order they engage (oldest first): those on air superiority with an interception
 * left whose operational range covers the tile. None for fighters, which aren't
 * intercepted.
 */
export function interceptorsOf(state: GameState, unit: Unit, target: Coord): Unit[] {
  if (!isBomber(state, unit)) return [];
  return Object.values(state.units)
    .filter(
      (f) =>
        f.owner !== unit.owner &&
        f.stance === 'airSuperiority' &&
        f.interceptsLeft > 0 &&
        distance(state.map, f.pos, target) <= typeOf(state, f).operationalRange,
    )
    .sort((a, b) => a.id - b.id);
}

/**
 * An interception: an ordinary combat to the death, the fighter's attack against the
 * bomber's unmodified defence (they meet in the air). Nobody is promoted.
 */
function intercept(state: GameState, fighter: Unit, bomber: Unit, events: GameEvent[]): void {
  fighter.interceptsLeft--;
  const p = roundChance(typeOf(state, fighter).attack, typeOf(state, bomber).defence);
  const rng = new Rng(state.rng);
  const rounds = combatRounds(fighter, bomber, p, rng);
  state.rng = rng.state();
  const [winner, loser] = fighter.hp > 0 ? [fighter, bomber] : [bomber, fighter];
  events.push({ type: 'intercepted', fighter: fighter.id, bomber: bomber.id, rounds, winner: winner.id });
  destroyUnit(state, loser, events);
}

/** Show a player every tile within the recon radius of a tile until their turn ends. */
function reveal(state: GameState, player: PlayerId, centre: Coord): void {
  const owner = state.players.find((p) => p.id === player)!;
  for (const c of tilesWithin(state.map, centre, state.ruleset.air.reconRadius)) {
    if (!owner.revealed.some((r) => coordsEqual(r, c))) owner.revealed.push(c);
  }
}
