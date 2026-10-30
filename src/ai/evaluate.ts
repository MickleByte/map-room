/** Read-only judgements the AI makes about a position: threats, garrisons and targets. */
import { hasBombard, type BombardPreview } from '../core/combat/bombard';
import { cannotAttack } from '../core/combat/resolve';
import { distance, neighbours } from '../core/grid';
import type { UnitTypeDef } from '../core/ruleset';
import { typeOf, unitsAt } from '../core/state';
import type { City, Coord, GameState, PlayerId, Unit } from '../core/types';

/** How close (in tiles) an enemy that can take cities must be for a city to count as threatened. */
export const THREAT_RADIUS = 3;

/** Whether one of a player's units next to a tile could attack it now. */
export function canStrike(state: GameState, player: PlayerId, target: Coord): boolean {
  return neighbours(state.map, target).some((n) =>
    unitsAt(state, n).some((u) => u.owner === player && !cannotAttack(state, u, target)),
  );
}

/** Whether a unit can hold a city: a land unit with some defence, not aboard a ship. */
export function isDefender(state: GameState, unit: Unit): boolean {
  const def = typeOf(state, unit);
  return def.domain === 'land' && def.defence > 0 && unit.carriedBy === null;
}

/** The owner's units that would defend a city, strongest first. */
export function garrisonOf(state: GameState, city: City): Unit[] {
  return unitsAt(state, city.pos)
    .filter((u) => u.owner === city.owner && isDefender(state, u))
    .sort((a, b) => typeOf(state, b).defence - typeOf(state, a).defence || a.id - b.id);
}

/** The nearest distance of an enemy unit that could take the city, or null if none is close. */
export function threatTo(state: GameState, city: City): number | null {
  let nearest: number | null = null;
  for (const u of Object.values(state.units)) {
    if (u.owner === city.owner || u.carriedBy !== null) continue;
    const def = typeOf(state, u);
    if (def.domain !== 'land' || !def.canCaptureCities) continue;
    const d = distance(state.map, u.pos, city.pos);
    if (d <= THREAT_RADIUS && (nearest === null || d < nearest)) nearest = d;
  }
  return nearest;
}

/** What the AI builds a land unit for. */
export type Role = 'defender' | 'attacker' | 'gun';

/** A land type's main role: guns bombard, attackers hit at least as hard as they defend. */
export function roleOf(def: UnitTypeDef): Role {
  if (hasBombard(def)) return 'gun';
  return def.attack >= def.defence ? 'attacker' : 'defender';
}

/** How much a land type offers in a role, before cost. */
export function roleValue(def: UnitTypeDef, role: Role): number {
  switch (role) {
    case 'defender':
      return def.defence;
    case 'attacker':
      return def.canCaptureCities ? def.attack : 0;
    case 'gun':
      return hasBombard(def) ? def.bombardStrength * def.rateOfFire : 0;
  }
}

/** The HP a bombard or bombing run is expected to take off its target, allowing for the 1 HP floor. */
export function expectedDamage(preview: BombardPreview): number {
  const floor = preview.lethal ? 0 : 1;
  return Math.max(0, Math.min(preview.hitChance * preview.shots, preview.target.hp - floor));
}
