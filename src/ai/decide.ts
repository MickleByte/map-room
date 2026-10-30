/**
 * The AI opponent: decide(state, player) plans a whole turn as ordinary Actions.
 *
 * It plays each action it chooses through the pure reducer on its own copy of the
 * state before choosing the next, so later choices see the results of earlier ones
 * (combat included). The reducer is deterministic and the RNG lives in the state
 * (ADR-0004), so applying the same actions for real gives exactly the same game. The
 * AI has no randomness of its own.
 */
import {
  cannotDrop,
  cannotParadrop,
  cannotPatrol,
  cannotSortie,
  missionRange,
  previewMission,
  rebaseTargets,
  type AirBase,
} from '../core/combat/air';
import { bombardRange, hasBombard, previewBombard } from '../core/combat/bombard';
import { previewAttack } from '../core/combat/resolve';
import { coordsEqual, distance, neighbours } from '../core/grid';
import { findPath } from '../core/movement';
import { cannotBuild } from '../core/cities';
import { applyAction } from '../core/reducer';
import { currentPlayer, hasEnemyUnits, typeOf, unitsOf } from '../core/state';
import type { Action, City, Coord, GameState, PlayerId, Unit, UnitId, UnitTypeId } from '../core/types';
import {
  canStrike,
  expectedDamage,
  garrisonOf,
  isDefender,
  roleOf,
  roleValue,
  threatTo,
  type Role,
} from './evaluate';

export interface AiOptions {
  /** The lowest chance of winning a combat for which the AI attacks. */
  attackOdds: number;
}

export const defaultAiOptions: AiOptions = { attackOdds: 0.65 };

/** Plans one turn for a player; the last action ends the turn. Nothing if it is not their turn. */
export function decide(state: GameState, player: PlayerId, options: Partial<AiOptions> = {}): Action[] {
  if (state.winner || currentPlayer(state).id !== player) return [];
  const plan = new Plan(state, player, { ...defaultAiOptions, ...options });
  garrison(plan);
  bombard(plan);
  bomb(plan);
  attack(plan);
  advance(plan);
  bombard(plan);
  attack(plan);
  patrol(plan);
  fortifyGarrisons(plan);
  produce(plan);
  plan.do({ type: 'endTurn' });
  return plan.actions;
}

/** The actions chosen so far and the state they lead to. */
class Plan {
  readonly actions: Action[] = [];
  /** Units holding a city this turn: they stay put and do not attack out. */
  readonly reserved = new Set<UnitId>();

  constructor(
    public state: GameState,
    readonly player: PlayerId,
    readonly options: AiOptions,
  ) {}

  /** Apply an action to the planning state; it is kept only if the reducer accepts it. */
  do(action: Action): boolean {
    if (this.state.winner) return false;
    const result = applyAction(this.state, action);
    if (!result.ok) return false;
    this.state = result.state;
    this.actions.push(action);
    return true;
  }

  /** The player's cities as they stand now, oldest first. */
  cities(): City[] {
    return Object.values(this.state.cities)
      .filter((c) => c.owner === this.player)
      .sort((a, b) => a.id - b.id);
  }

  /** The player's units as they stand now, oldest first. */
  units(): Unit[] {
    return unitsOf(this.state, this.player).sort((a, b) => a.id - b.id);
  }
}

/**
 * Keep every city held: its best defender stays (two when an enemy that could take it
 * is near), and an empty or thin garrison is topped up by the strongest defender that
 * can get there this turn. Threatened cities are seen to first, the closest threat first.
 */
