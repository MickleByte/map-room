/** The combat log: a running list of fights, bombards, promotions and captures. */
import { typeOf } from '../core/state';
import type { GameEvent, GameState, PlayerId, UnitId } from '../core/types';
import { el } from './dom';
import { capitalise, formatStrength } from './format';

const MAX_ENTRIES = 30;

/**
 * Plain-text lines for the combat-related events of one action. Units are looked up in
 * the state from before the action, since some of them no longer exist after it.
 */
export function describeEvents(before: GameState, events: GameEvent[]): string[] {
  const playerName = (id: string) => before.players.find((p) => p.id === id)?.name ?? id;
  const unitName = (id: UnitId) => {
    const u = before.units[id];
    return u ? `${playerName(u.owner)} ${typeOf(before, u).name}` : `Unit ${id}`;
  };
  const fought = new Set<UnitId>();
  const lines: string[] = [];

  for (const e of events) {
    switch (e.type) {
      case 'combat': {
        fought.add(e.attacker).add(e.defender);
        const won = e.rounds.filter((r) => r === 'A').length;
        const lost = e.rounds.length - won;
        const verb = e.winner === e.attacker ? 'defeated' : 'was destroyed attacking';
        lines.push(
          `${unitName(e.attacker)} (${formatStrength(e.attack)}) ${verb} ${unitName(e.defender)} ` +
            `(${formatStrength(e.defence.strength)}), winning ${won} round${won === 1 ? '' : 's'} to ${lost}.`,
        );
        break;
      }
      case 'intercepted': {
        fought.add(e.fighter).add(e.bomber);
        const won = e.rounds.filter((r) => r === 'A').length;
        const lost = e.rounds.length - won;
        const what =
          e.winner === e.fighter
            ? `intercepted and shot down ${unitName(e.bomber)}`
            : `intercepted ${unitName(e.bomber)} and was shot down`;
        lines.push(`${unitName(e.fighter)} ${what}, winning ${won} round${won === 1 ? '' : 's'} to ${lost}.`);
        break;
      }
      case 'bombarded': {
        const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
        const damage = e.damage ? `${e.damage} HP lost` : 'no damage';
        lines.push(
          `${unitName(e.unitId)} (${formatStrength(e.strength)}) bombarded ${unitName(e.target)} ` +
            `(${formatStrength(e.defence.strength)}): ${count(e.hits, 'hit', 'hits')}, ` +
            `${count(e.misses, 'miss', 'misses')}, ${damage}.`,
        );
        break;
      }
      case 'unitPromoted':
        lines.push(`${unitName(e.unitId)} was promoted to ${capitalise(e.to)}.`);
        break;
      case 'unitCaptured':
        lines.push(`${playerName(e.newOwner)} captured ${unitName(e.unitId)}.`);
        break;
      case 'unitDestroyed': {
        if (fought.has(e.unitId)) break;
        const ship = before.units[e.unitId]?.carriedBy;
        lines.push(
          ship != null
            ? `${unitName(e.unitId)} went down with ${unitName(ship)}.`
            : `${unitName(e.unitId)} was destroyed.`,
        );
        break;
      }
      case 'cityCaptured':
        lines.push(`${playerName(e.newOwner)} captured ${before.cities[e.cityId]?.name ?? 'a city'}.`);
        break;
      case 'gameWon':
        lines.push(`${playerName(e.winner)} has taken every enemy city and won the game.`);
        break;
    }
  }
  return lines;
}

/**
 * "City built Unit." for each unit finished in the viewer's cities (every city when
 * `viewer` is null). Units are looked up in the state from after the action.
 */
export function describeBuilt(after: GameState, events: GameEvent[], viewer: PlayerId | null): string[] {
  return events.flatMap((e) => {
    if (e.type !== 'unitBuilt') return [];
    const city = after.cities[e.cityId];
    const unit = after.units[e.unitId];
    if (!city || !unit || (viewer !== null && unit.owner !== viewer)) return [];
    return [`${city.name} built ${typeOf(after, unit).name}.`];
  });
}

export class CombatLog {
  readonly element = el('section', { className: 'panel combat-log', hidden: true });
  private readonly list = el('ol');

  constructor() {
    this.element.append(el('h2', { textContent: 'Combat log' }), this.list);
  }

  add(lines: string[]): void {
    if (!lines.length) return;
    for (const old of this.list.querySelectorAll('.latest')) old.classList.remove('latest');
    // Newest first, keeping the lines of one action in order.
    this.list.prepend(...lines.map((line) => el('li', { className: 'latest', textContent: line })));
    while (this.list.children.length > MAX_ENTRIES) this.list.lastElementChild!.remove();
    this.element.hidden = false;
  }
}
