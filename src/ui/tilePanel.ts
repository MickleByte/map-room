/** Describes the selected tile: terrain, defence, rivers, improvements and any city. */
import { hasRiver, tileAt, type Edge } from '../core/grid';
import type { Coord, GameState } from '../core/types';
import { el } from './dom';

export class TilePanel {
  readonly element = el('section', { className: 'panel tile-panel' });

  show(state: GameState, c: Coord | null): void {
    this.element.replaceChildren();
    this.element.hidden = !c;
    if (!c) return;

    const tile = tileAt(state.map, c);
    const terrain = state.ruleset.terrain[tile.terrain]!;
    const rivers = (['NE', 'SE', 'SW', 'NW'] as Edge[]).filter((e) => hasRiver(state.map, c, e));
    const improvements = [
      tile.rail ? 'Rail' : tile.road ? 'Road' : null,
      tile.fortress ? 'Fortress' : null,
    ].filter(Boolean);

    const rows: [string, string][] = [
      ['Movement', terrain.domain === 'sea' ? 'Sea' : `${terrain.moveCost} MP`],
      ['Defence', terrain.defenceBonus ? `+${Math.round(terrain.defenceBonus * 100)}%` : '—'],
    ];
    if (rivers.length) rows.push(['River', `${rivers.join(', ')} edge${rivers.length > 1 ? 's' : ''}`]);
    if (improvements.length) rows.push(['Built', improvements.join(', ')]);

    const city = Object.values(state.cities).find((ct) => ct.pos.x === c.x && ct.pos.y === c.y);
    if (city) {
      const owner = state.players.find((p) => p.id === city.owner);
      rows.push(['City', `${city.name} (${owner?.name ?? city.owner})`]);
      rows.push(['Size', `${city.size}${city.walls ? ', walls' : ''}`]);
    }

    this.element.append(
      el('h2', { textContent: terrain.name }),
      el('div', { className: 'coords', textContent: `(${c.x}, ${c.y})` }),
      el('dl', {}, ...rows.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])),
    );
  }
}