function garrison(plan: Plan): void {
  const cities = plan
    .cities()
    .map((city) => ({ city, threat: threatTo(plan.state, city) }))
    .sort((a, b) => (a.threat ?? Infinity) - (b.threat ?? Infinity) || a.city.id - b.city.id);
  // Every city keeps its best defender before any is sent elsewhere.
  for (const { city } of cities) {
    const best = garrisonOf(plan.state, city)[0];
    if (best) plan.reserved.add(best.id);
  }
  for (const { city, threat } of cities) {
    const want = threat === null ? 1 : 2;
    const here = garrisonOf(plan.state, city);
    for (const unit of here.slice(0, want)) plan.reserved.add(unit.id);
    for (let missing = want - here.length; missing > 0; missing--) {
      const helper = reinforcement(plan, city);
      if (!helper) break;
      plan.reserved.add(helper.id);
      walk(plan, helper, city.pos);
    }
  }
}

/** The strongest free defender that can reach a city this turn (the nearest on a tie). */
function reinforcement(plan: Plan, city: City): Unit | null {
  let best: { unit: Unit; defence: number; steps: number } | null = null;
  for (const unit of plan.units()) {
    if (plan.reserved.has(unit.id) || unit.movesLeft <= 0 || !isDefender(plan.state, unit)) continue;
    if (distance(plan.state.map, unit.pos, city.pos) > MAX_REINFORCE_DISTANCE) continue;
    const path = findPath(plan.state, unit, city.pos);
    if (!path?.length || path.some((s) => s.turn > 0)) continue;
    const defence = typeOf(plan.state, unit).defence;
    if (!best || defence > best.defence || (defence === best.defence && path.length < best.steps))
      best = { unit, defence, steps: path.length };
  }
  return best?.unit ?? null;
}

/** How far to look for units that might reach a city this turn (rails make some trips long). */
const MAX_REINFORCE_DISTANCE = 12;

/**
 * Move a unit along its route as far as it gets this turn, or until `done` says it is
 * close enough. Returns whether it arrived.
 */
function walk(plan: Plan, unit: Unit, target: Coord, done?: (u: Unit) => boolean): boolean {
  const path = findPath(plan.state, unit, target);
  if (!path) return false;
  for (const step of path) {
    const now = plan.state.units[unit.id];
    if (!now || step.turn > 0 || done?.(now)) return false;
    if (!plan.do({ type: 'move', unitId: unit.id, to: step.pos })) return false;
  }
  return true;
}

/** Garrisons that can still act dig in. */
function fortifyGarrisons(plan: Plan): void {
  for (const unit of plan.units()) {
    if (plan.reserved.has(unit.id) && !unit.fortified && unit.movesLeft > 0)
      plan.do({ type: 'fortify', unitId: unit.id });
  }
}

/**
 * Every gun that can reach an enemy fires at the best target in range: the most
 * damage expected, doubled where one of our units could attack the tile afterwards.
 */
function bombard(plan: Plan): void {
  for (const gun of plan.units()) {
    const unit = plan.state.units[gun.id];
    if (!unit || !hasBombard(typeOf(plan.state, unit))) continue;
    let best: { target: Coord; score: number } | null = null;
    for (const target of bombardRange(plan.state, unit)) {
      const preview = previewBombard(plan.state, unit, target);
      if (typeof preview === 'string') continue;
      const damage = expectedDamage(preview);
      if (damage <= 0) continue;
      const score = damage * (canStrike(plan.state, plan.player, target) ? 2 : 1);
      if (!best || score > best.score) best = { target, score };
    }
    if (best) plan.do({ type: 'bombard', unitId: unit.id, target: best.target });
  }
}

/**
 * Bombers fly against the target in range where they expect to do the most damage,
 * weighted by what the target cost to build. With nothing in range they move closer
 * to the nearest enemy city.
 */
