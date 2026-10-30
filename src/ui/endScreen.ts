/** The victory or defeat screen, shown once the game has a winner. */
import type { GameState, PlayerId } from '../core/types';
import { el } from './dom';

export class EndScreen {
  readonly element = el('div', { className: 'end-screen', hidden: true });
  private dismissed = false;

  constructor(private readonly onNewGame: () => void) {}

  /** `viewer`: the human player, who sees Victory or Defeat; null shows only who won. */
  show(state: GameState, viewer: PlayerId | null): void {
    const winner = state.players.find((p) => p.id === state.winner);
    this.element.hidden = !winner || this.dismissed;
    if (!winner || this.element.childElementCount) return;

    const won = viewer === null || viewer === winner.id;
    const title = viewer === null ? `${winner.name} wins` : won ? 'Victory' : 'Defeat';
    const name = el('span', { className: 'player', textContent: winner.name });
    name.style.color = winner.colour;
    const card = el(
      'section',
      { className: `panel end-card ${won ? 'won' : 'lost'}` },
      el('h1', { textContent: title }),
      el('p', {}, name, ` took every enemy city on turn ${state.turn}.`),
      el(
        'div',
        { className: 'actions' },
        el('button', {
          textContent: 'View the map',
          onclick: () => {
            this.dismissed = true;
            this.element.hidden = true;
          },
        }),
        el('button', { className: 'new-game', textContent: 'New game', onclick: () => this.onNewGame() }),
      ),
    );
    this.element.append(card);
  }
}
