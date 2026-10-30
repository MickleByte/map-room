/** Sea operations through the reducer: boarding, disembarking, cargo and naval combat. */
import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../tests/fixtures/build';
import { bombardRange } from './combat/bombard';
import { previewAttack } from './combat/resolve';
import { applyAction } from './reducer';
import { seedRng } from './rng';
import type { Action, ApplyResult, GameEvent, GameState } from './types';

function ok(result: ApplyResult): GameState {
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

function reason(result: ApplyResult): string {
  if (result.ok) throw new Error('expected the action to be rejected');
  return result.reason;
}

const act = (state: GameState, action: Action) => applyAction(state, action);

describe('boarding a transport at sea', () => {
  const state = makeState({
    terrain: ['ggcc'],
    units: [
      { type: 'infantry', owner: 'red', x: 1, y: 0 },
      { type: 'transport', owner: 'red', x: 2, y: 0 },
    ],
  });
  const inf = unitOf(state, 'infantry');
  const ship = unitOf(state, 'transport');

  it('puts a land unit aboard when it moves onto a friendly transport', () => {
    const next = ok(act(state, { type: 'move', unitId: inf.id, to: { x: 2, y: 0 } }));
    expect(next.units[inf.id]).toMatchObject({ pos: { x: 2, y: 0 }, carriedBy: ship.id });
  });

  it('carries its cargo when it sails', () => {
    const aboard = ok(act(state, { type: 'move', unitId: inf.id, to: { x: 2, y: 0 } }));
    const next = ok(act(aboard, { type: 'move', unitId: ship.id, to: { x: 3, y: 0 } }));
    expect(next.units[inf.id]).toMatchObject({ pos: { x: 3, y: 0 }, carriedBy: ship.id });
  });
});

describe('transport capacity', () => {
  const four = Array.from({ length: 4 }, () => ({ type: 'infantry' }));

  it('refuses a fifth unit', () => {
    const state = makeState({
      terrain: ['ggcc'],
      units: [
        { type: 'armour', owner: 'red', x: 1, y: 0 },
        { type: 'transport', owner: 'red', x: 2, y: 0, cargo: four },
      ],
    });
    const tank = unitOf(state, 'armour');
    expect(reason(act(state, { type: 'move', unitId: tank.id, to: { x: 2, y: 0 } }))).toMatch(
      /Troopship is full \(4 units\)/,
    );
  });

  it('boards the transport with room when another on the tile is full', () => {
    const state = makeState({
      terrain: ['ggcc'],
      units: [
        { type: 'armour', owner: 'red', x: 1, y: 0 },
        { type: 'transport', owner: 'red', x: 2, y: 0, cargo: four },
        { type: 'transport', owner: 'red', x: 2, y: 0 },
      ],
    });
    const tank = unitOf(state, 'armour');
    const [, roomy] = Object.values(state.units).filter((u) => u.type === 'transport');
    const next = ok(act(state, { type: 'move', unitId: tank.id, to: { x: 2, y: 0 } }));
    expect(next.units[tank.id]!.carriedBy).toBe(roomy!.id);
  });
});

describe('boarding in a city', () => {
  const port = [{ name: 'Port', owner: 'red', x: 1, y: 0, size: 3, shieldsPerTurn: 1 }];
  const state = makeState({
    terrain: ['ggcc'],
    cities: port,
    units: [
      { type: 'infantry', owner: 'red', x: 1, y: 0, fortified: true },
      { type: 'transport', owner: 'red', x: 1, y: 0 },
      { type: 'armour', owner: 'red', x: 0, y: 0 },
    ],
  });
  const inf = unitOf(state, 'infantry');
  const ship = unitOf(state, 'transport');
  const board = (s: GameState, unitId: number, carrierId: number) =>
    act(s, { type: 'board', unitId, carrierId });

  it('puts a unit aboard a ship in the same city, where it stays', () => {
    const next = ok(board(state, inf.id, ship.id));
    expect(next.units[inf.id]).toMatchObject({ pos: { x: 1, y: 0 }, carriedBy: ship.id, fortified: false });
  });

  it('needs the unit and the ship on the same city tile', () => {
    expect(reason(board(state, unitOf(state, 'armour').id, ship.id))).toMatch(/same tile/);
    const atSea = makeState({
      terrain: ['ggcc'],
      units: [
        { type: 'transport', owner: 'red', x: 2, y: 0, cargo: [{ type: 'infantry' }] },
        { type: 'transport', owner: 'red', x: 2, y: 0 },
      ],
    });
    const [, empty] = Object.values(atSea.units).filter((u) => u.type === 'transport');
    expect(reason(board(atSea, unitOf(atSea, 'infantry').id, empty!.id))).toMatch(/in a city/);
  });

  it('refuses a unit already aboard, or a ship that cannot carry it', () => {
    const aboard = ok(board(state, inf.id, ship.id));
    expect(reason(board(aboard, inf.id, ship.id))).toMatch(/already aboard/);
    const s = makeState({
      terrain: ['ggcc'],
      cities: port,
      units: [
        { type: 'infantry', owner: 'red', x: 1, y: 0 },
        { type: 'carrier', owner: 'red', x: 1, y: 0 },
      ],
    });
    expect(reason(board(s, unitOf(s, 'infantry').id, unitOf(s, 'carrier').id))).toMatch(
      /carries air units only/,
    );
  });

  it('refuses a full transport', () => {
    const s = makeState({
      terrain: ['ggcc'],
      cities: port,
      units: [
        { type: 'infantry', owner: 'red', x: 1, y: 0 },
        { type: 'transport', owner: 'red', x: 1, y: 0, cargo: Array(4).fill({ type: 'armour' }) },
      ],
    });
    expect(reason(board(s, unitOf(s, 'infantry').id, unitOf(s, 'transport').id))).toMatch(/full/);
  });
});

describe('carriers', () => {
  const state = makeState({
    terrain: ['ggcc'],
    cities: [{ name: 'Port', owner: 'red', x: 1, y: 0, size: 3, shieldsPerTurn: 1 }],
    units: [
      { type: 'carrier', owner: 'red', x: 1, y: 0, cargo: Array(3).fill({ type: 'fighter' }) },
      { type: 'fighter', owner: 'red', x: 1, y: 0 },
      { type: 'bomber', owner: 'red', x: 1, y: 0 },
    ],
  });
  const carrier = unitOf(state, 'carrier');
  const fighter = Object.values(state.units).find((u) => u.type === 'fighter' && u.carriedBy === null)!;
  const bomber = unitOf(state, 'bomber');

  it('hold 4 aircraft, which take the carrier as their base', () => {
    const next = ok(act(state, { type: 'board', unitId: fighter.id, carrierId: carrier.id }));
    expect(next.units[fighter.id]).toMatchObject({
      carriedBy: carrier.id,
      base: { kind: 'carrier', id: carrier.id },
    });
    expect(reason(act(next, { type: 'board', unitId: bomber.id, carrierId: carrier.id }))).toMatch(
      /Fleet Carrier is full \(4 units\)/,
    );
  });

  it('carry their aircraft when they sail', () => {
    const next = ok(act(state, { type: 'move', unitId: carrier.id, to: { x: 2, y: 0 } }));
    const aboard = Object.values(next.units).filter((u) => u.carriedBy === carrier.id);
    expect(aboard).toHaveLength(3);
    for (const u of aboard) expect(u.pos).toEqual({ x: 2, y: 0 });
  });
});

describe('disembarking', () => {
  const state = makeState({
    terrain: ['ggcc'],
    units: [{ type: 'transport', owner: 'red', x: 2, y: 0, cargo: [{ type: 'infantry' }] }],
  });
  const inf = unitOf(state, 'infantry');

  it('takes a unit ashore when it moves onto adjacent land', () => {
    const next = ok(act(state, { type: 'move', unitId: inf.id, to: { x: 1, y: 0 } }));
    expect(next.units[inf.id]).toMatchObject({ pos: { x: 1, y: 0 }, carriedBy: null });
  });

  it('cannot land where the enemy stands: no amphibious assault', () => {
    const s = makeState({
      terrain: ['ggcc'],
      units: [
        { type: 'transport', owner: 'red', x: 2, y: 0, cargo: [{ type: 'armour' }] },
        { type: 'infantry', owner: 'blue', x: 1, y: 0 },
      ],
    });
    const tank = unitOf(s, 'armour');
    expect(reason(act(s, { type: 'move', unitId: tank.id, to: { x: 1, y: 0 } }))).toMatch(/aboard a ship/);
    expect(reason(act(s, { type: 'attack', unitId: tank.id, target: { x: 1, y: 0 } }))).toMatch(
      /aboard a ship/,
    );
  });

  it('has no bombard range while aboard', () => {
    const s = makeState({
      terrain: ['ggcc'],
      units: [{ type: 'transport', owner: 'red', x: 2, y: 0, cargo: [{ type: 'artillery' }] }],
    });
    const gun = unitOf(s, 'artillery');
    expect(bombardRange(s, gun)).toEqual([]);
    const ashore = ok(act(s, { type: 'move', unitId: gun.id, to: { x: 1, y: 0 } }));
    expect(bombardRange(ashore, ashore.units[gun.id]!)).not.toEqual([]);
  });

  it('goes ashore in port by moving to its own tile', () => {
    const s = makeState({
      terrain: ['ggcc'],
      cities: [{ name: 'Port', owner: 'red', x: 1, y: 0, size: 3, shieldsPerTurn: 1 }],
      units: [{ type: 'transport', owner: 'red', x: 1, y: 0, cargo: [{ type: 'infantry' }] }],
    });
    const passenger = unitOf(s, 'infantry');
    const next = ok(act(s, { type: 'move', unitId: passenger.id, to: { x: 1, y: 0 } }));
    expect(next.units[passenger.id]).toMatchObject({ pos: { x: 1, y: 0 }, carriedBy: null });
  });

  it('cannot be ordered to go ashore at sea', () => {
    expect(reason(act(state, { type: 'move', unitId: inf.id, to: { x: 2, y: 0 } }))).toMatch(
      /already aboard/,
    );
  });

  it('can step from one transport onto another at sea', () => {
    const s = makeState({
      terrain: ['ggcc'],
      units: [
        { type: 'transport', owner: 'red', x: 2, y: 0, cargo: [{ type: 'infantry' }] },
        { type: 'transport', owner: 'red', x: 3, y: 0 },
      ],
    });
    const passenger = unitOf(s, 'infantry');
    const other = Object.values(s.units).find((u) => u.type === 'transport' && u.pos.x === 3)!;
    const next = ok(act(s, { type: 'move', unitId: passenger.id, to: { x: 3, y: 0 } }));
    expect(next.units[passenger.id]).toMatchObject({ pos: { x: 3, y: 0 }, carriedBy: other.id });
  });
});

/** Results of the same action under many RNG seeds, to see both ways a combat can go. */
function outcomes(state: GameState, action: Action, seeds = 200) {
  return Array.from({ length: seeds }, (_, i) => {
    const r = applyAction({ ...state, rng: seedRng(i + 1) }, action);
    if (!r.ok) throw new Error(r.reason);
    return r;
  });
}

function combatOf(events: GameEvent[]) {
  const e = events.find((x) => x.type === 'combat');
  if (!e || e.type !== 'combat') throw new Error('no combat event');
  return e;
}

describe('naval combat', () => {
  const state = makeState({
    terrain: ['ccoo'],
    units: [
      { type: 'battleship', owner: 'red', x: 1, y: 0 },
      {
        type: 'transport',
        owner: 'blue',
        x: 2,
        y: 0,
        cargo: [{ type: 'armour', veteran: 'elite' }, { type: 'infantry' }],
      },
    ],
  });
  const ship = unitOf(state, 'battleship');
  const troopship = unitOf(state, 'transport');
  const cargo = Object.values(state.units).filter((u) => u.carriedBy === troopship.id);
  const hit: Action = { type: 'attack', unitId: ship.id, target: { x: 2, y: 0 } };

  it('is fought by the ship, never by its cargo', () => {
    const preview = previewAttack(state, ship, { x: 2, y: 0 });
    if (typeof preview === 'string') throw new Error(preview);
    expect(preview.defender!.id).toBe(troopship.id);
    for (const r of outcomes(state, hit, 20)) expect(combatOf(r.events).defender).toBe(troopship.id);
  });

  it('sends the cargo down with a sunk ship, and the winner advances', () => {
    const results = outcomes(state, hit);
    const won = results.filter((r) => combatOf(r.events).winner === ship.id);
    const lost = results.filter((r) => combatOf(r.events).winner === troopship.id);
    expect(won.length).toBeGreaterThan(0);
    expect(lost.length).toBeGreaterThan(0);
    for (const r of won) {
      for (const u of [troopship, ...cargo]) {
        expect(r.state.units[u.id]).toBeUndefined();
        expect(r.events).toContainEqual({ type: 'unitDestroyed', unitId: u.id });
      }
      expect(r.state.units[ship.id]!.pos).toEqual({ x: 2, y: 0 });
    }
    for (const r of lost) {
      expect(r.state.units[ship.id]).toBeUndefined();
      for (const u of cargo) expect(r.state.units[u.id]).toMatchObject({ carriedBy: troopship.id });
    }
  });

  it('sinks a carrier’s aircraft with it', () => {
    const s = makeState({
      terrain: ['ccoo'],
      units: [
        { type: 'battleship', owner: 'red', x: 1, y: 0 },
        {
          type: 'carrier',
          owner: 'blue',
          x: 2,
          y: 0,
          hp: 1,
          cargo: [{ type: 'fighter' }, { type: 'bomber' }],
        },
      ],
    });
    const carrier = unitOf(s, 'carrier');
    const planes = Object.values(s.units).filter((u) => u.carriedBy === carrier.id);
    const action: Action = { type: 'attack', unitId: unitOf(s, 'battleship').id, target: { x: 2, y: 0 } };
    const r = outcomes(s, action).find((x) => combatOf(x.events).winner !== carrier.id)!;
    expect(planes).toHaveLength(2);
    for (const p of planes) expect(r.state.units[p.id]).toBeUndefined();
  });
});

describe('ships on land tiles', () => {
  const state = makeState({
    terrain: ['gggc'],
    cities: [{ name: 'Harbour', owner: 'blue', x: 2, y: 0, size: 3, shieldsPerTurn: 1 }],
    units: [
      { type: 'armour', owner: 'red', x: 1, y: 0 },
      { type: 'battleship', owner: 'blue', x: 2, y: 0 },
      { type: 'transport', owner: 'blue', x: 2, y: 0, cargo: [{ type: 'infantry', veteran: 'elite' }] },
    ],
  });
  const tank = unitOf(state, 'armour');

  it('never defend them, even in their own city: the city falls and they sink with their cargo', () => {
    const preview = previewAttack(state, tank, { x: 2, y: 0 });
    if (typeof preview === 'string') throw new Error(preview);
    expect(preview.defender).toBeNull();
    const next = applyAction(state, { type: 'attack', unitId: tank.id, target: { x: 2, y: 0 } });
    if (!next.ok) throw new Error(next.reason);
    expect(next.events.some((e) => e.type === 'combat')).toBe(false);
    expect(Object.values(next.state.units).map((u) => u.id)).toEqual([tank.id]);
    expect(Object.values(next.state.cities)[0]!.owner).toBe('red');
  });

  it('leave the land units in the city to defend it', () => {
    const s = makeState({
      terrain: ['gggc'],
      cities: [{ name: 'Harbour', owner: 'blue', x: 2, y: 0, size: 3, shieldsPerTurn: 1 }],
      units: [
        { type: 'armour', owner: 'red', x: 1, y: 0 },
        { type: 'battleship', owner: 'blue', x: 2, y: 0 },
        { type: 'infantry', owner: 'blue', x: 2, y: 0, veteran: 'conscript' },
      ],
    });
    const preview = previewAttack(s, unitOf(s, 'armour'), { x: 2, y: 0 });
    if (typeof preview === 'string') throw new Error(preview);
    expect(preview.defender!.type).toBe('infantry');
  });
});
