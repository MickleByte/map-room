/**
 * The game menu: save to a named slot, load, export or delete slots, export the game
 * or its scenario as JSON, import a JSON save or scenario, and start a new game.
 */
import { el } from './dom';

export interface SlotSummary {
  name: string;
  savedAt: string;
  scenarioName: string;
  turn: number;
  player: string;
}

/** Each may reject; the menu shows the error's message. */
export interface MenuActions {
  list(): Promise<SlotSummary[]>;
  save(name: string): Promise<void>;
  load(name: string): Promise<void>;
  remove(name: string): Promise<void>;
  exportSlot(name: string): Promise<void>;
  exportGame(): void;
  exportScenario(): void;
  importText(text: string): Promise<void>;
  newGame(): Promise<void>;
}

export class GameMenu {
  readonly element = el('div', { className: 'menu-screen', hidden: true });
  private readonly nameInput = el('input', {
    className: 'save-name',
    type: 'text',
    placeholder: 'Save name',
    maxLength: 60,
  });
  private readonly slots = el('ul', { className: 'slots' });
  private readonly note = el('p', { className: 'menu-message', hidden: true });
  private readonly fileInput = el('input', { type: 'file', accept: '.json,application/json', hidden: true });

  constructor(private readonly actions: MenuActions) {
    const saveForm = el(
      'form',
      { className: 'save-form' },
      this.nameInput,
      el('button', { type: 'submit', className: 'primary', textContent: 'Save' }),
    );
    saveForm.onsubmit = (e) => {
      e.preventDefault();
      const name = this.nameInput.value.trim();
      if (!name) return this.show('Give the save a name.', true);
      void this.run(async () => {
        await actions.save(name);
        await this.refreshSlots();
        this.show(`Saved "${name}".`);
      });
    };
    this.fileInput.onchange = () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (!file) return;
      this.show(`Reading ${file.name}…`);
      void this.run(async () => actions.importText(await file.text()));
    };

    const card = el(
      'section',
      { className: 'panel game-menu', role: 'dialog', ariaLabel: 'Game menu' },
      el(
        'header',
        {},
        el('h2', { textContent: 'Game' }),
        el('button', {
          className: 'close',
          textContent: '×',
          title: 'Close (Esc)',
          onclick: () => this.close(),
        }),
      ),
      saveForm,
      el('h3', { textContent: 'Saved games' }),
      this.slots,
      el(
        'div',
        { className: 'actions' },
        el('button', {
          textContent: 'Export game',
          onclick: () => void this.run(async () => actions.exportGame()),
        }),
        el('button', {
          textContent: 'Export scenario',
          onclick: () => void this.run(async () => actions.exportScenario()),
        }),
        el('button', { textContent: 'Import…', onclick: () => this.fileInput.click() }),
        el('button', { textContent: 'New game', onclick: () => void this.run(() => actions.newGame()) }),
      ),
      this.fileInput,
      this.note,
    );
    this.element.append(card);
    // Clicking the dimmed backdrop closes the menu.
    // (A handler property returning false would cancel every click in the menu.)
    this.element.onclick = (e) => {
      if (e.target === this.element) this.close();
    };
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  open(defaultName: string): void {
    this.element.hidden = false;
    this.nameInput.value = defaultName;
    this.note.hidden = true;
    void this.run(() => this.refreshSlots());
  }

  close(): void {
    this.element.hidden = true;
  }

  private async refreshSlots(): Promise<void> {
    const slots = await this.actions.list();
    this.slots.replaceChildren(
      ...(slots.length
        ? slots.map((s) => this.slotRow(s))
        : [el('li', { className: 'empty', textContent: 'No saved games yet.' })]),
    );
  }

  private slotRow(slot: SlotSummary): HTMLLIElement {
    const when = new Date(slot.savedAt).toLocaleString();
    const button = (text: string, act: () => Promise<void>) =>
      el('button', { textContent: text, onclick: () => void this.run(act) });
    return el(
      'li',
      { className: 'slot' },
      el(
        'div',
        { className: 'slot-info' },
        el('strong', { textContent: slot.name }),
        el('span', {
          textContent: `${slot.scenarioName} · Turn ${slot.turn}, ${slot.player} to move · ${when}`,
        }),
      ),
      button('Load', () => this.actions.load(slot.name)),
      button('Export', () => this.actions.exportSlot(slot.name)),
      button('Delete', async () => {
        await this.actions.remove(slot.name);
        await this.refreshSlots();
      }),
    );
  }

  /** Run a menu action, showing what went wrong if it fails. */
  private async run(act: () => Promise<void>): Promise<void> {
    try {
      await act();
    } catch (e) {
      this.show(e instanceof Error ? e.message : String(e), true);
    }
  }

  private show(text: string, error = false): void {
    this.note.textContent = text;
    this.note.classList.toggle('error', error);
    this.note.hidden = false;
  }
}

/** Offer text to the viewer as a file download. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A file name made from a save or scenario name. */
export function fileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug || 'map-room'}.json`;
}
