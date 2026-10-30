/** Turn and player readout, the end-turn button, and short messages. */
import { currentPlayer } from '../core/state';
import type { GameState } from '../core/types';
import { el } from './dom';

export class TopBar {
  readonly element = el('header', { className: 'panel top-bar' });
  private readonly info = el('span', { className: 'turn-info' });
  private readonly endButton = el('button', { className: 'end-turn', textContent: 'End turn (Enter)' });
  private readonly toast = el('div', { className: 'toast', hidden: true });
  private toastTimer: number | undefined;

  constructor(scenarioName: string, onEndTurn: () => void) {
    this.endButton.onclick = onEndTurn;
    this.element.append(el('strong', { textContent: scenarioName }), this.info, this.endButton, this.toast);
  }

  show(state: GameState): void {
    const player = currentPlayer(state);
    const name = el('span', { className: 'player', textContent: player.name });
    name.style.color = player.colour;
    this.info.replaceChildren(`Turn ${state.turn} · `, name);
  }

  message(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 3500);
  }
}
