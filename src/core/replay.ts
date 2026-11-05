/**
 * Replaying an action log (ADR-0004). Because applyAction is pure and the RNG lives in
 * the state, replaying a game's log from its initial state rebuilds its current state
 * exactly; saves are checked this way when they are imported.
 */
import { applyAction } from './reducer';
import type { Action, GameState } from './types';

export type ReplayResult =
  | { ok: true; state: GameState }
  /** `index`: the position in the log of the action the rules refused. */
  | { ok: false; index: number; reason: string };

export function replay(initial: GameState, actions: readonly Action[]): ReplayResult {
  let state = initial;
  for (let index = 0; index < actions.length; index++) {
    const result = applyAction(state, actions[index]!);
    if (!result.ok) return { ok: false, index, reason: result.reason };
    state = result.state;
  }
  return { ok: true, state };
}

/**
 * The dotted path of the first value that differs between two plain-data trees, or
 * null when they are equal. Key order is ignored and a missing key counts as undefined,
 * so a state survives a trip through JSON unchanged.
 */
export function firstDifference(a: unknown, b: unknown, path = ''): string | null {
  if (Object.is(a, b) || (a === 0 && b === 0)) return null;
  const here = path || '(root)';
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return here;
  if (Array.isArray(a) !== Array.isArray(b)) return here;
  const at = (key: string) => (path ? `${path}.${key}` : key);
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) return at('length');
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const diff = firstDifference(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      at(key),
    );
    if (diff) return diff;
  }
  return null;
}
