import { describe, expect, it } from 'vitest';
import { makeState } from '../../tests/fixtures/build';
import { turnsToBuild } from './cities';
import { applyActions } from './reducer';
import type { Action, GameEvent, GameState } from './types';

const endTurn: Action = { type: 'endTurn' };
/** Blue's turn, then Red's: one start of Red's turn. */
const round: Action[] = [endTurn, endTurn];

function play(state: GameState, actions: Action[]): { state: GameState; events: GameEvent[] } {
  const r = applyActions(state, actions);
  if (!r.ok) throw new Error(r.reason);
  return r;
}

const rounds = (n: number) => Array.from({ length: n }, () => round).flat();

function redCity(opts: { shieldsPerTurn: number; queue?: string[]; repeat?: boolean }) {
  return makeState({
    cities: [{ name: 'Home', owner: 'red', x: 6, y: 6, size: 3, ...opts }],
  });
}

const cityOf = (state: GameState) => Object.values(state.cities)[0]!;
const builtUnits = (state: GameState) => Object.values(state.units).map((u) => u.type);

describe('setting production', () => {
  // A coastal city (Port, beside the sea in column 0) and an inland one (Farm).
  const state = makeState({
    terrain: ['cgggg', 'cgggg', 'cgggg', 'cgggg', 'cgggg'],
    cities: [
      { name: 'Port', owner: 'red', x: 1, y: 2, size: 3, shieldsPerTurn: 10 },
      { name: 'Farm', owner: 'red', x: 4, y: 2, size: 3, shieldsPerTurn: 10 },
      { name: 'Keep', owner: 'blue', x: 3, y: 4, size: 3, shieldsPerTurn: 10 },
    ],
  });
  const [port, farm, keep] = Object.values(state.cities).map((c) => c.id) as [number, number, number];
  const set = (cityId: number, queue: string[], repeat = false) =>
    applyActions(state, [{ type: 'setProduction', cityId, queue, repeat }]);

  it('replaces the queue and the repeat flag of the player’s own city', () => {
    const r = set(farm, ['armour', 'infantry'], true);
    if (!r.ok) throw new Error(r.reason);
    expect(r.state.cities[farm]).toMatchObject({ queue: ['armour', 'infantry'], repeat: true });
  });

  it('allows ships only in coastal cities', () => {
    expect(set(port, ['destroyer']).ok).toBe(true);
    expect(set(farm, ['infantry', 'destroyer'])).toEqual({
      ok: false,
      reason: 'Farm is not on the coast, so it cannot build an Escort Destroyer',
    });
  });

  it('is refused for other players’ cities, unknown cities and unknown unit types', () => {
    expect(set(keep, ['infantry'])).toEqual({ ok: false, reason: 'That city belongs to another player' });
    expect(set(99, ['infantry'])).toEqual({ ok: false, reason: 'No city with id 99' });
    expect(set(farm, ['dragon'])).toEqual({ ok: false, reason: 'Unknown unit type "dragon"' });
  });
});

describe('turnsToBuild', () => {
  const at = (shieldsPerTurn: number, shieldsStored: number, queue: string[]) => {
    const state = redCity({ shieldsPerTurn, queue });
    cityOf(state).shieldsStored = shieldsStored;
    return turnsToBuild(state, cityOf(state));
  };

  it('counts the owner’s turns until the first queued unit appears', () => {
    expect(at(40, 0, ['infantry'])).toBe(3);
    expect(at(40, 10, ['infantry'])).toBe(2);
    expect(at(40, 50, ['infantry'])).toBe(1);
    expect(at(0, 95, ['infantry'])).toBe(1);
  });

  it('is null with an empty queue or no shields to finish it', () => {
    expect(at(40, 0, [])).toBeNull();
    expect(at(0, 10, ['infantry'])).toBeNull();
  });
});

describe('production at the start of the owner’s turn', () => {
  it('builds the first queued unit once the stored shields cover its cost', () => {
    // Line Infantry costs 90: 40 + 40 + 40 = 120 at the start of Red's third turn.
    const state = redCity({ shieldsPerTurn: 40, queue: ['infantry', 'armour'] });
    expect(builtUnits(play(state, rounds(2)).state)).toEqual([]);

    const { state: after, events } = play(state, rounds(3));
    const unit = Object.values(after.units)[0]!;
    expect(unit).toMatchObject({ type: 'infantry', owner: 'red', pos: { x: 6, y: 6 }, hp: 3 });
    expect(unit.movesLeft).toBe(3);
    expect(events).toContainEqual({ type: 'unitBuilt', unitId: unit.id, cityId: cityOf(after).id });
    expect(cityOf(after).queue).toEqual(['armour']);
  });

  it('carries leftover shields over to the next item', () => {
    // 50 a turn: Infantry (90) on turn 2 leaves 10; 10 + 50 + 50 = 110 pays for a Tank Hunter (80).
    const state = redCity({ shieldsPerTurn: 50, queue: ['infantry', 'antiTank'] });
    expect(cityOf(play(state, rounds(2)).state).shieldsStored).toBe(10);
    expect(builtUnits(play(state, rounds(3)).state)).toEqual(['infantry']);
    const after = play(state, rounds(4)).state;
    expect(builtUnits(after)).toEqual(['infantry', 'antiTank']);
    expect(cityOf(after).shieldsStored).toBe(30);
  });

  it('builds at most one unit a turn, saving the rest', () => {
    const state = redCity({ shieldsPerTurn: 200, queue: ['antiTank', 'antiTank'] });
    const after = play(state, rounds(1)).state;
    expect(builtUnits(after)).toEqual(['antiTank']);
    expect(cityOf(after).shieldsStored).toBe(120);
  });

  it('stops collecting shields when the queue is empty, keeping what is stored', () => {
    const state = redCity({ shieldsPerTurn: 50, queue: ['antiTank'] });
    // 100 on turn 2 builds the Tank Hunter and leaves 20, which then sits unused.
    expect(cityOf(play(state, rounds(5)).state).shieldsStored).toBe(20);
  });

  it('keeps building the last item when repeat is on', () => {
    const state = redCity({ shieldsPerTurn: 90, queue: ['antiTank', 'infantry'], repeat: true });
    const after = play(state, rounds(4)).state;
    // 90 → Tank Hunter (10 left), 100 → Infantry (10), 100 → Infantry (20), 110 → Infantry.
    expect(builtUnits(after)).toEqual(['antiTank', 'infantry', 'infantry', 'infantry']);
    expect(cityOf(after).queue).toEqual(['infantry']);
  });

  it('bases a newly built aircraft in its city', () => {
    const state = redCity({ shieldsPerTurn: 100, queue: ['fighter'] });
    const after = play(state, rounds(1)).state;
    const fighter = Object.values(after.units)[0]!;
    expect(fighter.base).toEqual({ kind: 'city', id: cityOf(after).id });
  });

  it('empties the queue when repeat is off', () => {
    const state = redCity({ shieldsPerTurn: 90, queue: ['infantry'] });
    const after = play(state, rounds(3)).state;
    expect(builtUnits(after)).toEqual(['infantry']);
    expect(cityOf(after).queue).toEqual([]);
  });
});
