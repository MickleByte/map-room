/**
 * The AI, through its one seam: decide(state, player) gives the actions for a whole
 * turn, which must all be legal when applied in order through the reducer.
 */
import { describe, expect, it } from 'vitest';
import { makeState } from '../../tests/fixtures/build';
import { applyActions } from '../core/reducer';
import { loadScenario } from '../core/scenario';
import sandbox from '../data/scenarios/sandbox.json';
import type { Action, GameState } from '../core/types';
import { decide } from './decide';

/** Plan Red's turn and apply it, stopping before the closing endTurn so the result can be inspected. */
function playTurn(state: GameState, options?: Parameters<typeof decide>[2]) {
  const actions = decide(state, 'red', options);
  expect(actions.at(-1)).toEqual({ type: 'endTurn' });
  const result = applyActions(state, actions.slice(0, -1));
  if (!result.ok) throw new Error(result.reason);
  return { actions, state: result.state, events: result.events };
}

describe('decide', () => {
  it('ends the turn when there is nothing to do', () => {
    expect(decide(makeState({}), 'red')).toEqual([{ type: 'endTurn' } satisfies Action]);
  });

  it('plans nothing when it is not that player’s turn', () => {
    expect(decide(makeState({}), 'blue')).toEqual([]);
  });

  it('plays whole turns of the sandbox with legal actions, the same way every time', () => {
    let state = loadScenario(sandbox);
    for (let turn = 0; turn < 8 && !state.winner; turn++) {
      const player = state.players[state.currentPlayer]!.id;
      const actions = decide(state, player);
      expect(decide(state, player)).toEqual(actions);
      expect(actions.at(-1)).toEqual({ type: 'endTurn' });
      const result = applyActions(state, actions);
      if (!result.ok) throw new Error(result.reason);
      state = result.state;
    }
    expect(state.turn).toBeGreaterThan(1);
  });
});

/** The strikes in a plan, in order, as "type unitType→x,y". */
function strikes(state: GameState, actions: Action[]): string[] {
  return actions.flatMap((a) =>
    a.type === 'attack' || a.type === 'bombard'
      ? [`${a.type} ${state.units[a.unitId]!.type}→${a.target.x},${a.target.y}`]
      : [],
  );
}

describe('bombard before attacking', () => {
  it('shells a target with its guns before its tanks attack it', () => {
    const state = makeState({
      units: [
        { type: 'artillery', owner: 'red', x: 2, y: 2 },
        { type: 'armour', owner: 'red', x: 3, y: 2 },
        { type: 'infantry', owner: 'blue', x: 4, y: 2, fortified: true },
      ],
    });
    const { actions } = playTurn(state);
    expect(strikes(state, actions).slice(0, 2)).toEqual(['bombard artillery→4,2', 'attack armour→4,2']);
  });
});

describe('garrisoning threatened cities', () => {
  it('moves a unit into an empty city with an enemy nearby', () => {
    const state = makeState({
      cities: [{ name: 'Home', owner: 'red', x: 2, y: 2, size: 3, shieldsPerTurn: 1 }],
      units: [
        { type: 'mechInfantry', owner: 'red', x: 2, y: 4 },
        { type: 'armour', owner: 'blue', x: 2, y: 7 },
      ],
    });
    const after = playTurn(state).state;
    const garrison = Object.values(after.units).filter(
      (u) => u.owner === 'red' && u.pos.x === 2 && u.pos.y === 2,
    );
    expect(garrison.map((u) => u.type)).toEqual(['mechInfantry']);
    expect(garrison[0]!.fortified).toBe(true);
  });

  it('keeps a city’s only defender at home instead of attacking out', () => {
    const state = makeState({
      cities: [{ name: 'Home', owner: 'red', x: 2, y: 2, size: 3, shieldsPerTurn: 1 }],
      units: [
        { type: 'armour', owner: 'red', x: 2, y: 2 },
        { type: 'infantry', owner: 'blue', x: 3, y: 2, hp: 1 },
      ],
    });
    const { state: after, actions } = playTurn(state);
    expect(strikes(state, actions)).toEqual([]);
    expect(Object.values(after.units).find((u) => u.type === 'armour')!.pos).toEqual({ x: 2, y: 2 });
  });
});

