/**
 * Movement rules: which tiles a unit may enter, what each step costs, and
 * multi-turn pathfinding. Costs are in thirds of a movement point.
 */
import { cannotBoardAt } from './cargo';
import { neighbours, tileAt, tileIndex } from './grid';
import { THIRDS_PER_MP } from './ruleset';
import { Board, typeOf } from './state';
import type { Coord, GameState, MoveThirds, Unit } from './types';

/** Why a unit may not move into a tile, or null if it may (ignoring movement left). */
export function cannotEnter(
  state: GameState,
  unit: Unit,
  to: Coord,
  board: Board = new Board(state),
): string | null {
  const why = cannotOccupy(state, unit, to, board);
  if (why) return why;
  if (!board.hasEnemy(to, unit.owner)) return null;
  // No amphibious assault: cargo can't fight its way ashore.
  return unit.carriedBy !== null
    ? 'Units cannot attack from aboard a ship'
    : 'An enemy is there; attack instead';
}

/**
 * Why a unit could not stand on a tile once any enemies there were gone, or null if
 * it could. This is also the attack rule: a unit may only attack tiles it could
 * occupy (ADR-0003).
 */
export function cannotOccupy(
  state: GameState,
  unit: Unit,
  to: Coord,
  board: Board = new Board(state),
): string | null {
  const def = typeOf(state, unit);
  const terrain = state.ruleset.terrain[tileAt(state.map, to).terrain]!;
  const city = board.cityAt(to);

  if (def.domain === 'air') return 'Aircraft fly missions or rebase; they do not move';
  if (def.domain === 'land' && terrain.domain !== 'land') {
    // Only by boarding a friendly transport. Enemy ships are never boarded, so this
    // also keeps land units from attacking ships at sea (ADR-0003).
    const noShip = 'Land units cannot enter the sea';
    if (!board.hasOwn(to, unit.owner)) return noShip;
    const why = cannotBoardAt(state, unit, to, noShip);
    if (why) return why;
  }
  if (def.domain === 'sea' && terrain.domain !== 'sea' && !(city && city.owner === unit.owner))
    return 'Ships can only enter the sea or a friendly city';
  if (city && city.owner !== unit.owner && !def.canCaptureCities) return 'This unit cannot capture cities';
  return null;
}

/** Cities count as having a road. */
function hasRoad(board: Board, c: Coord): boolean {
  return tileAt(board.state.map, c).road || !!board.cityAt(c);
}

/** Full cost in thirds of stepping from one tile into an adjacent one. */
export function stepCost(
  state: GameState,
  unit: Unit,
  from: Coord,
  to: Coord,
  board: Board = new Board(state),
): MoveThirds {
  const { movement } = state.ruleset;
  if (typeOf(state, unit).domain === 'land') {
    if (tileAt(state.map, from).rail && tileAt(state.map, to).rail) return movement.railCostThirds;
    if (hasRoad(board, from) && hasRoad(board, to)) return movement.roadCostThirds;
  }
  return state.ruleset.terrain[tileAt(state.map, to).terrain]!.moveCost * THIRDS_PER_MP;
}

/** What a step actually uses: a unit may always enter while it has movement left, using the rest. */
export function stepUses(state: GameState, unit: Unit, from: Coord, to: Coord): MoveThirds {
  return Math.min(stepCost(state, unit, from, to), unit.movesLeft);
}

export function fullMoves(state: GameState, unit: Unit): MoveThirds {
  return typeOf(state, unit).movement * THIRDS_PER_MP;
}

export interface PathStep {
  pos: Coord;
  /** 0 = reached this turn, 1 = next turn, … */
  turn: number;
}

/**
 * Cheapest route for a unit to a target over as many turns as needed, or null if
 * there is none. Time is counted in thirds used, with each turn refilling the unit's
 * movement; ties go to the route with fewer steps.
 */
export function findPath(state: GameState, unit: Unit, target: Coord): PathStep[] | null {
  const full = fullMoves(state, unit);
  if (full === 0) return null;
  const { map } = state;
  const start = unit.pos;
  const goal = tileIndex(map, target);
  if (goal === tileIndex(map, start)) return [];
  const board = new Board(state);
  if (cannotEnter(state, unit, target, board)) return null;

  // t = thirds of time elapsed; the unit has (full - t mod full) left at time t.
  const t0 = full - unit.movesLeft;
  const best = new Map<number, { t: number; steps: number; turn: number; prev: number; pos: Coord }>();
  best.set(tileIndex(map, start), { t: t0, steps: 0, turn: 0, prev: -1, pos: start });
  const heap = new MinHeap<{ t: number; steps: number; idx: number }>(
    (a, b) => a.t - b.t || a.steps - b.steps,
  );
  heap.push({ t: t0, steps: 0, idx: tileIndex(map, start) });

  while (heap.size) {
    const cur = heap.pop()!;
    const node = best.get(cur.idx)!;
    if (cur.t !== node.t || cur.steps !== node.steps) continue;
    if (cur.idx === goal) break;
    const left = full - (cur.t % full);
    for (const n of neighbours(map, node.pos)) {
      const idx = tileIndex(map, n);
      if (idx !== goal && cannotEnter(state, unit, n, board)) continue;
      const t = cur.t + Math.min(stepCost(state, unit, node.pos, n, board), left);
      const steps = cur.steps + 1;
      const seen = best.get(idx);
      if (seen && (seen.t < t || (seen.t === t && seen.steps <= steps))) continue;
      // A step is taken in the turn the unit still has movement for: floor(time before / full).
      best.set(idx, { t, steps, turn: Math.floor(cur.t / full), prev: cur.idx, pos: n });
      heap.push({ t, steps, idx });
    }
  }

  const end = best.get(goal);
  if (!end) return null;
  const path: PathStep[] = [];
  for (let node = end; node.prev !== -1; node = best.get(node.prev)!) {
    path.push({ pos: node.pos, turn: node.turn });
  }
  return path.reverse();
}

class MinHeap<T> {
  private items: T[] = [];
  constructor(private readonly less: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(item: T): void {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.less(a[i]!, a[p]!) >= 0) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }

  pop(): T | undefined {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length && last !== undefined) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l]!, a[m]!) < 0) m = l;
        if (r < a.length && this.less(a[r]!, a[m]!) < 0) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}
