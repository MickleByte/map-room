/**
 * Asks the AI worker to plan a turn. If workers are unavailable the plan is made on
 * the page instead; decide() is pure, so the result is the same either way.
 */
import { decide } from '../ai/decide';
import type { AiRequest, AiResponse } from '../ai/worker';
import type { Action, GameState, PlayerId } from '../core/types';

export class AiClient {
  /** Started on the first request; null once it has failed or could not start. */
  private worker: Worker | null | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (a: Action[]) => void; reject: (e: Error) => void }
  >();

  /** The actions for the player's whole turn. */
  decide(state: GameState, player: PlayerId): Promise<Action[]> {
    const worker = this.start();
    if (!worker) return Promise.resolve(decide(state, player));
    const id = this.nextId++;
    const asked = new Promise<Action[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, state, player } satisfies AiRequest);
    });
    return asked.catch((error: unknown) => {
      console.warn('The AI worker failed; planning on the page instead.', error);
      return decide(state, player);
    });
  }

  private start(): Worker | null {
    if (this.worker !== undefined) return this.worker;
    try {
      this.worker = new Worker(new URL('../ai/worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<AiResponse>) => this.receive(e.data);
      this.worker.onerror = (e) => this.failAll(new Error(e.message || 'The AI worker failed'));
    } catch {
      this.worker = null;
    }
    return this.worker;
  }

  private receive(response: AiResponse): void {
    const waiting = this.pending.get(response.id);
    if (!waiting) return;
    this.pending.delete(response.id);
    if ('error' in response) waiting.reject(new Error(response.error));
    else waiting.resolve(response.actions);
  }

  private failAll(error: Error): void {
    for (const { reject } of this.pending.values()) reject(error);
    this.pending.clear();
    // Plan on the page from now on.
    this.worker?.terminate();
    this.worker = null;
  }
}
