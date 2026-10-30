/**
 * The selected city's production: shields, the queue (with remove buttons), a unit type
 * picker to add to it, and the repeat switch. Only shown for the player's own cities.
 */
import { cannotBuild, turnsToBuild } from '../core/cities';
import type { City, CityId, GameState, UnitTypeId } from '../core/types';
import { el } from './dom';

export type SetProduction = (cityId: CityId, queue: UnitTypeId[], repeat: boolean) => void;

export class CityPanel {
  readonly element = el('section', { className: 'panel city-panel', hidden: true });
  /** The unit type last added, kept selected so it can be added again quickly. */
  private lastChoice: UnitTypeId | null = null;

  constructor(private readonly setProduction: SetProduction) {}

  show(state: GameState, city: City | null): void {
    this.element.replaceChildren();
    this.element.hidden = !city;
    if (!city) return;
    const { ruleset } = state;
    const set = (queue: UnitTypeId[], repeat = city.repeat) => this.setProduction(city.id, queue, repeat);

    const next = city.queue[0];
    const cost = next ? ruleset.unitTypes[next]!.cost : null;
    const turns = turnsToBuild(state, city);
    const shields = el('div', {
      className: 'shields',
      textContent:
        `Shields ${city.shieldsStored}${cost !== null ? ` / ${cost}` : ''}` +
        ` (+${city.shieldsPerTurn} a turn)`,
    });
    const eta = el('div', {
      className: 'eta',
      textContent: !next
        ? 'Nothing queued: shields are not being collected.'
        : turns === null
          ? `${ruleset.unitTypes[next]!.name} will never finish.`
          : `${ruleset.unitTypes[next]!.name} ${turns === 1 ? 'next turn' : `in ${turns} turns`}`,
    });

    const queue = el('ol', { className: 'queue' });
    city.queue.forEach((type, i) => {
      const remove = el('button', {
        className: 'remove',
        textContent: '×',
        title: 'Remove from the queue',
        onclick: () => set(city.queue.filter((_, j) => j !== i)),
      });
      queue.append(el('li', {}, el('span', { textContent: ruleset.unitTypes[type]!.name }), remove));
    });

    this.element.append(
      el('h2', { textContent: city.name }),
      el('div', { className: 'meta', textContent: `Size ${city.size}${city.walls ? ' · walls' : ''}` }),
      shields,
      eta,
      queue,
    );

    const repeat = el('input', {
      type: 'checkbox',
      checked: city.repeat,
      onchange: () => set(city.queue, repeat.checked),
    });
    const choice = el('select', { title: 'Unit type to add' });
    for (const [id, def] of Object.entries(ruleset.unitTypes)) {
      const why = cannotBuild(state, city, id);
      choice.append(
        el('option', {
          value: id,
          disabled: !!why,
          title: why ?? '',
          textContent: `${def.name} (${def.cost})${why ? (def.domain === 'sea' ? ': coastal cities only' : ': unavailable') : ''}`,
        }),
      );
    }
    if (this.lastChoice && !cannotBuild(state, city, this.lastChoice)) choice.value = this.lastChoice;
    const add = el('button', {
      className: 'add',
      textContent: 'Add',
      onclick: () => {
        this.lastChoice = choice.value;
        set([...city.queue, choice.value]);
      },
    });
    this.element.append(
      el('div', { className: 'add-row' }, choice, add),
      el('label', { className: 'repeat' }, repeat, ' Repeat the last item'),
    );
  }
}
