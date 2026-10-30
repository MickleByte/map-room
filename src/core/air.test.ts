/** Air operations through the reducer: missions, rebasing, interception and paradrops. */
import { describe, expect, it } from 'vitest';
import { makeState, unitOf } from '../../tests/fixtures/build';
import { applyAction, applyActions } from './reducer';
import type { UnitTypeDef } from './ruleset';
import type { Action, ApplyResult, Coord, GameEvent, GameState } from './types';
import { Vision } from './visibility';

function ok(result: ApplyResult) {
  if (!result.ok) throw new Error(result.reason);
  return result;
}

function reason(result: ApplyResult): string {
  if (result.ok) throw new Error('expected the action to be rejected');
  return result.reason;
}

const mission = (state: GameState, unitId: number, kind: 'bomb' | 'recon', target: Coord) =>
  applyAction(state, { type: 'airMission', unitId, mission: kind, target } satisfies Action);

const ofType = <T extends GameEvent['type']>(events: GameEvent[], type: T) =>
  events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

const endTurn: Action = { type: 'endTurn' };

describe('bombing missions', () => {
  const state = makeState({
    width: 16,
    height: 4,
    cities: [{ name: 'Field', owner: 'red', x: 1, y: 2, size: 3, shieldsPerTurn: 1 }],
    units: [
      { type: 'bomber', owner: 'red', x: 1, y: 2 },
      { type: 'infantry', owner: 'blue', x: 11, y: 2 },
      { type: 'infantry', owner: 'blue', x: 12, y: 2 },
    ],
  });
  const bomber = unitOf(state, 'bomber');
  const [near, far] = Object.values(state.units).filter((u) => u.owner === 'blue');

  it('bombards the best defender on a tile within operational range, and comes home', () => {
    const { state: next, events } = ok(mission(state, bomber.id, 'bomb', near!.pos));
    const [hit] = ofType(events, 'bombarded');
    expect(hit).toMatchObject({ unitId: bomber.id, target: near!.id, strength: 16 });
    expect(hit!.hits + hit!.misses).toBe(3);
    expect(next.units[near!.id]!.hp).toBe(3 - hit!.damage);
    expect(next.units[bomber.id]!.pos).toEqual(bomber.pos);
  });

  it('refuses a target beyond operational range', () => {
    expect(reason(mission(state, bomber.id, 'bomb', far!.pos))).toMatch(/out of range/);
  });

  it('flies one sortie a turn, and again on its next turn', () => {
    const flown = ok(mission(state, bomber.id, 'bomb', near!.pos)).state;
    expect(reason(mission(flown, bomber.id, 'bomb', near!.pos))).toMatch(/already flown this turn/);
    const later = ok(applyActions(flown, [endTurn, endTurn])).state;
    expect(mission(later, bomber.id, 'bomb', near!.pos).ok).toBe(true);
  });

  it('needs an enemy on the tile', () => {
    expect(reason(mission(state, bomber.id, 'bomb', { x: 6, y: 2 }))).toMatch(/no enemy/);
  });

  it('is not flown by aircraft with no bombs', () => {
    const recon = makeState({
      cities: [{ name: 'Field', owner: 'red', x: 1, y: 1, size: 3, shieldsPerTurn: 1 }],
      units: [
        { type: 'fighter', owner: 'red', x: 1, y: 1 },
        { type: 'infantry', owner: 'blue', x: 3, y: 1 },
      ],
    });
    const scout = { ...recon.ruleset.unitTypes.fighter!, bombardStrength: 0 };
    const unarmed = {
      ...recon,
      ruleset: { ...recon.ruleset, unitTypes: { ...recon.ruleset.unitTypes, fighter: scout } },
    };
    expect(reason(mission(unarmed, unitOf(recon, 'fighter').id, 'bomb', { x: 3, y: 1 }))).toMatch(
      /cannot bomb/,
    );
  });

  it('is flown only by aircraft', () => {
    const tank = makeState({
      units: [
        { type: 'armour', owner: 'red', x: 1, y: 1 },
        { type: 'infantry', owner: 'blue', x: 3, y: 1 },
      ],
    });
    expect(reason(mission(tank, unitOf(tank, 'armour').id, 'bomb', { x: 3, y: 1 }))).toMatch(/Only aircraft/);
  });
});

