/** Lists the visible stack on the selected tile and offers orders for the selected unit. */
import { shipFor } from '../core/cargo';
import { cannotDrop, cannotPatrol } from '../core/combat/air';
import { hasBombard } from '../core/combat/bombard';
import { fullMoves } from '../core/movement';
import { maxHp, type UnitTypeDef } from '../core/ruleset';
import { cargoOf, cityAt, currentPlayer, typeOf } from '../core/state';
import type { Coord, GameState, Unit, UnitId } from '../core/types';
import type { Vision } from '../core/visibility';
import { el } from './dom';
import { capitalise, formatMoves } from './format';

export interface UnitPanelActions {
  select(id: UnitId): void;
  fortify(): void;
  board(): void;
  goAshore(): void;
  airSuperiority(): void;
  /** Start or cancel choosing where to paradrop. */
  paradrop(): void;
  next(): void;
  cancelOrders(): void;
}

export class UnitPanel {
  readonly element = el('section', { className: 'panel unit-panel' });

  constructor(private readonly actions: UnitPanelActions) {}

  /** `dropping`: the selected unit is choosing where to paradrop. */
  show(vision: Vision, tile: Coord | null, selected: UnitId | null, dropping = false): void {
    this.element.replaceChildren();
    const { state } = vision;
    const units = tile ? vision.unitsAt(tile).filter((u) => u.carriedBy === null) : [];
    this.element.hidden = units.length === 0;
    if (!units.length) return;

    const list = el('ul', { className: 'stack' });
    // What an enemy ship carries is hidden, unless fog is off.
    const sees = (u: Unit) => vision.player === null || u.owner === vision.player;
    for (const u of units.sort((a, b) => a.id - b.id)) {
      list.append(this.row(state, u, selected, false, sees(u)));
      if (sees(u)) for (const c of cargoOf(state, u.id)) list.append(this.row(state, c, selected, true));
    }
    this.element.append(
      el('h2', { textContent: units.length > 1 ? `Stack of ${units.length}` : 'Unit' }),
      list,
    );

    const unit = selected !== null ? state.units[selected] : undefined;
    if (unit && unit.owner === currentPlayer(state).id) {
      const buttons = el('div', { className: 'actions' });
      if (typeOf(state, unit).domain === 'land' && !unit.fortified && unit.carriedBy === null) {
        buttons.append(el('button', { textContent: 'Fortify (F)', onclick: () => this.actions.fortify() }));
      }
      const port = cityAt(state, unit.pos);
      if (port && unit.carriedBy === null && shipFor(state, unit, unit.pos)) {
        buttons.append(el('button', { textContent: 'Board (B)', onclick: () => this.actions.board() }));
      }
      if (port && unit.carriedBy !== null && typeOf(state, unit).domain === 'land') {
        buttons.append(el('button', { textContent: 'Go ashore', onclick: () => this.actions.goAshore() }));
      }
      if (!cannotPatrol(state, unit)) {
        buttons.append(
          el('button', { textContent: 'Air superiority (A)', onclick: () => this.actions.airSuperiority() }),
        );
      }
      if (!cannotDrop(state, unit)) {
        buttons.append(
          el('button', {
            textContent: dropping ? 'Cancel paradrop' : 'Paradrop (P)',
            onclick: () => this.actions.paradrop(),
          }),
        );
      }
      if (unit.orders) {
        buttons.append(
          el('button', { textContent: 'Cancel go-to', onclick: () => this.actions.cancelOrders() }),
        );
      }
      buttons.append(el('button', { textContent: 'Next unit (N)', onclick: () => this.actions.next() }));
      this.element.append(
        buttons,
        el('p', {
          className: 'hint',
          textContent: hint(state, unit, dropping),
        }),
      );
    }
  }