describe('aircraft', () => {
  const missions = (actions: Action[]) =>
    actions.flatMap((a) => (a.type === 'airMission' ? [`${a.mission}→${a.target.x},${a.target.y}`] : []));

  it('sends a bomber against the target in range it can hurt most', () => {
    const state = makeState({
      width: 30,
      cities: [{ name: 'Field', owner: 'red', x: 2, y: 2, size: 3, shieldsPerTurn: 1 }],
      units: [
        { type: 'infantry', owner: 'red', x: 2, y: 2 },
        { type: 'bomber', owner: 'red', x: 2, y: 2 },
        // Already down to 1 HP, so a non-lethal bombing can't hurt it.
        { type: 'infantry', owner: 'blue', x: 5, y: 2, hp: 1 },
        { type: 'armour', owner: 'blue', x: 2, y: 10 },
        // Out of the bomber's range of 10.
        { type: 'armour', owner: 'blue', x: 25, y: 2 },
      ],
    });
    expect(missions(playTurn(state).actions)).toEqual(['bomb→2,10']);
  });

  it('keeps a bomber home with nothing in range', () => {
    const state = makeState({
      width: 30,
      cities: [{ name: 'Field', owner: 'red', x: 2, y: 2, size: 3, shieldsPerTurn: 1 }],
      units: [
        { type: 'bomber', owner: 'red', x: 2, y: 2 },
        { type: 'armour', owner: 'blue', x: 25, y: 2 },
      ],
    });
    expect(missions(playTurn(state).actions)).toEqual([]);
  });

  it('puts a fighter on air superiority over a threatened city', () => {
    const state = makeState({
      cities: [{ name: 'Field', owner: 'red', x: 2, y: 2, size: 3, shieldsPerTurn: 1 }],
      units: [
        { type: 'infantry', owner: 'red', x: 2, y: 2 },
        { type: 'fighter', owner: 'red', x: 2, y: 2 },
        { type: 'armour', owner: 'blue', x: 2, y: 7 },
      ],
    });
    const { actions, state: after } = playTurn(state);
    const fighter = Object.values(after.units).find((u) => u.type === 'fighter')!;
    expect(actions).toContainEqual({ type: 'airSuperiority', unitId: fighter.id });
    expect(fighter.stance).toBe('airSuperiority');
  });

  it('rebases a fighter towards a threatened city out of its range', () => {
    const state = makeState({
      width: 30,
      height: 4,
      cities: [
        { name: 'Rear', owner: 'red', x: 0, y: 2, size: 3, shieldsPerTurn: 1 },
        { name: 'Front', owner: 'red', x: 6, y: 2, size: 3, shieldsPerTurn: 1 },
        { name: 'Far', owner: 'red', x: 20, y: 2, size: 3, shieldsPerTurn: 1 },
      ],
      units: [
        { type: 'infantry', owner: 'red', x: 20, y: 2 },
        { type: 'fighter', owner: 'red', x: 0, y: 2 },
        { type: 'armour', owner: 'blue', x: 22, y: 2 },
      ],
    });
    const { actions } = playTurn(state);
    const front = Object.values(state.cities).find((c) => c.name === 'Front')!;
    const fighter = Object.values(state.units).find((u) => u.type === 'fighter')!;
    expect(actions).toContainEqual({
      type: 'rebase',
      unitId: fighter.id,
      to: { kind: 'city', id: front.id },
    });
  });
});