describe('recon missions', () => {
  const state = makeState({
    width: 20,
    height: 4,
    cities: [
      { name: 'Field', owner: 'red', x: 1, y: 2, size: 3, shieldsPerTurn: 1 },
      { name: 'Far', owner: 'blue', x: 9, y: 2, size: 5, shieldsPerTurn: 1 },
    ],
    units: [
      { type: 'bomber', owner: 'red', x: 1, y: 2 },
      { type: 'infantry', owner: 'blue', x: 9, y: 2 },
      { type: 'infantry', owner: 'blue', x: 14, y: 2 },
    ],
  });
  const bomber = unitOf(state, 'bomber');
  const red = (s: GameState) => new Vision(s, 'red');

  it('reveals every tile within 2 of the target, units included, until the end of the turn', () => {
    expect(red(state).unitsAt({ x: 9, y: 2 })).toEqual([]);
    const next = ok(mission(state, bomber.id, 'recon', { x: 10, y: 2 })).state;
    expect(red(next).unitsAt({ x: 9, y: 2 })).toHaveLength(1);
    expect(red(next).at({ x: 12, y: 2 })).toBe('visible');
    expect(red(next).at({ x: 13, y: 2 })).toBe('unseen');
  });

  it('wears off when the turn ends, leaving the tiles remembered', () => {
    const scouted = ok(mission(state, bomber.id, 'recon', { x: 10, y: 2 })).state;
    const after = ok(applyAction(scouted, endTurn)).state;
    expect(red(after).at({ x: 9, y: 2 })).toBe('remembered');
    expect(red(after).cityAt({ x: 9, y: 2 })?.name).toBe('Far');
    expect(after.players[0]!.revealed).toEqual([]);
  });

  it('can scout any tile within operational range, enemy or not', () => {
    expect(mission(state, bomber.id, 'recon', { x: 11, y: 2 }).ok).toBe(true);
    expect(reason(mission(state, bomber.id, 'recon', { x: 12, y: 2 }))).toMatch(/out of range/);
  });

  it('does not bomb anything', () => {
    const { events } = ok(mission(state, bomber.id, 'recon', { x: 9, y: 2 }));
    expect(ofType(events, 'bombarded')).toEqual([]);
  });
});

/** The state with one unit type's numbers changed, to force a combat's outcome. */
function retype(state: GameState, type: string, patch: Partial<UnitTypeDef>): GameState {
  const unitTypes = { ...state.ruleset.unitTypes, [type]: { ...state.ruleset.unitTypes[type]!, ...patch } };
  return { ...state, ruleset: { ...state.ruleset, unitTypes } };
}

