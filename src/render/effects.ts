/**
 * What the animator shows of an action's events: trails for moves, strikes for
 * fights, bombards, bombing runs and interceptions, and blasts where units fell.
 * Only what the viewer can see is shown, so animating the AI's turn reveals nothing
 * the fog hides.
 */
import type { Coord, GameEvent, GameState, UnitId } from '../core/types';

export type Effect =
  | { kind: 'move'; from: Coord; to: Coord; colour: string }
  | { kind: 'strike'; from: Coord; to: Coord; colour: string }
  | { kind: 'blast'; at: Coord };

/**
 * The effects for one action's events. Units are looked up in the state from before
 * the action, since some of them are gone after it; `canSee` says whether the viewer
 * can see a tile (before or after the action).
 */
export function effectsOf(before: GameState, events: GameEvent[], canSee: (c: Coord) => boolean): Effect[] {
  const pos = (id: UnitId) => before.units[id]?.pos;
  const colour = (id: UnitId) =>
    before.players.find((p) => p.id === before.units[id]?.owner)?.colour ?? '#ffffff';
  const strike = (from: UnitId, to: UnitId): Effect[] => {
    const a = pos(from);
    const b = pos(to);
    return a && b && (canSee(a) || canSee(b))
      ? [{ kind: 'strike', from: a, to: b, colour: colour(from) }]
      : [];
  };
  return events.flatMap((e): Effect[] => {
    switch (e.type) {
      case 'unitMoved':
        return canSee(e.from) || canSee(e.to)
          ? [{ kind: 'move', from: e.from, to: e.to, colour: colour(e.unitId) }]
          : [];
      case 'combat':
        return strike(e.attacker, e.defender);
      case 'bombarded':
        return strike(e.unitId, e.target);
      case 'intercepted':
        return strike(e.fighter, e.bomber);
      case 'unitDestroyed': {
        const at = pos(e.unitId);
        return at && canSee(at) ? [{ kind: 'blast', at }] : [];
      }
      default:
        return [];
    }
  });
}
