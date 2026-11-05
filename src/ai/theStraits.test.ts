/**
 * The Straits played by the AI on both sides, through decide() and the reducer: its
 * forces meet on every front within the first turns, and the game is played out to a
 * victory, the Milestone 1 "done when".
 */
import { describe, expect, it } from 'vitest';
import { applyAction } from '../core/reducer';
import { loadScenario } from '../core/scenario';
import { typeOf } from '../core/state';
import type { GameEvent, GameState } from '../core/types';
import straits from '../data/scenarios/the-straits.json';
import { decide } from './decide';

/**
 * Let the AI play every turn until someone wins or `rounds` rounds have passed. Each
 * action's events are passed to `seen`, with the state they happened in.
 */
function playOut(rounds: number, seen: (before: GameState, events: GameEvent[]) => void = () => {}) {
  let state = loadScenario(straits);
  while (!state.winner && state.turn <= rounds) {
    for (const action of decide(state, state.players[state.currentPlayer]!.id)) {
      const result = applyAction(state, action);
      if (!result.ok) throw new Error(`The AI chose an illegal action: ${result.reason}`);
      seen(state, result.events);
      state = result.state;
    }
  }
  return state;
}

describe('The Straits, AI against AI', () => {
  it('brings land, artillery, air and sea combat into play in the first turns', () => {
    const kinds = new Set<string>();
    playOut(3, (before, events) => {
      const domain = (id: number) => typeOf(before, before.units[id]!).domain;
      for (const e of events) {
        if (e.type === 'combat') kinds.add(`${domain(e.attacker)} combat`);
        if (e.type === 'bombarded') kinds.add(`${domain(e.unitId)} bombard`);
      }
    });
    expect([...kinds]).toEqual(
      expect.arrayContaining(['air bombard', 'land bombard', 'land combat', 'sea bombard', 'sea combat']),
    );
  }, 60_000);

  it('is played out to a victory', () => {
    const state = playOut(100);
    expect(state.winner).not.toBeNull();
    expect(Object.values(state.cities).every((c) => c.owner === state.winner)).toBe(true);
  }, 300_000); // a whole game: under a minute alone, much longer on a busy machine
});
