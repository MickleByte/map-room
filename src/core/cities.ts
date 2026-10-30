/** City rules: production and capture. Functions that take events mutate a draft state. */
import { neighbours, tileAt } from './grid';
import { unitType } from './ruleset';
import type { City, GameEvent, GameState, PlayerId, UnitTypeId } from './types';
import { newUnit } from './units';

/**
 * A city taken by an enemy unit: it changes owner, loses 1 size, and loses its queue
 * along with the shields stored toward it. It keeps its walls.
 */
export function captureCity(city: City, newOwner: PlayerId, events: GameEvent[]): void {
  city.owner = newOwner;
  city.size = Math.max(1, city.size - 1);
  city.queue = [];
  city.repeat = false;
  city.shieldsStored = 0;
  events.push({ type: 'cityCaptured', cityId: city.id, newOwner });
}

/** Whether a city has a sea tile next to it, so it can build ships. */
export function isCoastal(state: GameState, city: City): boolean {
  return neighbours(state.map, city.pos).some(
    (n) => state.ruleset.terrain[tileAt(state.map, n).terrain]!.domain === 'sea',
  );
}

/** Why a city cannot build a unit type, or null if it can. */
export function cannotBuild(state: GameState, city: City, type: UnitTypeId): string | null {
  const def = state.ruleset.unitTypes[type];
  if (!def) return `Unknown unit type "${type}"`;
  if (def.domain === 'sea' && !isCoastal(state, city))
    return `${city.name} is not on the coast, so it cannot build ${article(def.name)} ${def.name}`;
  return null;
}

/**
 * How many of the owner's turn starts until the first queued unit is built (1 = at the
 * start of their next turn), or null if the queue is empty or it never will be.
 */
export function turnsToBuild(state: GameState, city: City): number | null {
  const next = city.queue[0];
  if (next === undefined) return null;
  const needed = unitType(state.ruleset, next).cost - city.shieldsStored;
  if (needed <= 0) return 1;
  if (city.shieldsPerTurn <= 0) return null;
  return Math.max(1, Math.ceil(needed / city.shieldsPerTurn));
}

const article = (name: string) => (/^[AEIOU]/i.test(name) ? 'an' : 'a');

/**
 * A city's work at the start of its owner's turn: add this turn's shields and, once
 * they cover the first queued unit, build it in the city. Leftover shields carry over.
 */
export function runProduction(state: GameState, city: City, events: GameEvent[]): void {
  const next = city.queue[0];
  if (next === undefined) return;
  city.shieldsStored += city.shieldsPerTurn;
  const cost = unitType(state.ruleset, next).cost;
  if (city.shieldsStored < cost) return;
  city.shieldsStored -= cost;
  // With repeat on, the last item stays queued and is built again.
  if (city.queue.length > 1 || !city.repeat) city.queue.shift();

  const unit = newUnit(state.ruleset, state.nextId++, next, city.owner, city.pos);
  if (unitType(state.ruleset, next).domain === 'air') unit.base = { kind: 'city', id: city.id };
  state.units[unit.id] = unit;
  events.push({ type: 'unitBuilt', unitId: unit.id, cityId: city.id });
}
