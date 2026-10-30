/** Attacks, through the reducer: who may attack where, and what happens. */
import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../../tests/fixtures/build';
import { applyAction } from '../reducer';
import { seedRng } from '../rng';
import { maxHp } from '../ruleset';
import type { Action, ApplyResult, Coord, GameEvent, GameState } from '../types';
import { winChance } from './odds';
import { previewAttack } from './resolve';

/** Recorded from seed 7; changing how combat draws from the RNG breaks saved games (ADR-0004). */
const SEED_7_ROUNDS = ['A', 'A', 'D', 'D', 'A'];

function reason(result: ApplyResult): string {
  if (result.ok) throw new Error('expected the action to be rejected');
  return result.reason;
}

const attack = (state: GameState, unitId: number, target: Coord) =>
  applyAction(state, { type: 'attack', unitId, target } satisfies Action);

describe('who may attack where (ADR-0003)', () => {
  const state = makeState({
    terrain: ['gggcc', 'ggggc', 'ggggg', 'ggggg'],
    units: [
      { type: 'armour', owner: 'red', x: 2, y: 0 },
      { type: 'destroyer', owner: 'blue', x: 3, y: 0 },
      { type: 'infantry', owner: 'blue', x: 1, y: 0 },
      { type: 'destroyer', owner: 'red', x: 4, y: 0 },
    ],
  });
  const tank = unitOf(state, 'armour');

  it('only attacks an adjacent tile with enemy units on it', () => {
    expect(reason(attack(state, tank.id, { x: 0, y: 0 }))).toMatch(/adjacent/);
    expect(reason(attack(state, tank.id, { x: 2, y: 1 }))).toMatch(/no enemy/);
  });

  it('lets land units attack only land tiles: no attacking ships at sea', () => {
    expect(reason(attack(state, tank.id, { x: 3, y: 0 }))).toMatch(/cannot enter the sea/);
  });

  it('lets ships attack only tiles they could sail into', () => {
    const ship = unitOf(state, 'destroyer', 'red');
    expect(attack(state, ship.id, { x: 3, y: 0 }).ok).toBe(true);
    const land = makeState({
      terrain: ['ggcc'],
      units: [
        { type: 'destroyer', owner: 'red', x: 2, y: 0 },
        { type: 'infantry', owner: 'blue', x: 1, y: 0 },
      ],
    });
    expect(reason(attack(land, unitOf(land, 'destroyer').id, { x: 1, y: 0 }))).toMatch(
      /only enter the sea or a friendly city/,
    );
  });

  it('never lets aircraft or units with no attack strength attack', () => {
    const blue = makeState({
      cities: [{ name: 'Base', owner: 'red', x: 2, y: 2, size: 1, shieldsPerTurn: 1 }],
      units: [
        { type: 'fighter', owner: 'red', x: 2, y: 2 },
        { type: 'artillery', owner: 'red', x: 2, y: 4 },
        { type: 'infantry', owner: 'blue', x: 2, y: 3 },
      ],
    });
    expect(reason(attack(blue, unitOf(blue, 'fighter').id, { x: 2, y: 3 }))).toMatch(/Aircraft/);
    expect(reason(attack(blue, unitOf(blue, 'artillery').id, { x: 2, y: 3 }))).toMatch(/cannot attack/);
  });

  it('needs movement left', () => {
    const spent = structuredClone(state);
    spent.units[tank.id]!.movesLeft = 0;
    expect(reason(attack(spent, tank.id, { x: 1, y: 0 }))).toMatch(/no movement left/);
  });

  it('keeps units without canCaptureCities out of enemy cities', () => {
    const s = structuredClone(
      makeState({
        cities: [{ name: 'Fort', owner: 'blue', x: 3, y: 2, size: 3, shieldsPerTurn: 1 }],
        units: [
          { type: 'antiTank', owner: 'red', x: 2, y: 2 },
          { type: 'infantry', owner: 'blue', x: 3, y: 2 },
        ],
      }),
    );
    s.ruleset.unitTypes.antiTank!.canCaptureCities = false;
    expect(reason(attack(s, unitOf(s, 'antiTank').id, { x: 3, y: 2 }))).toMatch(/cannot capture cities/);
  });

  it('cannot attack from aboard a ship', () => {
    const s = makeState({
      terrain: ['ggcc'],
      units: [
        { type: 'transport', owner: 'red', x: 2, y: 0, cargo: [{ type: 'armour' }] },
        { type: 'infantry', owner: 'blue', x: 1, y: 0 },
      ],
    });
    expect(reason(attack(s, unitOf(s, 'armour').id, { x: 1, y: 0 }))).toMatch(/aboard a ship/);
  });

  it("rejects another player's units", () => {
    expect(reason(attack(state, unitOf(state, 'infantry', 'blue').id, { x: 2, y: 0 }))).toMatch(
      /another player/,
    );
  });
});