function bomb(plan: Plan): void {
  for (const { id } of plan.units()) {
    const unit = plan.state.units[id];
    if (!unit) continue;
    const def = typeOf(plan.state, unit);
    if (def.domain !== 'air' || def.airSuperiority || cannotSortie(plan.state, unit)) continue;
    let best: { target: Coord; score: number } | null = null;
    for (const target of missionRange(plan.state, unit)) {
      if (!hasEnemyUnits(plan.state, target, plan.player)) continue;
      const preview = previewMission(plan.state, unit, target);
      if (typeof preview === 'string') continue;
      const damage = expectedDamage(preview);
      if (damage <= 0) continue;
      const score = damage * typeOf(plan.state, preview.target).cost;
      if (!best || score > best.score) best = { target, score };
    }
    if (best) plan.do({ type: 'airMission', unitId: unit.id, mission: 'bomb', target: best.target });
    else {
      const goals = Object.values(plan.state.cities).filter((c) => c.owner !== plan.player);
      rebaseToward(
        plan,
        unit,
        goals.map((c) => c.pos),
      );
    }
  }
}

/**
 * Fighters fly air superiority, which covers their operational range through the
 * enemy's turn. A fighter too far from every threatened city rebases closer instead.
 */
function patrol(plan: Plan): void {
  const threatened = plan.cities().filter((c) => threatTo(plan.state, c) !== null);
  for (const { id } of plan.units()) {
    const unit = plan.state.units[id];
    if (!unit || cannotPatrol(plan.state, unit)) continue;
    const range = typeOf(plan.state, unit).operationalRange;
    const covered = threatened.some((c) => distance(plan.state.map, unit.pos, c.pos) <= range);
    if (
      threatened.length &&
      !covered &&
      rebaseToward(
        plan,
        unit,
        threatened.map((c) => c.pos),
      )
    )
      continue;
    plan.do({ type: 'airSuperiority', unitId: unit.id });
  }
}

/** Rebase an aircraft to the base nearest one of some goals, if that is nearer than where it is. */
function rebaseToward(plan: Plan, unit: Unit, goals: Coord[]): boolean {
  if (!goals.length) return false;
  const gap = (c: Coord) => Math.min(...goals.map((g) => distance(plan.state.map, c, g)));
  let best: { to: AirBase; gap: number } | null = null;
  for (const to of rebaseTargets(plan.state, unit)) {
    const pos = to.kind === 'city' ? plan.state.cities[to.id]!.pos : plan.state.units[to.id]!.pos;
    const g = gap(pos);
    if (g < gap(unit.pos) && (!best || g < best.gap)) best = { to, gap: g };
  }
  return !!best && plan.do({ type: 'rebase', unitId: unit.id, to: best.to });
}

/**
 * Land units not holding a city head for the nearest enemy city: into it if it is
 * empty, otherwise to the tile beside it that is quickest to reach. Guns stop once
 * the city is within their bombard range. Paratroopers drop into empty enemy cities
 * in reach.
 */
function advance(plan: Plan): void {
  for (const { id } of plan.units()) {
    const unit = plan.state.units[id];
    if (!unit || plan.reserved.has(id) || unit.carriedBy !== null || unit.movesLeft <= 0) continue;
    const def = typeOf(plan.state, unit);
    if (def.domain !== 'land') continue;
    if (paradrop(plan, unit)) continue;
    const stopAt = def.attack > 0 ? 0 : def.bombardRange;
    for (const goal of enemyCitiesByDistance(plan, unit.pos)) {
      if (distance(plan.state.map, unit.pos, goal.pos) <= stopAt) break;
      const dest = approach(plan, unit, goal);
      if (!dest) continue;
      walk(plan, unit, dest, (u) => distance(plan.state.map, u.pos, goal.pos) <= stopAt);
      break;
    }
  }
}

/** Drop a paratrooper into an empty enemy city it can reach. Returns whether it dropped. */
function paradrop(plan: Plan, unit: Unit): boolean {
  if (cannotDrop(plan.state, unit)) return false;
  const target = Object.values(plan.state.cities)
    .filter((c) => c.owner !== plan.player && !cannotParadrop(plan.state, unit, c.pos))
    .sort((a, b) => a.id - b.id)[0];
  return !!target && plan.do({ type: 'paradrop', unitId: unit.id, to: target.pos });
}

