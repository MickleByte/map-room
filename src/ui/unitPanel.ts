/** Lists the visible stack on the selected tile and offers orders for the selected unit. */
import { shipFor } from '../core/cargo';
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
  next(): void;
  cancelOrders(): void;
}

export class UnitPanel {
  readonly element = el('section', { className: 'panel unit-panel' });

  constructor(private readonly actions: UnitPanelActions) {}

  show(vision: Vision, tile: Coord | null, selected: UnitId | null): void {
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
          textContent: hint(state, unit),
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
    const status = [
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
function hint(state: GameState, unit: Unit): string {
  const def = typeOf(state, unit);
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

function attackHint(def: UnitTypeDef): string {
  const attacks = def.attack > 0 && def.domain !== 'air';
  if (attacks && hasBombard(def))
    return 'Right-click a tile to move there, an adjacent enemy to attack, or an enemy in the red range to bombard.';
  if (hasBombard(def)) return 'Right-click a tile to move there, or an enemy in the red range to bombard.';
  if (!attacks) return 'Right-click a tile to move there.';
  return 'Right-click a tile to move there, or an adjacent enemy to attack.';
}