/** The same state with its RNG reseeded, to try different combat rolls. */
function reseeded(state: GameState, seed: number): GameState {
  return { ...state, rng: seedRng(seed) };
}

/** Results of the same action under many different RNG seeds. */
function outcomes(state: GameState, action: Action, seeds = 300) {
  return Array.from({ length: seeds }, (_, i) => {
    const r = applyAction(reseeded(state, i + 1), action);
    if (!r.ok) throw new Error(r.reason);
    return r;
  });
}

function combatOf(events: GameEvent[]) {
  const e = events.find((x) => x.type === 'combat');
  if (!e || e.type !== 'combat') throw new Error('no combat event');
  return e;
}

describe('combat', () => {
  const E = { x: 3, y: 2 }; // east of (2,2)
  const duel = makeState({
    units: [
      { type: 'armour', owner: 'red', x: 2, y: 2 },
      { type: 'infantry', owner: 'blue', x: 3, y: 2, fortified: true },
    ],
  });
  const tank = unitOf(duel, 'armour');
  const inf = unitOf(duel, 'infantry');
  const hit: Action = { type: 'attack', unitId: tank.id, target: E };

  it('fights until one side is destroyed, the loser losing 1 HP a round', () => {
    for (const r of outcomes(duel, hit, 50)) {
      const fight = combatOf(r.events);
      const attackerLost = fight.rounds.filter((x) => x === 'D').length;
      const defenderLost = fight.rounds.filter((x) => x === 'A').length;
      const winner = r.state.units[fight.winner]!;
      const full = maxHp(r.state.ruleset, winner.veteran); // a promotion raises it
      if (fight.winner === tank.id) {
        expect(defenderLost).toBe(3);
        expect(winner.hp).toBe(full - attackerLost);
        expect(r.state.units[inf.id]).toBeUndefined();
      } else {
        expect(attackerLost).toBe(3);
        expect(winner.hp).toBe(full - defenderLost);
        expect(r.state.units[tank.id]).toBeUndefined();
      }
      expect(r.events).toContainEqual({
        type: 'unitDestroyed',
        unitId: fight.winner === tank.id ? inf.id : tank.id,
      });
    }
  });

  it('wins about as often as the exact odds say', () => {
    const results = outcomes(duel, hit, 2000);
    const wins = results.filter((r) => combatOf(r.events).winner === tank.id).length / results.length;
    // 24 against 10 × 1.25 fortified, 3 HP each.
    expect(Math.abs(wins - winChance(24, 12.5, 3, 3))).toBeLessThan(0.03);
  });

  it('gives the same result for the same state, and a known result for a known seed', () => {
    const a = applyAction(reseeded(duel, 7), hit);
    expect(a).toEqual(applyAction(reseeded(duel, 7), hit));
    if (!a.ok) throw new Error(a.reason);
    expect(combatOf(a.events).rounds).toEqual(SEED_7_ROUNDS);
  });

  it('costs 1 MP and counts as acting', () => {
    const r = outcomes(duel, hit, 50).find((x) => combatOf(x.events).winner === tank.id)!;
    expect(r.state.units[tank.id]).toMatchObject({ movesLeft: 9 - 3, actedThisTurn: true });
  });

  it('advances into the tile once its last defender is destroyed', () => {
    const r = outcomes(duel, hit, 50).find((x) => combatOf(x.events).winner === tank.id)!;
    expect(r.state.units[tank.id]!.pos).toEqual(E);
    expect(r.events).toContainEqual({ type: 'unitMoved', unitId: tank.id, from: { x: 2, y: 2 }, to: E });
  });

  describe('against a stack', () => {
    const stack = makeState({
      units: [
        { type: 'armour', owner: 'red', x: 2, y: 2 },
        { type: 'infantry', owner: 'blue', x: 3, y: 2 },
        { type: 'paratrooper', owner: 'blue', x: 3, y: 2, fortified: true },
        { type: 'artillery', owner: 'blue', x: 3, y: 2 },
      ],
    });
    const attacker = unitOf(stack, 'armour');
    const action: Action = { type: 'attack', unitId: attacker.id, target: E };

    it('fights the best defender after modifiers', () => {
      // Fortified paratrooper 9 × 1.25 = 11.25 beats unfortified infantry 10; artillery has no defence.
      const fight = combatOf(outcomes(stack, action, 1)[0]!.events);
      expect(fight.defender).toBe(unitOf(stack, 'paratrooper').id);
    });

    it('kills one defender per attack and stays put while any remain', () => {
      const r = outcomes(stack, action, 50).find((x) => combatOf(x.events).winner === attacker.id)!;
      expect(r.state.units[attacker.id]!.pos).toEqual({ x: 2, y: 2 });
      expect(r.state.units[unitOf(stack, 'infantry').id]).toBeDefined();
      expect(r.state.units[unitOf(stack, 'artillery').id]!.owner).toBe('blue');
    });

    it('captures units that cannot defend when the last defender falls', () => {
      const s = structuredClone(stack);
      delete s.units[unitOf(stack, 'paratrooper').id];
      const r = outcomes(s, action, 50).find((x) => combatOf(x.events).winner === attacker.id)!;
      const gun = r.state.units[unitOf(stack, 'artillery').id]!;
      expect(gun).toMatchObject({ owner: 'red', pos: E, movesLeft: 0 });
      expect(r.events).toContainEqual({ type: 'unitCaptured', unitId: gun.id, newOwner: 'red' });
    });
  });

  it('captures defence-0 units without a fight', () => {
    const s = makeState({
      units: [
        { type: 'armour', owner: 'red', x: 2, y: 2 },
        { type: 'artillery', owner: 'blue', x: 3, y: 2 },
        { type: 'radarArtillery', owner: 'blue', x: 3, y: 2 },
      ],
    });
    const r = applyAction(s, { type: 'attack', unitId: unitOf(s, 'armour').id, target: E });
    if (!r.ok) throw new Error(r.reason);
    expect(r.events.some((e) => e.type === 'combat')).toBe(false);
    expect(unitOf(r.state, 'artillery')).toMatchObject({ owner: 'red', pos: E });
    expect(unitOf(r.state, 'radarArtillery')).toMatchObject({ owner: 'red', pos: E });
    expect(unitOf(r.state, 'armour')).toMatchObject({ pos: E, movesLeft: 6 });
  });

  it('destroys ships and aircraft (with their cargo) when it takes their tile', () => {
    const port = makeState({
      terrain: ['ggggg', 'ggggc', 'ggggc', 'ggggc'],
      cities: [{ name: 'Port', owner: 'blue', x: 3, y: 2, size: 5, shieldsPerTurn: 1 }],
      units: [
        { type: 'armour', owner: 'red', x: 2, y: 2 },
        { type: 'artillery', owner: 'blue', x: 3, y: 2 },
        { type: 'fighter', owner: 'blue', x: 3, y: 2 },
        { type: 'transport', owner: 'blue', x: 3, y: 2, cargo: [{ type: 'infantry' }] },
      ],
    });
    const r = applyAction(port, { type: 'attack', unitId: unitOf(port, 'armour').id, target: E });
    if (!r.ok) throw new Error(r.reason);
    const left = Object.values(r.state.units).map((u) => `${u.owner} ${u.type}`);
    expect(left.sort()).toEqual(['red armour', 'red artillery']);
    expect(r.events.filter((e) => e.type === 'unitDestroyed')).toHaveLength(3);
  });

  it('lets a ship attack ships at sea', () => {
    const s = makeState({
      terrain: ['ggccc'],
      units: [
        { type: 'battleship', owner: 'red', x: 3, y: 0 },
        { type: 'destroyer', owner: 'blue', x: 4, y: 0 },
      ],
    });
    const r = applyAction(s, { type: 'attack', unitId: unitOf(s, 'battleship').id, target: { x: 4, y: 0 } });
    if (!r.ok) throw new Error(r.reason);
    expect(combatOf(r.events).defender).toBe(unitOf(s, 'destroyer').id);
  });
});

