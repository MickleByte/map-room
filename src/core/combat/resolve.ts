/**
 * Attacks: who may attack where, which unit defends, and resolving the combat. An
 * attack is a move that has to fight its way in (ADR-0003): each attack fights the
 * best defender, and once the last one is gone the attacker advances.
 */
import { isAdjacent, normalize } from '../grid';
import { cannotOccupy } from '../movement';
import { Rng } from '../rng';
import { hasEnemyUnits, typeOf, unitsAt } from '../state';
import type { CombatRound, Coord, GameEvent, GameState, Unit } from '../types';
import { destroyUnit, placeUnit } from '../units';
import { defenceOf, type DefenceBreakdown } from './modifiers';
import { roundChance, winChance } from './odds';

/** Why a unit may not attack a tile, or null if it may. */
export function cannotAttack(state: GameState, unit: Unit, target: Coord): string | null {
  const to = normalize(state.map, target);
  if (!to) return 'That tile is off the map';
  const def = typeOf(state, unit);
  if (def.domain === 'air') return 'Aircraft fly missions; they do not attack';
  if (def.attack <= 0) return 'This unit cannot attack';
  if (unit.carriedBy !== null) return 'Units cannot attack from aboard a ship';
  if (!isAdjacent(state.map, unit.pos, to)) return 'Units can only attack an adjacent tile';
  if (!hasEnemyUnits(state, to, unit.owner)) return 'There is no enemy there';
  if (unit.movesLeft <= 0) return 'This unit has no movement left';
  return cannotOccupy(state, unit, to);
}

/**
 * The enemy units that fight for a tile against this attacker: those of the attacker's
 * domain with some defence, not aboard a ship. Ships never defend land and cargo
 * never defends.
 */
export function defendersAt(state: GameState, attacker: Unit, target: Coord): Unit[] {
  const domain = typeOf(state, attacker).domain;
  return unitsAt(state, target).filter((u) => {
    const def = typeOf(state, u);
    return u.owner !== attacker.owner && u.carriedBy === null && def.domain === domain && def.defence > 0;
  });
}

export interface Defender {
  unit: Unit;
  defence: DefenceBreakdown;
}

/**
 * The unit that fights for a tile: the highest defence after modifiers, then the most
 * HP, then the oldest unit. Null when nothing there can defend.
 */
export function bestDefender(state: GameState, attacker: Unit, target: Coord): Defender | null {
  let best: Defender | null = null;
  for (const unit of defendersAt(state, attacker, target).sort((a, b) => a.id - b.id)) {
    const defence = defenceOf(state, unit, attacker.pos);
    const s = best?.defence.strength ?? -1;
    if (defence.strength > s || (defence.strength === s && unit.hp > best!.unit.hp)) {
      best = { unit, defence };
    }
  }
  return best;
}

export interface AttackPreview {
  attack: number;
  /** The unit that would fight, or null if nothing there can defend. */
  defender: Unit | null;
  defence: DefenceBreakdown | null;
  /** The exact chance the attacker wins this combat. */
  odds: number;
  /** Defenders still on the tile after this one; the attacker advances only when this is 0. */
  defendersLeft: number;
}

/** What an attack would face, for the odds tooltip and the AI; or why it isn't allowed. */
export function previewAttack(state: GameState, unit: Unit, target: Coord): AttackPreview | string {
  const why = cannotAttack(state, unit, target);
  if (why) return why;
  const attack = typeOf(state, unit).attack;
  const best = bestDefender(state, unit, target);
  const defendersLeft = Math.max(0, defendersAt(state, unit, target).length - 1);
  if (!best) return { attack, defender: null, defence: null, odds: 1, defendersLeft };
  return {
    attack,
    defender: best.unit,
    defence: best.defence,
    odds: winChance(attack, best.defence.strength, unit.hp, best.unit.hp),
    defendersLeft,
  };
}

/**
 * Carry out a legal attack (see cannotAttack). Fights the best defender, if any; when
 * no defender is left the attacker advances. Mutates a draft state.
 */
export function resolveAttack(state: GameState, attacker: Unit, target: Coord, events: GameEvent[]): void {
  attacker.movesLeft = Math.max(0, attacker.movesLeft - state.ruleset.movement.attackCostThirds);
  attacker.fortified = false;
  attacker.actedThisTurn = true;
  attacker.orders = null;

  const defender = bestDefender(state, attacker, target);
  if (defender) {
    const rng = new Rng(state.rng);
    const won = fight(state, attacker, defender, rng, events);
    state.rng = rng.state();
    if (!won || defendersAt(state, attacker, target).length) return;
  }
  advance(state, attacker, target, events);
}

/** Combat rounds until one side is destroyed. Returns whether the attacker won. */
function fight(state: GameState, attacker: Unit, defender: Defender, rng: Rng, events: GameEvent[]): boolean {
  const attack = typeOf(state, attacker).attack;
  const p = roundChance(attack, defender.defence.strength);
  const target = defender.unit;
  const rounds: CombatRound[] = [];
  while (attacker.hp > 0 && target.hp > 0) {
    if (rng.chance(p)) {
      target.hp--;
      rounds.push('A');
    } else {
      attacker.hp--;
      rounds.push('D');
    }
  }
  const [winner, loser] = attacker.hp > 0 ? [attacker, target] : [target, attacker];
  events.push({
    type: 'combat',
    attacker: attacker.id,
    defender: target.id,
    rounds,
    winner: winner.id,
    attack,
    defence: defender.defence,
  });
  destroyUnit(state, loser, events);
  if (rng.chance(state.ruleset.combat.promotionChance)) promote(state, winner, events);
  return winner === attacker;
}

/** Move up one veteran level, gaining the extra HP that comes with it. */
function promote(state: GameState, unit: Unit, events: GameEvent[]): void {
  const levels = state.ruleset.veteranLevels;
  const i = levels.findIndex((l) => l.id === unit.veteran);
  const next = levels[i + 1];
  if (!next) return;
  unit.hp += next.hp - levels[i]!.hp;
  unit.veteran = next.id;
  events.push({ type: 'unitPromoted', unitId: unit.id, to: next.id });
}

/**
 * Take a tile whose last defender is gone: units that can't defend are captured,
 * ships and aircraft (with any cargo) are destroyed, and the attacker moves in.
 */
function advance(state: GameState, attacker: Unit, target: Coord, events: GameEvent[]): void {
  const domain = typeOf(state, attacker).domain;
  const enemies = unitsAt(state, target)
    .filter((u) => u.owner !== attacker.owner && u.carriedBy === null)
    .sort((a, b) => a.id - b.id);
  for (const unit of enemies) {
    if (typeOf(state, unit).domain === domain) {
      unit.owner = attacker.owner;
      unit.movesLeft = 0;
      unit.fortified = false;
      unit.orders = null;
      events.push({ type: 'unitCaptured', unitId: unit.id, newOwner: attacker.owner });
    } else {
      destroyUnit(state, unit, events);
    }
  }
  placeUnit(state, attacker, target, events);
}
