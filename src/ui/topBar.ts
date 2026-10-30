/**
 * Turn and player readout, the end-turn button, the AI playback controls (speed and
 * skip), and short messages.
 */
import { currentPlayer } from '../core/state';
import type { GameState } from '../core/types';
import type { AnimationSpeed } from '../render/animator';
import { el } from './dom';

export interface TopBarActions {
  endTurn: () => void;
  skip: () => void;
  speed: (speed: AnimationSpeed) => void;
}

const SPEEDS: [AnimationSpeed, string][] = [
  ['slow', 'Slow'],
  ['normal', 'Normal'],
  ['fast', 'Fast'],
];

export class TopBar {
  readonly element = el('header', { className: 'panel top-bar' });
  private readonly info = el('span', { className: 'turn-info' });
  private readonly endButton = el('button', { className: 'end-turn', textContent: 'End turn (Enter)' });
  private readonly skipButton = el('button', { className: 'skip', textContent: 'Skip (Esc)', hidden: true });
  private readonly speed = el(
    'select',
    { className: 'ai-speed', title: 'How fast the AI’s turn plays' },
    ...SPEEDS.map(([value, label]) => el('option', { value, textContent: `AI: ${label}` })),
  );
  private readonly toast = el('div', { className: 'toast', hidden: true });
  private toastTimer: number | undefined;
  private aiPlaying = false;

  constructor(scenarioName: string, actions: TopBarActions, speed: AnimationSpeed) {
    this.endButton.onclick = actions.endTurn;
    this.skipButton.onclick = actions.skip;
    this.speed.value = speed;
    this.speed.onchange = () => actions.speed(this.speed.value as AnimationSpeed);
    this.element.append(
      el('strong', { textContent: scenarioName }),
      this.info,
      this.speed,
      this.skipButton,
      this.endButton,
      this.toast,
    );
  }

  show(state: GameState): void {
    const player = currentPlayer(state);
    const name = el('span', { className: 'player', textContent: player.name });
    name.style.color = player.colour;
    const doing = this.aiPlaying ? ' is moving…' : '';
    this.info.replaceChildren(`Turn ${state.turn} · `, name, doing);
    this.endButton.disabled = this.aiPlaying;
    this.skipButton.hidden = !this.aiPlaying;
  }

  /** Switch between the human's controls and the AI-turn controls. */
  setAiPlaying(playing: boolean): void {
    this.aiPlaying = playing;
  }

  message(text: string): void {
    this.toast.textContent = text;
    this.toast.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.hidden = true), 3500);
  }
}
