/**
 * Games and their JSON files. A save holds the scenario it started from, the initial
 * state, the action log and a snapshot of the current state (ADR-0004). Imported files
 * are validated with zod, and an imported save's log must replay to its snapshot.
 */
import { z } from 'zod';
import { firstDifference, replay } from '../core/replay';
import { formatIssues } from '../core/ruleset';
import { loadScenario, ScenarioError, scenarioSchema, type Scenario } from '../core/scenario';
import { actionSchema, gameStateSchema } from '../core/schema';
import type { Action, GameState } from '../core/types';

/** A game in progress: where it started, everything done since, and where it is now. */
export interface Game {
  scenario: Scenario;
  initialState: GameState;
  /** Every action applied since the scenario started, in order. */
  actions: Action[];
  /** Must equal replay(initialState, actions). */
  state: GameState;
}

export const SCHEMA_VERSION = 1;

export interface SaveFile extends Game {
  schemaVersion: typeof SCHEMA_VERSION;
  name: string;
  /** ISO time, set here and never by core. */
  savedAt: string;
}

const saveSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  name: z.string().min(1),
  savedAt: z.string(),
  scenario: scenarioSchema,
  initialState: gameStateSchema,
  actions: z.array(actionSchema),
  state: gameStateSchema,
});

/** A file or stored save that can't be used; `issues` lists every problem found. */
export class ImportError extends Error {
  constructor(
    readonly title: string,
    readonly issues: string[] = [],
  ) {
    super(issues.length ? `${title}:\n${issues.map((i) => `  - ${i}`).join('\n')}` : title);
  }
}

/** Start a game from scenario JSON. Throws ScenarioError if the scenario is invalid. */
export function newGame(json: unknown): Game {
  const parsed = scenarioSchema.safeParse(json);
  if (!parsed.success) throw new ScenarioError(formatIssues(parsed.error));
  const state = loadScenario(parsed.data);
  return { scenario: parsed.data, initialState: state, actions: [], state };
}

/** A save of a game as it stands, stamped with the current time unless `savedAt` is given. */
export function createSave(game: Game, name: string, savedAt = new Date().toISOString()): SaveFile {
  return {
    schemaVersion: SCHEMA_VERSION,
    name,
    savedAt,
    scenario: game.scenario,
    initialState: game.initialState,
    actions: [...game.actions],
    state: game.state,
  };
}

export function saveToJson(save: SaveFile): string {
  return JSON.stringify(save);
}

/** The scenario a game started from, as a file that starts a new game when imported. */
export function scenarioToJson(scenario: Scenario): string {
  return JSON.stringify(scenario, null, 2);
}

/**
 * Check a save's shape. With `verify`, also replay its log and require the snapshot to
 * match; saves read back from this browser's own storage skip that, so loading stays
 * instant.
 */
export function parseSave(json: unknown, { verify }: { verify: boolean }): SaveFile {
  const version = (json as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof version === 'number' && version !== SCHEMA_VERSION)
    throw new ImportError('Invalid save', [
      `this save uses schema version ${version}, but this version of Map Room reads version ${SCHEMA_VERSION}`,
    ]);
  const parsed = saveSchema.safeParse(json);
  if (!parsed.success) throw new ImportError('Invalid save', formatIssues(parsed.error));
  const save = parsed.data;
  if (verify) {
    const replayed = replay(save.initialState, save.actions);
    if (!replayed.ok) {
      const action = save.actions[replayed.index]!;
      throw new ImportError('Invalid save', [
        `actions[${replayed.index}] (${action.type}) was refused: ${replayed.reason}`,
      ]);
    }
    const diff = firstDifference(replayed.state, save.state, 'state');
    if (diff)
      throw new ImportError('Invalid save', [
        `the action log does not replay to the saved state (first difference at ${diff})`,
      ]);
    // Play on from the replayed state, which is exactly what the reducer produces.
    save.state = replayed.state;
  }
  return save;
}

export type Imported = { kind: 'save'; save: SaveFile } | { kind: 'scenario'; game: Game };

/** Read an imported file: a save (verified by replay) or a scenario (a new game). */
export function parseImport(text: string): Imported {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new ImportError(`This file is not valid JSON: ${(e as Error).message}`);
  }
  if (isSaveLike(json)) return { kind: 'save', save: parseSave(json, { verify: true }) };
  try {
    return { kind: 'scenario', game: newGame(json) };
  } catch (e) {
    if (e instanceof ScenarioError) throw new ImportError('Invalid scenario', e.issues);
    throw e;
  }
}

function isSaveLike(json: unknown): boolean {
  return (
    typeof json === 'object' &&
    json !== null &&
    ('initialState' in json || 'actions' in json || 'savedAt' in json)
  );
}
