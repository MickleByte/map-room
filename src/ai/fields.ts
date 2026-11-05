/**
 * Travel fields: for every tile, the cheapest cost (in thirds of a movement point) for
 * a unit of one domain to reach the nearest of some goals, ignoring every unit on the
 * map. One field answers "which way to the front?" for all of a player's units at once,
 * where a path search per unit would explore the whole continent each time a route is
 * blocked. Units walk downhill and stop at enemies, which the attack phase deals with.
 */
import { neighbours, tileAt, tileIndex } from '../core/grid';
import { stepCost } from '../core/movement';
import { Board } from '../core/state';
import type { Coord, GameState, Unit } from '../core/types';

export class Field {
  constructor(
    private readonly state: GameState,
    private readonly costs: Float64Array,
    /** Steps to the goal along the cheapest route, so free rail steps still lead somewhere. */
    private readonly hops: Float64Array,
  ) {}

  /** Thirds to the nearest goal from a tile, or Infinity if none can be reached. */
  cost(c: Coord): number {
    return this.costs[tileIndex(this.state.map, c)]!;
  }

  /** Whether a is nearer a goal than b: cheaper, or as cheap in fewer steps. */
  private nearer(a: Coord, b: Coord): boolean {
    const i = tileIndex(this.state.map, a);
    const j = tileIndex(this.state.map, b);
    return (
      this.costs[i]! < this.costs[j]! || (this.costs[i] === this.costs[j] && this.hops[i]! < this.hops[j]!)
    );
  }

  /** The neighbours of a tile that lead nearer a goal, the best first. */
  downhill(from: Coord, unit: Unit, board: Board): Coord[] {
    return neighbours(this.state.map, from)
      .filter((to) => Number.isFinite(this.cost(to)) && this.nearer(to, from))
      .map((to) => ({ to, via: this.cost(to) + stepCost(this.state, unit, from, to, board) }))
      .sort((a, b) => a.via - b.via || (this.nearer(a.to, b.to) ? -1 : this.nearer(b.to, a.to) ? 1 : 0))
      .map(({ to }) => to);
  }
}

/**
 * The field of a unit's domain toward some goal tiles: land units cross land, ships
 * cross the sea. Step costs are the unit's own (roads and rails count for land units).
 */
export function travelField(state: GameState, unit: Unit, goals: Coord[]): Field {
  const { map } = state;
  const domain = state.ruleset.unitTypes[unit.type]!.domain;
  const board = new Board(state);
  const costs = new Float64Array(map.tiles.length).fill(Infinity);
  const hops = new Float64Array(map.tiles.length).fill(Infinity);
  const passable = (c: Coord) => state.ruleset.terrain[tileAt(map, c).terrain]!.domain === domain;

  // Dijkstra outward from the goals over reversed steps (the cost of stepping from n
  // into c), with a bucket per cost: step costs are small whole numbers of thirds.
  const buckets: Coord[][] = [];
  const push = (c: Coord, cost: number) => (buckets[cost] ??= []).push(c);
  for (const g of goals) {
    const i = tileIndex(map, g);
    if (costs[i] === 0) continue;
    costs[i] = 0;
    hops[i] = 0;
    push(g, 0);
  }
  for (let cost = 0; cost < buckets.length; cost++) {
    const bucket = buckets[cost];
    if (!bucket) continue;
    // A free step (rail) adds to the bucket being read, so read it by index.
    for (let k = 0; k < bucket.length; k++) {
      const c = bucket[k]!;
      const ci = tileIndex(map, c);
      if (costs[ci] !== cost) continue;
      for (const n of neighbours(map, c)) {
        if (!passable(n)) continue;
        const i = tileIndex(map, n);
        const via = cost + stepCost(state, unit, n, c, board);
        const steps = hops[ci]! + 1;
        if (via < costs[i]! || (via === costs[i] && steps < hops[i]!)) {
          costs[i] = via;
          hops[i] = steps;
          push(n, via);
        }
      }
    }
  }
  return new Field(state, costs, hops);
}
