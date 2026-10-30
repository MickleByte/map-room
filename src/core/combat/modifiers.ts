/**
 * The defence modifier stack, itemised so the UI can show where a defender's strength
 * comes from. Bonuses add together, then multiply the base defence once.
 */
import { isRiverCrossing, tileAt } from '../grid';
import { cityAt, typeOf } from '../state';
import type { Coord, GameState, Unit } from '../types';

export interface Modifier {
  label: string;
  /** A fraction: 0.5 is +50%. */
  bonus: number;
}

export interface DefenceBreakdown {
  base: number;
  items: Modifier[];
  /** 1 + the sum of every bonus. */
  multiplier: number;
  strength: number;
}

/** A unit's defence against an attack coming from the adjacent tile `from`. */
export function defenceOf(state: GameState, unit: Unit, from: Coord): DefenceBreakdown {
  const { combat } = state.ruleset;
  const tile = tileAt(state.map, unit.pos);
  const terrain = state.ruleset.terrain[tile.terrain]!;
  const def = typeOf(state, unit);
  const items: Modifier[] = [];
  const add = (label: string, bonus: number) => bonus > 0 && items.push({ label, bonus });

  add(terrain.name, terrain.defenceBonus);
  if (isRiverCrossing(state.map, from, unit.pos)) add('River', combat.riverBonus);
  if (def.domain === 'land' && (unit.fortified || tile.fortress)) add('Fortified', combat.fortifiedBonus);
  if (def.domain === 'land' && tile.fortress) add('Fortress', combat.fortressBonus);

  const city = cityAt(state, unit.pos);
  if (city) {
    const tier = combat.cityTiers.findLast((t) => t.minSize <= city.size)!;
    if (city.walls && tier.wallsBonus > tier.bonus) add('City walls', tier.wallsBonus);
    else add(`City size ${city.size}`, tier.bonus);
  }

  const multiplier = 1 + items.reduce((sum, m) => sum + m.bonus, 0);
  return { base: def.defence, items, multiplier, strength: def.defence * multiplier };
}