describe('advancing', () => {
  const city = (state: GameState, name: string) => Object.values(state.cities).find((c) => c.name === name)!;

  it('moves free units toward the nearest enemy city', () => {
    const state = makeState({
      width: 20,
      cities: [
        { name: 'Near', owner: 'blue', x: 8, y: 2, size: 3, shieldsPerTurn: 1 },
        { name: 'Far', owner: 'blue', x: 18, y: 10, size: 3, shieldsPerTurn: 1 },
      ],
      units: [
        { type: 'armour', owner: 'red', x: 1, y: 2 },
        { type: 'infantry', owner: 'blue', x: 8, y: 2 },
      ],
    });
    const tank = Object.values(playTurn(state).state.units).find((u) => u.type === 'armour')!;
    expect(tank.pos).toEqual({ x: 4, y: 2 });
  });

  it('heads for the nearest enemy city it can reach by land', () => {
    // Over the water to the right is nearer, but out of reach.
    const state = makeState({
      terrain: [
        'ggggggggoogg',
        'ggggggggoogg',
        'ggggggggoogg',
        'ggggggggoogg',
        'ggggggggoogg',
        'ggggggggoogg',
      ],
      cities: [
        { name: 'Across', owner: 'blue', x: 10, y: 2, size: 3, shieldsPerTurn: 1 },
        { name: 'Inland', owner: 'blue', x: 0, y: 2, size: 3, shieldsPerTurn: 1 },
      ],
      units: [{ type: 'armour', owner: 'red', x: 6, y: 2 }],
    });
    const tank = Object.values(playTurn(state).state.units).find((u) => u.type === 'armour')!;
    expect(tank.pos).toEqual({ x: 3, y: 2 });
  });

  it('walks into an empty enemy city, taking it', () => {
    const state = makeState({
      cities: [{ name: 'Prize', owner: 'blue', x: 4, y: 2, size: 3, shieldsPerTurn: 1 }],
      units: [{ type: 'infantry', owner: 'red', x: 2, y: 2 }],
    });
    // Infantry moves 1 a turn: two turns to get there. Blue just passes.
    const round = (s: GameState) => {
      const result = applyActions(s, [...decide(s, 'red'), { type: 'endTurn' }]);
      if (!result.ok) throw new Error(result.reason);
      return result.state;
    };
    const first = round(state);
    expect(city(first, 'Prize').owner).toBe('blue');
    expect(city(round(first), 'Prize').owner).toBe('red');
  });

  it('attacks after advancing when the odds are good', () => {
    const state = makeState({
      units: [
        { type: 'armour', owner: 'red', x: 2, y: 2 },
        { type: 'infantry', owner: 'blue', x: 5, y: 2, hp: 1 },
      ],
      cities: [{ name: 'Prize', owner: 'blue', x: 5, y: 2, size: 3, shieldsPerTurn: 1 }],
    });
    const { actions, state: after } = playTurn(state);
    expect(strikes(state, actions)).toContain('attack armour→5,2');
    expect(city(after, 'Prize').owner).toBe('red');
  });
});

describe('production', () => {
  const queueOf = (actions: Action[]) => {
    const set = actions.find((a) => a.type === 'setProduction');
    return set?.type === 'setProduction' ? set.queue : null;
  };
  const home = { name: 'Home', owner: 'red', x: 2, y: 2, size: 3, shieldsPerTurn: 10 };

  it('builds the best defender for the cost in a city with no garrison', () => {
    // Tank Hunter: defence 14 for 80 shields beats Line Infantry (10 for 90) and Mech (18 for 110).
    expect(queueOf(playTurn(makeState({ cities: [home] })).actions)).toEqual(['antiTank']);
  });

  it('builds the best attacker for the cost once the city is held', () => {
    const state = makeState({ cities: [home], units: [{ type: 'infantry', owner: 'red', x: 2, y: 2 }] });
    expect(queueOf(playTurn(state).actions)).toEqual(['armour']);
  });

  it('builds guns when it has too few to support its attackers', () => {
    const state = makeState({
      cities: [home],
      units: [
        { type: 'infantry', owner: 'red', x: 2, y: 2 },
        { type: 'armour', owner: 'red', x: 0, y: 10 },
        { type: 'armour', owner: 'red', x: 1, y: 10 },
      ],
    });
    // Radar Battery: 18 strength × 3 shots for 120 shields beats the Field Battery's 12 × 2 for 80.
    expect(queueOf(playTurn(state).actions)).toEqual(['radarArtillery']);
  });

  it('leaves a city that is already building alone', () => {
    const state = makeState({ cities: [{ ...home, queue: ['infantry'] }] });
    expect(queueOf(playTurn(state).actions)).toBeNull();
  });
});

describe('attacking at good odds only', () => {
  // Red infantry (attack 4) next to a fortified blue tank on hills: hopeless.
  const state = makeState({
    terrain: ['gggg', 'gggg', 'gghg', 'gggg'],
    units: [
      { type: 'infantry', owner: 'red', x: 1, y: 2 },
      { type: 'armour', owner: 'blue', x: 2, y: 2, fortified: true },
    ],
  });

  it('declines an attack below the threshold', () => {
    expect(strikes(state, playTurn(state).actions)).toEqual([]);
  });

  it('takes the same attack when the threshold is lowered', () => {
    expect(strikes(state, playTurn(state, { attackOdds: 0 }).actions)).toEqual(['attack infantry→2,2']);
  });

  it('attacks when the odds clear the threshold', () => {
    const easy = makeState({
      units: [
        { type: 'armour', owner: 'red', x: 1, y: 2 },
        { type: 'infantry', owner: 'blue', x: 2, y: 2, hp: 1 },
      ],
    });
    expect(strikes(easy, playTurn(easy).actions)[0]).toBe('attack armour→2,2');
  });
});
