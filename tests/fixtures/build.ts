import { loadScenario, type ScenarioInput } from '../../src/core/scenario';
import type { GameState, Unit } from '../../src/core/types';

/**
 * A two-player (red, blue) test state. The map defaults to 12×12 grassland that does
 * not wrap; pass `terrain` rows to shape it.
 */
export function makeState(opts: {
  terrain?: string[];
  width?: number;
  height?: number;
  wrapX?: boolean;
  units?: ScenarioInput['units'];
  cities?: ScenarioInput['cities'];
  roads?: [number, number][];
  rails?: [number, number][];
  fortresses?: [number, number][];
  rivers?: ScenarioInput['map']['rivers'];
}): GameState {
  const width = opts.terrain?.[0]?.length ?? opts.width ?? 12;
  const height = opts.terrain?.length ?? opts.height ?? 12;
  return loadScenario({
    id: 'test',
    name: 'Test',
    seed: 1,
    map: {
      width,
      height,
      wrapX: opts.wrapX ?? false,
      terrain: opts.terrain ?? Array.from({ length: height }, () => 'g'.repeat(width)),
      roads: opts.roads ?? [],
      rails: opts.rails ?? [],
      fortresses: opts.fortresses ?? [],
      rivers: opts.rivers ?? [],
    },
    players: [
      { id: 'red', name: 'Red', colour: '#cc3333', control: 'human' },
      { id: 'blue', name: 'Blue', colour: '#3333cc', control: 'ai' },
    ],
    cities: opts.cities ?? [],
    units: opts.units ?? [],
  });
}

/** The first unit matching a type (and owner, if given). */
export function unitOf(state: GameState, type: string, owner?: string): Unit {
  const u = Object.values(state.units).find((x) => x.type === type && (!owner || x.owner === owner));
  if (!u) throw new Error(`no ${type}${owner ? ` for ${owner}` : ''}`);
  return u;
}