describe('previewAttack', () => {
  const state = makeState({
    terrain: ['ggggg', 'ggggg', 'ggghg', 'ggggg'],
    units: [
      { type: 'armour', owner: 'red', x: 2, y: 2 },
      { type: 'infantry', owner: 'blue', x: 3, y: 2, fortified: true, hp: 2 },
      { type: 'infantry', owner: 'blue', x: 3, y: 2 },
    ],
  });
  const tank = unitOf(state, 'armour');

  it('names the best defender, its itemised defence and the exact odds, without rolling', () => {
    const p = previewAttack(state, tank, { x: 3, y: 2 });
    if (typeof p === 'string') throw new Error(p);
    // Hills 50% + fortified 25%: 10 × 1.75 = 17.5, on 2 HP.
    expect(p.defender?.hp).toBe(2);
    expect(p.defence).toMatchObject({ strength: 17.5, items: [{ label: 'Hills' }, { label: 'Fortified' }] });
    expect(p.attack).toBe(24);
    expect(p.odds).toBeCloseTo(winChance(24, 17.5, 3, 2), 12);
    expect(p.defendersLeft).toBe(1);
  });

  it('is certain when nothing there can defend', () => {
    const s = makeState({
      units: [
        { type: 'armour', owner: 'red', x: 2, y: 2 },
        { type: 'artillery', owner: 'blue', x: 3, y: 2 },
      ],
    });
    expect(previewAttack(s, unitOf(s, 'armour'), { x: 3, y: 2 })).toMatchObject({
      defender: null,
      odds: 1,
      defendersLeft: 0,
    });
  });

  it('gives the reason when the attack is not allowed', () => {
    expect(previewAttack(state, tank, { x: 0, y: 2 })).toMatch(/adjacent/);
  });
});