  private row(
    state: GameState,
    u: Unit,
    selected: UnitId | null,
    cargo = false,
    showHold = true,
  ): HTMLElement {
    const def = typeOf(state, u);
    const owner = state.players.find((p) => p.id === u.owner)!;
    // An enemy fighter's stance is not the player's to see.
    const mine = u.owner === currentPlayer(state).id;
    const sortie = u.stance === 'airSuperiority' ? 'Air superiority' : u.actedThisTurn ? 'Flown' : null;
    const status = [
      mine && def.domain === 'air' ? sortie : null,
      u.justParadropped ? 'Dropped' : null,
      u.fortified ? 'Fortified' : null,
      u.orders ? 'Go-to' : null,
      cargo ? 'Aboard' : null,
      def.cargo && showHold ? `Cargo ${cargoOf(state, u.id).length}/${def.cargo.capacity}` : null,
    ].filter(Boolean);
    const moves =
      def.domain === 'air' ? 'Air' : `${formatMoves(u.movesLeft)}/${formatMoves(fullMoves(state, u))} MP`;

    const swatch = el('span', { className: 'swatch' });
    swatch.style.background = owner.colour;
    const item = el(
      'li',
      {
        className: `unit-row${u.id === selected ? ' selected' : ''}${cargo ? ' cargo' : ''}`,
        onclick: () => this.actions.select(u.id),
      },
      swatch,
      el('span', { className: 'name', textContent: def.name }),
      el('span', { className: 'meta', textContent: `${u.hp}/${maxHp(state.ruleset, u.veteran)} HP` }),
      el('span', { className: 'meta', textContent: capitalise(u.veteran) }),
      el('span', { className: 'meta', textContent: moves }),
    );
    if (status.length) item.append(el('span', { className: 'status', textContent: status.join(' · ') }));
    item.title = `${def.name}: attack ${def.attack}, defence ${def.defence}, movement ${def.movement}`;
    return item;
  }
}

/** How to give the selected unit orders with the mouse. */
function hint(state: GameState, unit: Unit, dropping: boolean): string {
  const def = typeOf(state, unit);
  if (def.domain === 'air') return airHint(state, unit);
  if (dropping) return 'Right-click a tile in the green zone to drop there. Esc cancels.';
  if (!cannotDrop(state, unit)) {
    return `${attackHint(def)} Or paradrop (P) up to ${def.paradropRange} tiles from this city.`;
  }
  if (unit.carriedBy !== null) {
    return def.domain === 'land'
      ? 'Aboard ship. Right-click adjacent land to go ashore (not onto enemies), or another transport to change ships.'
      : 'Aboard ship. It sails with the carrier.';
  }
  if (def.cargo) {
    return `Carries up to ${def.cargo.capacity} ${def.cargo.domain === 'land' ? 'land units' : 'aircraft'}. ${attackHint(def)}`;
  }
  return attackHint(def);
}

function airHint(state: GameState, unit: Unit): string {
  const def = typeOf(state, unit);
  if (unit.stance === 'airSuperiority')
    return `On air superiority until your next turn: it intercepts the first enemy bomber flying a mission within ${def.operationalRange} tiles.`;
  if (unit.actedThisTurn) return 'This aircraft has flown this turn.';
  const bomb = def.bombardStrength > 0 ? 'an enemy to bomb it, ' : '';
  const patrol = def.airSuperiority ? ' Or put it on air superiority (A) to guard against bombers.' : '';
  return `Right-click in the blue range: ${bomb}a friendly city or carrier to rebase there, or any other tile to fly recon.${patrol}`;
}

function attackHint(def: UnitTypeDef): string {
  const attacks = def.attack > 0 && def.domain !== 'air';
  if (attacks && hasBombard(def))
    return 'Right-click a tile to move there, an adjacent enemy to attack, or an enemy in the red range to bombard.';
  if (hasBombard(def)) return 'Right-click a tile to move there, or an enemy in the red range to bombard.';
  if (!attacks) return 'Right-click a tile to move there.';
  return 'Right-click a tile to move there, or an adjacent enemy to attack.';
}
