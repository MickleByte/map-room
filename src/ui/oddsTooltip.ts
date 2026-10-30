/**
 * The tooltip shown when hovering an enemy tile the selected unit could attack or
 * bombard: the exact odds and where the defender's strength comes from.
 */
import type { BombardPreview } from '../core/combat/bombard';
import type { DefenceBreakdown } from '../core/combat/modifiers';
import type { AttackPreview } from '../core/combat/resolve';
import { maxHp } from '../core/ruleset';
import { typeOf } from '../core/state';
import type { GameState, Unit } from '../core/types';
import type { Point } from '../render/iso';
import { el } from './dom';
import { formatPercent, formatStrength } from './format';

export class OddsTooltip {
  readonly element = el('div', { className: 'odds-tip', hidden: true });

  show(state: GameState, attacker: Unit, p: AttackPreview, at: Point): void {
    const rows: [string, string][] = [[typeOf(state, attacker).name, `Attack ${formatStrength(p.attack)}`]];
    let outcome: string;
    if (p.defender && p.defence) {
      rows.push(...this.defenceRows(state, p.defender, p.defence));
      outcome =
        p.defendersLeft > 0
          ? `${p.defendersLeft} more defender${p.defendersLeft > 1 ? 's' : ''} after this one`
          : 'Winning takes the tile';
    } else {
      outcome = 'Nothing here can defend: the tile is taken';
    }

    this.element.replaceChildren(
      el('div', { className: 'odds', textContent: `${formatPercent(p.odds)} to win` }),
      el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])),
      el('div', { className: 'outcome', textContent: outcome }),
    );
    this.place(at);
  }

  /** A bombard: the chance of each shot hitting and where the target's strength comes from. */
  showBombard(state: GameState, unit: Unit, p: BombardPreview, at: Point): void {
    const rows: [string, string][] = [[typeOf(state, unit).name, `Bombard ${formatStrength(p.strength)}`]];
    rows.push(...this.defenceRows(state, p.target, p.defence));
    const outcome = p.lethal ? 'Can destroy the target' : 'The target cannot fall below 1 HP';
    this.element.replaceChildren(
      el('div', { className: 'odds', textContent: `${p.shots} shots at ${formatPercent(p.hitChance)} each` }),
      el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])),
      el('div', { className: 'outcome', textContent: `${outcome}. Uses all remaining movement.` }),
    );
    this.place(at);
  }

  private defenceRows(state: GameState, target: Unit, d: DefenceBreakdown): [string, string][] {
    const rows: [string, string][] = [
      [`vs ${typeOf(state, target).name}`, `${target.hp}/${maxHp(state.ruleset, target.veteran)} HP`],
      ['Defence', formatStrength(d.base)],
    ];
    for (const m of d.items) rows.push([m.label, `+${Math.round(m.bonus * 100)}%`]);
    if (d.items.length)
      rows.push(['Total', `×${formatStrength(d.multiplier)} = ${formatStrength(d.strength)}`]);
    return rows;
  }

  /** An enemy the unit can't attack, and why. */
  showReason(reason: string, at: Point): void {
    this.element.replaceChildren(el('div', { className: 'reason', textContent: reason }));
    this.place(at);
  }

  hide(): void {
    this.element.hidden = true;
  }

  private place(at: Point): void {
    this.element.style.left = `${at.x + 16}px`;
    this.element.style.top = `${at.y + 16}px`;
    this.element.hidden = false;
  }
}