describe('promotion', () => {
  const E = { x: 3, y: 2 };
  const duel = makeState({
    units: [
      { type: 'armour', owner: 'red', x: 2, y: 2 },
      { type: 'infantry', owner: 'blue', x: 3, y: 2 },
    ],
  });
  const tank = unitOf(duel, 'armour');
  const inf = unitOf(duel, 'infantry');
  const hit: Action = { type: 'attack', unitId: tank.id, target: E };

  it('promotes the winner, attacker or defender, about 1 time in 5', () => {
    const results = outcomes(duel, hit, 2000);
    let promoted = 0;
    const sides = new Set<number>();
    for (const r of results) {
      const fight = combatOf(r.events);
      const promo = r.events.find((e) => e.type === 'unitPromoted');
      if (!promo) {
        expect(r.state.units[fight.winner]!.veteran).toBe('regular');
        continue;
      }
      promoted++;
      sides.add(fight.winner);
      expect(promo).toEqual({ type: 'unitPromoted', unitId: fight.winner, to: 'veteran' });
      const lost = fight.rounds.filter((x) => x !== (fight.winner === tank.id ? 'A' : 'D')).length;
      // Veteran max HP is 4: the promotion adds the extra HP on top of the damage taken.
      expect(r.state.units[fight.winner]).toMatchObject({ veteran: 'veteran', hp: 4 - lost });
    }
    expect(Math.abs(promoted / results.length - 0.2)).toBeLessThan(0.03);
    expect([...sides].sort()).toEqual([tank.id, inf.id].sort());
  });

  it('never promotes beyond elite', () => {
    const elite = structuredClone(duel);
    for (const id of [tank.id, inf.id]) Object.assign(elite.units[id]!, { veteran: 'elite', hp: 5 });
    for (const r of outcomes(elite, hit, 200)) {
      expect(r.events.some((e) => e.type === 'unitPromoted')).toBe(false);
    }
  });
});
