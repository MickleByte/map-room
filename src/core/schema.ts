/**
 * zod schemas for a GameState and an Action, so saved games read from a file or from
 * storage are checked before they reach the reducer (a bad file fails with a clear
 * message instead of a crash halfway through the game).
 */
import { z } from 'zod';
import { rulesetSchema } from './ruleset';
import type { Action, GameState } from './types';

const int = z.number().int();
const id = int.positive();
const coord = z.object({ x: int, y: int });
const playerId = z.string().min(1);
const veteran = z.enum(['conscript', 'regular', 'veteran', 'elite']);
const goto = z.object({ kind: z.literal('goto'), target: coord });
const airBase = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('city'), id }),
  z.object({ kind: z.literal('carrier'), id }),
]);

const tileSchema = z.object({
  terrain: z.string(),
  riverSE: z.boolean(),
  riverSW: z.boolean(),
  road: z.boolean(),
  rail: z.boolean(),
  fortress: z.boolean(),
});

const playerSchema = z.object({
  id: playerId,
  name: z.string(),
  colour: z.string(),
  control: z.enum(['human', 'ai']),
  victoryConditions: z.array(z.object({ type: z.literal('captureAllCities') })),
  eliminated: z.boolean(),
  remembered: z.array(
    z
      .object({
        city: z.object({ id, owner: playerId, size: int.positive(), walls: z.boolean() }).nullable(),
      })
      .nullable(),
  ),
  revealed: z.array(coord),
});

const unitSchema = z.object({
  id,
  type: z.string(),
  owner: playerId,
  pos: coord,
  hp: int.positive(),
  veteran,
  movesLeft: int.nonnegative(),
  fortified: z.boolean(),
  actedThisTurn: z.boolean(),
  carriedBy: id.nullable(),
  base: airBase.nullable(),
  stance: z.enum(['none', 'airSuperiority']),
  interceptsLeft: int.nonnegative(),
  orders: goto.nullable(),
  justParadropped: z.boolean(),
});

const citySchema = z.object({
  id,
  name: z.string(),
  owner: playerId,
  pos: coord,
  size: int.positive(),
  walls: z.boolean(),
  shieldsPerTurn: int.nonnegative(),
  shieldsStored: int.nonnegative(),
  queue: z.array(z.string()),
  repeat: z.boolean(),
});

// sfc32 words; the generator keeps them as signed or unsigned 32-bit integers.
const word = int.min(-0x80000000).max(0xffffffff);

export const gameStateSchema: z.ZodType<GameState> = z
  .object({
    schemaVersion: z.literal(1),
    scenarioId: z.string(),
    ruleset: rulesetSchema,
    map: z.object({
      width: int.positive(),
      height: int.positive(),
      wrapX: z.boolean(),
      tiles: z.array(tileSchema),
    }),
    players: z.array(playerSchema).min(2),
    currentPlayer: int.nonnegative(),
    turn: int.positive(),
    units: z.record(z.string(), unitSchema),
    cities: z.record(z.string(), citySchema),
    nextId: id,
    rng: z.tuple([word, word, word, word]),
    winner: playerId.nullable(),
  })
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const tiles = s.map.width * s.map.height;
    if (s.map.tiles.length !== tiles)
      issue(
        ['map', 'tiles'],
        `has ${s.map.tiles.length} tiles but the map is ${s.map.width}×${s.map.height}`,
      );
    if (s.currentPlayer >= s.players.length)
      issue(['currentPlayer'], `is ${s.currentPlayer} but there are ${s.players.length} players`);
    s.players.forEach((p, i) => {
      if (p.remembered.length !== tiles)
        issue(['players', i, 'remembered'], `has ${p.remembered.length} entries for ${tiles} tiles`);
    });
    for (const [key, record] of [
      ['units', s.units],
      ['cities', s.cities],
    ] as const)
      for (const [k, v] of Object.entries(record))
        if (v.id !== Number(k)) issue([key, k, 'id'], `is ${v.id} but it is stored under ${k}`);
  });

export const actionSchema: z.ZodType<Action> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), unitId: id, to: coord }),
  z.object({ type: z.literal('attack'), unitId: id, target: coord }),
  z.object({ type: z.literal('bombard'), unitId: id, target: coord }),
  z.object({ type: z.literal('fortify'), unitId: id }),
  z.object({ type: z.literal('board'), unitId: id, carrierId: id }),
  z.object({ type: z.literal('setOrders'), unitId: id, orders: goto.nullable() }),
  z.object({
    type: z.literal('airMission'),
    unitId: id,
    mission: z.enum(['bomb', 'recon']),
    target: coord,
  }),
  z.object({ type: z.literal('airSuperiority'), unitId: id }),
  z.object({ type: z.literal('rebase'), unitId: id, to: airBase }),
  z.object({ type: z.literal('paradrop'), unitId: id, to: coord }),
  z.object({
    type: z.literal('setProduction'),
    cityId: id,
    queue: z.array(z.string()),
    repeat: z.boolean(),
  }),
  z.object({ type: z.literal('endTurn') }),
]);
