/**
 * Web Worker wrapper around decide(), so planning the AI's turn never blocks the page.
 * The page posts a state and a player; the worker answers with the turn's actions.
 */
import type { Action, GameState, PlayerId } from '../core/types';
import { decide, type AiOptions } from './decide';

export interface AiRequest {
  id: number;
  state: GameState;
  player: PlayerId;
  options?: Partial<AiOptions>;
}

export type AiResponse = { id: number; actions: Action[] } | { id: number; error: string };

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const { id, state, player, options } = e.data;
  let response: AiResponse;
  try {
    response = { id, actions: decide(state, player, options) };
  } catch (err) {
    response = { id, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(response);
};
