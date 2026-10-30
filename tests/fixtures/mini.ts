import type { ScenarioInput } from '../../src/core/scenario';
import type { GameMap } from '../../src/core/types';

/**
 * An 8×6 two-player scenario. Red holds the west, Blue the east.
 * Rows are staggered on screen (odd rows sit half a tile right); terrain is listed by row.
 *
 *     01234567
 *   0 oooooooo
 *   1 ocgggpco     Red city "Redhold" at (2,1), size 3, walls
 *   2 ocghfpco     river on the SE edge of (3,2)
 *   3 ocgmspco     Blue city "Bluehaven" at (5,3), size 8, coastal
 *   4 occcccco
 *   5 oooooooo
 */
export function miniScenario(): ScenarioInput {
  return {
    id: 'mini',
    name: 'Mini',
    seed: 42,
    map: {
      width: 8,
      height: 6,
      wrapX: false,
      terrain: ['oooooooo', 'ocgggpco', 'ocghfpco', 'ocgmspco', 'occcccco', 'oooooooo'],
      rivers: [{ x: 3, y: 2, side: 'SE' }],
      roads: [
        [2, 1],
        [3, 1],
      ],
      rails: [[4, 1]],
      fortresses: [[4, 2]],
    },
    players: [
      { id: 'red', name: 'Red', colour: '#c0392b', control: 'human' },
      { id: 'blue', name: 'Blue', colour: '#2e6fd8', control: 'ai' },
    ],
    cities: [
      { name: 'Redhold', owner: 'red', x: 2, y: 1, size: 3, walls: true, shieldsPerTurn: 10 },
      { name: 'Bluehaven', owner: 'blue', x: 5, y: 3, size: 8, shieldsPerTurn: 12, queue: ['infantry'] },
    ],
    units: [
      { type: 'infantry', owner: 'red', x: 2, y: 1, fortified: true },
      { type: 'fighter', owner: 'red', x: 2, y: 1, veteran: 'veteran' },
      { type: 'transport', owner: 'red', x: 1, y: 2, cargo: [{ type: 'armour' }, { type: 'infantry' }] },
      { type: 'armour', owner: 'blue', x: 5, y: 3 },
      { type: 'destroyer', owner: 'blue', x: 5, y: 3 },
      { type: 'carrier', owner: 'blue', x: 6, y: 3, cargo: [{ type: 'fighter' }] },
    ],
  };
}

/** A featureless map for geometry tests. */
export function blankMap(width: number, height: number, wrapX: boolean): GameMap {
  return {
    width,
    height,
    wrapX,
    tiles: Array.from({ length: width * height }, () => ({
      terrain: 'grassland',
      riverSE: false,
      riverSW: false,
      road: false,
      rail: false,
      fortress: false,
    })),
  };
}
