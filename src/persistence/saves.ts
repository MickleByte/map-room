/**
 * Named save slots in this browser's IndexedDB, plus the autosave slot. Each slot holds
 * a whole SaveFile; a small summary per slot is kept alongside so listing the slots
 * doesn't read every game.
 */
import { currentPlayer } from '../core/state';
import { ImportError, parseSave, type SaveFile } from './files';

/** The slot overwritten at the start of each human turn. */
export const AUTOSAVE = 'Autosave';

export interface SaveSummary {
  name: string;
  savedAt: string;
  scenarioName: string;
  turn: number;
  /** Whose turn it is in the saved game. */
  player: string;
}

const DB_NAME = 'map-room';
const SAVES = 'saves';
const SUMMARIES = 'summaries';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore(SAVES, { keyPath: 'name' });
      db.createObjectStore(SUMMARIES, { keyPath: 'name' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the save database'));
    request.onblocked = () => reject(new Error('The save database is open in another tab'));
  });
}

/** Run one transaction and resolve with `result()` once it has committed. */
async function transact<T>(
  mode: IDBTransactionMode,
  work: (saves: IDBObjectStore, summaries: IDBObjectStore) => () => T,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction([SAVES, SUMMARIES], mode);
      const result = work(tx.objectStore(SAVES), tx.objectStore(SUMMARIES));
      tx.oncomplete = () => resolve(result());
      tx.onerror = () => reject(tx.error ?? new Error('The save database failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Saving was cancelled'));
    });
  } finally {
    db.close();
  }
}

export function summarise(save: SaveFile): SaveSummary {
  return {
    name: save.name,
    savedAt: save.savedAt,
    scenarioName: save.scenario.name,
    turn: save.state.turn,
    player: currentPlayer(save.state).name,
  };
}

/** Store a save in its named slot, replacing any save of the same name. */
export function writeSave(save: SaveFile): Promise<void> {
  return transact('readwrite', (saves, summaries) => {
    saves.put(save);
    summaries.put(summarise(save));
    return () => undefined;
  });
}

/** Every slot, the autosave first and then the newest first. */
export async function listSaves(): Promise<SaveSummary[]> {
  const all = await transact('readonly', (_, summaries) => {
    const request = summaries.getAll();
    return () => request.result as SaveSummary[];
  });
  const rank = (s: SaveSummary) => (s.name === AUTOSAVE ? 0 : 1);
  return all.sort((a, b) => rank(a) - rank(b) || b.savedAt.localeCompare(a.savedAt));
}

/** Read a slot back. Its shape is checked, but it is trusted not to need a replay. */
export async function readSave(name: string): Promise<SaveFile> {
  const stored = await transact('readonly', (saves) => {
    const request = saves.get(name);
    return () => request.result as unknown;
  });
  if (stored === undefined) throw new ImportError(`There is no save called "${name}"`);
  return parseSave(stored, { verify: false });
}

export function deleteSave(name: string): Promise<void> {
  return transact('readwrite', (saves, summaries) => {
    saves.delete(name);
    summaries.delete(name);
    return () => undefined;
  });
}
