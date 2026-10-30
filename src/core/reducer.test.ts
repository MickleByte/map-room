import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../tests/fixtures/build';
import { applyAction, applyActions } from './reducer';
import type { Action, ApplyResult, GameState } from './types';

function ok(result: ApplyResult): Extract<ApplyResult, { ok: true }> {
  if (!result.ok) throw new Error(`expected success, got: ${result.reason}`);
  return result;
}

function reason(result: ApplyResult): string {
  if (result.ok) throw new Error('expected the action to be rejected');
  return result.reason;
}

const endTurn: Action = { type: 'endTurn' };

describe('move', () => {
  const state = makeState({
    terrain: ['gggho', 'ggggo', 'ggggo'],
    roads: [
      [0, 0],
      [1, 0],
    ],
    units: [
      { type: 'infantry', owner: 'red', x: 0, y: 0 },
      { type: 'infantry', owner: 'blue', x: 0, y: 2 },
    ],
  });
  const inf = unitOf(state, 'infantry', 'red');

  it('moves one tile, spends movement and reports the move', () => {
    const r = ok(applyAction(state, { type: 'move', unitId: inf.id, to: { x: 1, y: 0 } }));
    const moved = r.state.units[inf.id]!;
    expect(moved.pos).toEqual({ x: 1, y: 0 });
    expect(moved.movesLeft).toBe(2); // road: 1/3 used of 3/3
    expect(moved.actedThisTurn).toBe(true);
    expect(r.events).toEqual([
      { type: 'unitMoved', unitId: inf.id, from: { x: 0, y: 0 }, to: { x: 1, y: 0 } },
    ]);
  });

  it('lets a unit with partial movement enter costly terrain, using the rest', () => {
    const r = ok(
      applyActions(state, [
        { type: 'move', unitId: inf.id, to: { x: 1, y: 0 } },
        { type: 'move', unitId: inf.id, to: { x: 2, y: 0 } },
      ]),
    );
    expect(r.state.units[inf.id]).toMatchObject({ pos: { x: 2, y: 0 }, movesLeft: 0 });
    expect(reason(applyAction(r.state, { type: 'move', unitId: inf.id, to: { x: 3, y: 0 } }))).toMatch(
      /no movement left/,
    );
  });

  it('rejects illegal moves with a reason', () => {
    const move = (unitId: number, to: { x: number; y: number }) =>
      reason(applyAction(state, { type: 'move', unitId, to }));
    expect(move(inf.id, { x: 2, y: 0 })).toMatch(/one tile at a time/);
    expect(move(inf.id, { x: 0, y: -1 })).toMatch(/off the map/);
    expect(move(unitOf(state, 'infantry', 'blue').id, { x: 1, y: 2 })).toMatch(/another player/);
    expect(move(999, { x: 1, y: 0 })).toMatch(/No unit/);
  });

  it('never changes the state it was given', () => {
    const before = JSON.stringify(state);
    ok(applyAction(state, { type: 'move', unitId: inf.id, to: { x: 1, y: 0 } }));
    expect(JSON.stringify(state)).toBe(before);
  });

  it('gives identical results for identical inputs', () => {
    const actions: Action[] = [{ type: 'move', unitId: inf.id, to: { x: 1, y: 0 } }, endTurn, endTurn];
    expect(ok(applyActions(state, actions)).state).toEqual(ok(applyActions(state, actions)).state);
  });
});

describe('fortify', () => {
  const state = makeState({
    terrain: ['ggoo'],
    units: [
      { type: 'infantry', owner: 'red', x: 0, y: 0 },
      { type: 'destroyer', owner: 'red', x: 3, y: 0 },
    ],
  });
  const inf = unitOf(state, 'infantry');

  it('fortifies a land unit and ends its turn; moving later clears it', () => {
    const fortified = ok(applyAction(state, { type: 'fortify', unitId: inf.id })).state;
    expect(fortified.units[inf.id]).toMatchObject({ fortified: true, movesLeft: 0 });

    const nextTurn = ok(applyActions(fortified, [endTurn, endTurn])).state;
    expect(nextTurn.units[inf.id]!.fortified).toBe(true);
    const moved = ok(applyAction(nextTurn, { type: 'move', unitId: inf.id, to: { x: 1, y: 0 } })).state;
    expect(moved.units[inf.id]!.fortified).toBe(false);
  });

  it('only fortifies land units', () => {
    expect(reason(applyAction(state, { type: 'fortify', unitId: unitOf(state, 'destroyer').id }))).toMatch(
      /Only land units/,
    );
  });
});