/** Enemy cities, nearest first (oldest first on a tie). */
function enemyCitiesByDistance(plan: Plan, from: Coord): City[] {
  const d = (c: City) => distance(plan.state.map, from, c.pos);
  return Object.values(plan.state.cities)
    .filter((c) => c.owner !== plan.player)
    .sort((a, b) => d(a) - d(b) || a.id - b.id);
}

/** Where a unit should head to go after a city: the city if nobody holds it, else the quickest tile next to it. */
function approach(plan: Plan, unit: Unit, city: City): Coord | null {
  if (!hasEnemyUnits(plan.state, city.pos, plan.player))
    return findPath(plan.state, unit, city.pos) ? city.pos : null;
  let best: { to: Coord; turns: number; steps: number } | null = null;
  for (const n of neighbours(plan.state.map, city.pos)) {
    // Already beside it: stay and wait for a better chance to attack.
    if (coordsEqual(n, unit.pos)) return unit.pos;
    const path = findPath(plan.state, unit, n);
    if (!path) continue;
    const turns = path.at(-1)?.turn ?? 0;
    if (!best || turns < best.turns || (turns === best.turns && path.length < best.steps))
      best = { to: n, turns, steps: path.length };
  }
  return best?.to ?? null;
}

/**
 * Cities with nothing queued build to fill the biggest gap: a defender where the
 * garrison is short, else a gun when there are fewer than one per two attackers,
 * else an attacker. Each is the land type that gives the most of that role per shield.
 */
function produce(plan: Plan): void {
  const land = plan.units().filter((u) => typeOf(plan.state, u).domain === 'land');
  let attackers = land.filter((u) => roleOf(typeOf(plan.state, u)) === 'attacker').length;
  let guns = land.filter((u) => roleOf(typeOf(plan.state, u)) === 'gun').length;
  for (const city of plan.cities()) {
    if (city.queue.length) continue;
    const want = threatTo(plan.state, city) === null ? 1 : 2;
    let role: Role;
    if (garrisonOf(plan.state, city).length < want) role = 'defender';
    else if (guns * 2 < attackers) role = 'gun';
    else role = 'attacker';
    const type = bestBuild(plan.state, city, role);
    if (!type || !plan.do({ type: 'setProduction', cityId: city.id, queue: [type], repeat: false })) continue;
    if (role === 'gun') guns++;
    if (role === 'attacker') attackers++;
  }
}

/** The land unit type a city can build that gives the most of a role per shield (cheapest on a tie). */
function bestBuild(state: GameState, city: City, role: Role): UnitTypeId | null {
  let best: { id: UnitTypeId; value: number; cost: number } | null = null;
  for (const [id, def] of Object.entries(state.ruleset.unitTypes)) {
    if (def.domain !== 'land' || cannotBuild(state, city, id)) continue;
    const value = roleValue(def, role) / def.cost;
    if (value <= 0) continue;
    if (!best || value > best.value || (value === best.value && def.cost < best.cost))
      best = { id, value, cost: def.cost };
  }
  return best?.id ?? null;
}

/** Attack, best odds first, while some attack has at least the threshold chance of winning. */
function attack(plan: Plan): void {
  for (;;) {
    let best: { unit: Unit; target: Coord; odds: number } | null = null;
    for (const unit of plan.units()) {
      if (plan.reserved.has(unit.id)) continue;
      for (const target of neighbours(plan.state.map, unit.pos)) {
        if (!hasEnemyUnits(plan.state, target, plan.player)) continue;
        const preview = previewAttack(plan.state, unit, target);
        if (typeof preview === 'string' || preview.odds < plan.options.attackOdds) continue;
        if (!best || preview.odds > best.odds) best = { unit, target, odds: preview.odds };
      }
    }
    if (!best || !plan.do({ type: 'attack', unitId: best.unit.id, target: best.target })) return;
  }
}