describe('air superiority and interception', () => {
  // Red's fighter covers up to (8,2); Blue's bombers reach as far as (4,2).
  const base = makeState({
    width: 30,
    height: 4,
    cities: [
      { name: 'Redfield', owner: 'red', x: 2, y: 2, size: 3, shieldsPerTurn: 1 },
      { name: 'Bluefield', owner: 'blue', x: 14, y: 2, size: 3, shieldsPerTurn: 1 },
    ],
    units: [
      { type: 'fighter', owner: 'red', x: 2, y: 2 },
      { type: 'infantry', owner: 'red', x: 6, y: 2 },
      { type: 'infantry', owner: 'red', x: 10, y: 2 },
      { type: 'bomber', owner: 'blue', x: 14, y: 2 },
      { type: 'bomber', owner: 'blue', x: 14, y: 2 },
      { type: 'fighter', owner: 'blue', x: 14, y: 2 },
    ],
  });
  const fighter = unitOf(base, 'fighter', 'red');
  const [b1, b2] = Object.values(base.units).filter((u) => u.type === 'bomber');
  const scout = unitOf(base, 'fighter', 'blue');
  const covered = { x: 6, y: 2 };
  const uncovered = { x: 10, y: 2 };
  const patrol: Action = { type: 'airSuperiority', unitId: fighter.id };

  /** Red puts the fighter up, then it's Blue's turn. */
  const onPatrol = (state: GameState) => ok(applyActions(state, [patrol, endTurn])).state;
  const fighterWins = onPatrol(retype(base, 'bomber', { defence: 0 }));
  const bomberWins = onPatrol(retype(base, 'fighter', { attack: 0 }));
  const intercepts = (state: GameState, unitId: number, kind: 'bomb' | 'recon', target: Coord) =>
    ofType(ok(mission(state, unitId, kind, target)).events, 'intercepted').length;

  it('is a stance only fighters can take, and uses their sortie', () => {
    const { state } = ok(applyAction(base, patrol));
    expect(state.units[fighter.id]!.stance).toBe('airSuperiority');
    expect(reason(applyAction(state, patrol))).toMatch(/already flown/);
    expect(reason(mission(state, fighter.id, 'recon', covered))).toMatch(/already flown/);
    const blueTurn = ok(applyAction(base, endTurn)).state;
    expect(reason(applyAction(blueTurn, { type: 'airSuperiority', unitId: b1!.id }))).toMatch(
      /cannot fly air superiority/,
    );
  });

  it('intercepts an enemy bomber flying a mission within its range, before it strikes', () => {
    const { state, events } = ok(mission(fighterWins, b1!.id, 'bomb', covered));
    const [interception] = ofType(events, 'intercepted');
    expect(interception).toMatchObject({ fighter: fighter.id, bomber: b1!.id, winner: fighter.id });
    expect(state.units[b1!.id]).toBeUndefined();
    expect(ofType(events, 'bombarded')).toEqual([]);
  });

  it('is a combat to the death; a surviving bomber completes its mission', () => {
    const { state, events } = ok(mission(bomberWins, b1!.id, 'bomb', covered));
    expect(ofType(events, 'intercepted')[0]).toMatchObject({ winner: b1!.id });
    expect(state.units[fighter.id]).toBeUndefined();
    expect(ofType(events, 'bombarded')).toHaveLength(1);
  });

  it('meets every fighter covering the target in turn, while it survives', () => {
    const pair = makeState({
      cities: [
        { name: 'Redfield', owner: 'red', x: 2, y: 2, size: 3, shieldsPerTurn: 1 },
        { name: 'Bluefield', owner: 'blue', x: 8, y: 2, size: 3, shieldsPerTurn: 1 },
      ],
      units: [
        { type: 'fighter', owner: 'red', x: 2, y: 2 },
        { type: 'fighter', owner: 'red', x: 2, y: 2 },
        { type: 'bomber', owner: 'blue', x: 8, y: 2 },
      ],
    });
    const [f1, f2] = Object.values(pair.units).filter((u) => u.type === 'fighter');
    const up = (s: GameState) =>
      ok(
        applyActions(s, [
          { type: 'airSuperiority', unitId: f1!.id },
          { type: 'airSuperiority', unitId: f2!.id },
          endTurn,
        ]),
      ).state;
    const bomber = unitOf(pair, 'bomber');
    const survives = ok(
      mission(up(retype(pair, 'fighter', { attack: 0 })), bomber.id, 'recon', { x: 4, y: 2 }),
    );
    expect(ofType(survives.events, 'intercepted').map((e) => e.fighter)).toEqual([f1!.id, f2!.id]);
    const falls = ok(mission(up(retype(pair, 'bomber', { defence: 0 })), bomber.id, 'recon', { x: 4, y: 2 }));
    expect(ofType(falls.events, 'intercepted').map((e) => e.fighter)).toEqual([f1!.id]);
    expect(falls.state.units[f2!.id]!.interceptsLeft).toBe(1);
  });

  it('intercepts bombers on recon too', () => {
    expect(intercepts(fighterWins, b1!.id, 'recon', covered)).toBe(1);
  });

  it('intercepts at most one bomber per enemy turn', () => {
    const first = ok(mission(fighterWins, b1!.id, 'recon', covered)).state;
    expect(intercepts(first, b2!.id, 'bomb', covered)).toBe(0);
  });

  it('intercepts again on the next enemy turn if put back on air superiority', () => {
    const first = ok(mission(fighterWins, b1!.id, 'recon', covered)).state;
    const again = ok(applyActions(first, [endTurn, patrol, endTurn])).state;
    expect(intercepts(again, b2!.id, 'bomb', covered)).toBe(1);
  });

  it('ends when its owner’s next turn starts', () => {
    const back = ok(applyAction(fighterWins, endTurn)).state;
    expect(back.units[fighter.id]!.stance).toBe('none');
    const next = ok(applyAction(back, endTurn)).state;
    expect(intercepts(next, b1!.id, 'bomb', covered)).toBe(0);
  });

  it('ignores missions beyond its operational range', () => {
    expect(intercepts(fighterWins, b1!.id, 'bomb', uncovered)).toBe(0);
  });

  it('ignores enemy fighters', () => {
    // (8,2) is at the edge of both fighters' range.
    expect(intercepts(fighterWins, b1!.id, 'recon', { x: 8, y: 2 })).toBe(1);
    expect(intercepts(fighterWins, scout.id, 'recon', { x: 8, y: 2 })).toBe(0);
  });

  it('needs the stance', () => {
    const idle = ok(applyAction(retype(base, 'bomber', { defence: 0 }), endTurn)).state;
    expect(intercepts(idle, b1!.id, 'bomb', covered)).toBe(0);
  });
});

