/**
 * Bombardment: a ranged strike on the best defender of a tile (see bombardTarget). Each
 * round of the rate of fire hits with bombard strength against modified defence. The
 * target can't fire back, nobody is promoted, and only `lethalBombard` units can kill
 * (ADR-0003).
 */
import { coordsEqual, distance, normalize, tileAt, tilesWithin } from '../grid';
import { isAircraft, type UnitTypeDef } from '../ruleset';
import { withRng } from '../rng';
import { typeOf, unitsAt } from '../state';
import type { Coord, GameEvent, GameState, Unit } from '../types';
import { destroyUnit } from '../units';
import { roundChance } from './odds';
import type { DefenceBreakdown } from './modifiers';
import { strongest, type Defender } from './resolve';

/** Whether a unit type has a ground or naval bombard. Aircraft bomb on missions instead. */
export function hasBombard(def: UnitTypeDef): boolean {
  return !isAircraft(def) && def.bombardStrength > 0 && def.bombardRange > 0 && def.rateOfFire > 0;
}

/** Why a unit may not bombard a tile, or null if it may. */
export function cannotBombard(state: GameState, unit: Unit, target: Coord): string | null {
  const to = normalize(state.map, target);
  if (!to) return 'That tile is off the map';
  const def = typeOf(state, unit);
  if (isAircraft(def)) return 'Aircraft bomb on air missions';
  if (!hasBombard(def)) return 'This unit cannot bombard';
  if (unit.carriedBy !== null) return 'Units cannot bombard from aboard a ship';
  if (distance(state.map, unit.pos, to) > def.bombardRange) return 'That tile is out of range';
  if (!bombardTarget(state, unit, to)) return 'There is no enemy there';
  if (unit.movesLeft <= 0) return 'This unit has no movement left';
  return null;
}

/**
 * The unit a bombard or bombing run on this tile would hit: the enemy with the highest
 * modified defence among those of the tile's own domain (land units on land, ships at
 * sea), as with an attack's best defender. Ships and aircraft in a city never shield its
 * land units; they are hit only when no enemy land unit is there. Cargo is never hit.
 * Null if there is no enemy.
 */
export function bombardTarget(state: GameState, unit: Unit, target: Coord): Defender | null {
  const exposed = unitsAt(state, target).filter((u) => u.owner !== unit.owner && u.carriedBy === null);
  const domain = state.ruleset.terrain[tileAt(state.map, target).terrain]!.domain;
  const shield = exposed.filter((u) => typeOf(state, u).domain === domain);
  return strongest(state, shield.length ? shield : exposed, unit.pos);
}

/** The tiles a unit's bombard reaches, its own excluded; none if it has no bombard or is aboard a ship. */
export function bombardRange(state: GameState, unit: Unit): Coord[] {
  const def = typeOf(state, unit);
  if (!hasBombard(def) || unit.carriedBy !== null) return [];
  return tilesWithin(state.map, unit.pos, def.bombardRange).filter((c) => !coordsEqual(c, unit.pos));
}

export interface BombardPreview {
  strength: number;
  target: Unit;
  defence: DefenceBreakdown;
  /** The chance that each shot hits. */
  hitChance: number;
  /** The rate of fire. */
  shots: number;
  /** Whether the bombard can destroy its target; otherwise it stops at 1 HP. */
  lethal: boolean;
}

/** What a bombard would face, for the tooltip and the AI; or why it isn't allowed. */
export function previewBombard(state: GameState, unit: Unit, target: Coord): BombardPreview | string {
  const why = cannotBombard(state, unit, target);
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

/** Carry out a legal bombard (see cannotBombard) of an on-map tile. Mutates a draft state. */
export function resolveBombard(state: GameState, unit: Unit, to: Coord, events: GameEvent[]): void {
  unit.movesLeft = 0;
  unit.fortified = false;
  unit.actedThisTurn = true;
  unit.orders = null;
  fireShots(state, unit, bombardTarget(state, unit, to)!, events);
}

/**
 * Fire a unit's rate of fire at a target with its bombard strength, one RNG draw per
 * shot, and report it with a `bombarded` event. Shared by bombards and bombing
 * missions. Mutates a draft state.
 */
export function fireShots(state: GameState, unit: Unit, victim: Defender, events: GameEvent[]): void {
  const def = typeOf(state, unit);
  const p = roundChance(def.bombardStrength, victim.defence.strength);
  const floor = def.lethalBombard ? 0 : 1;
  const target = victim.unit;
  let hits = 0;
  let misses = 0;
  let damage = 0;
  withRng(state, (rng) => {
    // A lethal bombard stops once its target is destroyed.
    for (let i = 0; i < def.rateOfFire && target.hp > 0; i++) {
      if (!rng.chance(p)) {
        misses++;
        continue;
      }
      hits++;
      if (target.hp > floor) {
        target.hp--;
        damage++;
      }
    }
  });
  events.push({
    type: 'bombarded',
    unitId: unit.id,
    target: target.id,
    hits,
    misses,
    damage,
    strength: def.bombardStrength,
    defence: victim.defence,
  });
  if (target.hp <= 0) destroyUnit(state, target, events);
}