describe('go-to orders', () => {
  const state = makeState({ units: [{ type: 'armour', owner: 'red', x: 0, y: 6 }] });
  const tank = unitOf(state, 'armour');
  const order: Action = {
    type: 'setOrders',
    unitId: tank.id,
    orders: { kind: 'goto', target: { x: 5, y: 6 } },
  };

  it('moves as far as it can at once and keeps the order', () => {
    const r = ok(applyAction(state, order));
    expect(r.state.units[tank.id]).toMatchObject({ pos: { x: 3, y: 6 }, movesLeft: 0 });
    expect(r.state.units[tank.id]!.orders).toEqual({ kind: 'goto', target: { x: 5, y: 6 } });
    expect(r.events.filter((e) => e.type === 'unitMoved')).toHaveLength(3);
  });

  it("continues at the start of the owner's next turn and clears on arrival", () => {
    const afterOrder = ok(applyAction(state, order)).state;
    const blueTurn = ok(applyAction(afterOrder, endTurn)).state;
    expect(blueTurn.units[tank.id]!.pos).toEqual({ x: 3, y: 6 });

    const r = ok(applyAction(blueTurn, endTurn));
    expect(r.state.units[tank.id]).toMatchObject({ pos: { x: 5, y: 6 }, orders: null, movesLeft: 3 });
    expect(r.events[0]).toEqual({ type: 'turnStarted', player: 'red', turn: 2 });
  });

  it('refuses an order with no route', () => {
    const island = makeState({ terrain: ['ggoogg'], units: [{ type: 'armour', owner: 'red', x: 0, y: 0 }] });
    const t = unitOf(island, 'armour');
    expect(
      reason(
        applyAction(island, {
          type: 'setOrders',
          unitId: t.id,
          orders: { kind: 'goto', target: { x: 5, y: 0 } },
        }),
      ),
    ).toMatch(/no route/);
  });

  it('can be cancelled', () => {
    const s = ok(applyAction(state, order)).state;
    const cleared = ok(applyAction(s, { type: 'setOrders', unitId: tank.id, orders: null })).state;
    expect(cleared.units[tank.id]!.orders).toBeNull();
  });
});

describe('endTurn', () => {
  const state = makeState({
    units: [
      { type: 'armour', owner: 'red', x: 0, y: 0 },
      { type: 'armour', owner: 'blue', x: 8, y: 8 },
    ],
  });

  it('passes play in turn order and counts a new turn when it returns to the first player', () => {
    const s1 = ok(applyAction(state, endTurn)).state;
    expect([s1.currentPlayer, s1.turn]).toEqual([1, 1]);
    const s2 = ok(applyAction(s1, endTurn)).state;
    expect([s2.currentPlayer, s2.turn]).toEqual([0, 2]);
  });

  it("refreshes the new player's units", () => {
    const red = unitOf(state, 'armour', 'red');
    const moved = ok(applyAction(state, { type: 'move', unitId: red.id, to: { x: 1, y: 0 } })).state;
    const back = ok(applyActions(moved, [endTurn, endTurn])).state;
    expect(back.units[red.id]).toMatchObject({ movesLeft: 9, actedThisTurn: false });
  });

  it('refuses everything once the game is over', () => {
    const over: GameState = { ...state, winner: 'red' };
    expect(reason(applyAction(over, endTurn))).toMatch(/game is over/);
  });
});

describe('cargo', () => {
  it('moves with its ship', () => {
    const state = makeState({
      terrain: ['gcooo'],
      units: [{ type: 'transport', owner: 'red', x: 2, y: 0, cargo: [{ type: 'infantry' }] }],
    });
    const ship = unitOf(state, 'transport');
    const s = ok(applyAction(state, { type: 'move', unitId: ship.id, to: { x: 3, y: 0 } })).state;
    expect(unitOf(s, 'infantry').pos).toEqual({ x: 3, y: 0 });
  });
});