describe('rebasing', () => {
  const state = makeState({
    terrain: ['gggggggggggggccc', 'gggggggggggggccc', 'gggggggggggggccc'],
    cities: [
      { name: 'Home', owner: 'red', x: 1, y: 1, size: 3, shieldsPerTurn: 1 },
      { name: 'Near', owner: 'red', x: 6, y: 1, size: 3, shieldsPerTurn: 1 },
      { name: 'Far', owner: 'red', x: 9, y: 1, size: 3, shieldsPerTurn: 1 },
      { name: 'Theirs', owner: 'blue', x: 5, y: 1, size: 3, shieldsPerTurn: 1 },
    ],
    units: [
      { type: 'fighter', owner: 'red', x: 1, y: 1 },
      { type: 'carrier', owner: 'red', x: 13, y: 1 },
      {
        type: 'carrier',
        owner: 'red',
        x: 14,
        y: 1,
        cargo: Array.from({ length: 4 }, () => ({ type: 'fighter' })),
      },
    ],
  });
  const fighter = unitOf(state, 'fighter');
  const city = (name: string) => Object.values(state.cities).find((c) => c.name === name)!;
  const [carrier, full] = Object.values(state.units).filter((u) => u.type === 'carrier');
  const rebase = (s: GameState, unitId: number, to: Extract<Action, { type: 'rebase' }>['to']) =>
    applyAction(s, { type: 'rebase', unitId, to });

  it('flies to another friendly city within operational range', () => {
    const { state: next, events } = ok(rebase(state, fighter.id, { kind: 'city', id: city('Near').id }));
    expect(next.units[fighter.id]).toMatchObject({
      pos: { x: 6, y: 1 },
      base: { kind: 'city', id: city('Near').id },
      carriedBy: null,
    });
    expect(ofType(events, 'unitMoved')).toHaveLength(1);
    expect(reason(rebase(next, fighter.id, { kind: 'city', id: city('Home').id }))).toMatch(/already flown/);
  });

  it('refuses a city out of range, an enemy city, or its own base', () => {
    expect(reason(rebase(state, fighter.id, { kind: 'city', id: city('Far').id }))).toMatch(/out of range/);
    expect(reason(rebase(state, fighter.id, { kind: 'city', id: city('Theirs').id }))).toMatch(
      /friendly city/,
    );
    expect(reason(rebase(state, fighter.id, { kind: 'city', id: city('Home').id }))).toMatch(/already based/);
  });

  /** Rebase the fighter one hop per turn, ending each of Red's turns. */
  const hops = (...stops: Extract<Action, { type: 'rebase' }>['to'][]) =>
    ok(
      applyActions(
        state,
        stops.flatMap((to) => [{ type: 'rebase', unitId: fighter.id, to } as Action, endTurn, endTurn]),
      ),
    ).state;
  const toCity = (name: string) => ({ kind: 'city', id: city(name).id }) as const;

  it('lands on a friendly carrier with room, and flies off it again', () => {
    const atFar = hops(toCity('Near'), toCity('Far'));
    const atSea = ok(rebase(atFar, fighter.id, { kind: 'carrier', id: carrier!.id })).state;
    expect(atSea.units[fighter.id]).toMatchObject({
      pos: { x: 13, y: 1 },
      carriedBy: carrier!.id,
      base: { kind: 'carrier', id: carrier!.id },
    });
    const back = ok(
      rebase(ok(applyActions(atSea, [endTurn, endTurn])).state, fighter.id, toCity('Far')),
    ).state;
    expect(back.units[fighter.id]).toMatchObject({ pos: { x: 9, y: 1 }, carriedBy: null });
  });

  it('refuses a full carrier', () => {
    const atFar = hops(toCity('Near'), toCity('Far'));
    expect(reason(rebase(atFar, fighter.id, { kind: 'carrier', id: full!.id }))).toMatch(/full/);
  });
});

describe('paradrops', () => {
  const state = makeState({
    terrain: ['gggggggggggg', 'gggggggggggg', 'gggggggggggg', 'ggggocgggggg'],
    cities: [
      { name: 'Drop', owner: 'red', x: 1, y: 2, size: 3, shieldsPerTurn: 1 },
      { name: 'Target', owner: 'blue', x: 6, y: 2, size: 3, shieldsPerTurn: 1 },
    ],
    units: [
      { type: 'paratrooper', owner: 'red', x: 1, y: 2 },
      { type: 'infantry', owner: 'red', x: 1, y: 2 },
      { type: 'paratrooper', owner: 'red', x: 3, y: 0 },
      { type: 'infantry', owner: 'blue', x: 5, y: 2 },
    ],
  });
  const [para, walker] = Object.values(state.units).filter((u) => u.type === 'paratrooper');
  const infantry = unitOf(state, 'infantry', 'red');
  const drop = (s: GameState, unitId: number, to: Coord) => applyAction(s, { type: 'paradrop', unitId, to });

  it('drops from a friendly city onto a tile up to 6 away, and can do nothing more that turn', () => {
    const { state: next } = ok(drop(state, para!.id, { x: 4, y: 2 }));
    expect(next.units[para!.id]).toMatchObject({ pos: { x: 4, y: 2 }, movesLeft: 0, justParadropped: true });
    expect(reason(applyAction(next, { type: 'move', unitId: para!.id, to: { x: 3, y: 2 } }))).toMatch(
      /no movement left/,
    );
    expect(reason(applyAction(next, { type: 'attack', unitId: para!.id, target: { x: 5, y: 2 } }))).toMatch(
      /no movement left/,
    );
  });

  it('reaches 6 tiles and no further', () => {
    expect(drop(state, para!.id, { x: 7, y: 2 }).ok).toBe(true);
    expect(reason(drop(state, para!.id, { x: 8, y: 2 }))).toMatch(/out of range/);
  });

  it('needs a tile with no enemy units, on land', () => {
    expect(reason(drop(state, para!.id, { x: 5, y: 2 }))).toMatch(/enemy/);
    expect(reason(drop(state, para!.id, { x: 4, y: 3 }))).toMatch(/land/);
  });

  it('takes an empty enemy city it lands in', () => {
    const { state: next, events } = ok(drop(state, para!.id, { x: 6, y: 2 }));
    expect(ofType(events, 'cityCaptured')).toHaveLength(1);
    expect(Object.values(next.cities).find((c) => c.name === 'Target')!.owner).toBe('red');
  });

  it('starts from a friendly city, before the unit has moved', () => {
    expect(reason(drop(state, walker!.id, { x: 5, y: 0 }))).toMatch(/friendly city/);
    const moved = ok(
      applyActions(state, [
        { type: 'move', unitId: para!.id, to: { x: 2, y: 2 } },
        endTurn,
        endTurn,
        { type: 'move', unitId: para!.id, to: { x: 1, y: 2 } },
      ]),
    ).state;
    expect(reason(drop(moved, para!.id, { x: 4, y: 2 }))).toMatch(/already moved/);
  });

  it('is only for airborne infantry', () => {
    expect(reason(drop(state, infantry.id, { x: 3, y: 2 }))).toMatch(/cannot paradrop/);
  });

  it('is never intercepted', () => {
    const guarded = makeState({
      cities: [
        { name: 'Drop', owner: 'red', x: 1, y: 2, size: 3, shieldsPerTurn: 1 },
        { name: 'Cover', owner: 'blue', x: 6, y: 2, size: 3, shieldsPerTurn: 1 },
      ],
      units: [
        { type: 'paratrooper', owner: 'red', x: 1, y: 2 },
        { type: 'fighter', owner: 'blue', x: 6, y: 2 },
      ],
    });
    const blueFighter = unitOf(guarded, 'fighter');
    const redTurn = ok(
      applyActions(guarded, [endTurn, { type: 'airSuperiority', unitId: blueFighter.id }, endTurn]),
    ).state;
    const { events } = ok(drop(redTurn, unitOf(guarded, 'paratrooper').id, { x: 4, y: 2 }));
    expect(ofType(events, 'intercepted')).toEqual([]);
  });
});
