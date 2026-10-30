/**
 * Core game data. Everything in GameState is plain JSON-serialisable data so that
 * saves, replays and the AI worker can pass it around freely.
 */
import type { DefenceBreakdown } from './combat/modifiers';
import type { RngState } from './rng';
import type { Ruleset, VeteranLevel } from './ruleset';

export type PlayerId = string;
export type UnitId = number;
export type CityId = number;
export type UnitTypeId = string;
export type TerrainId = string;

export interface Coord {
  x: number;
  y: number;
}

/** Movement points counted in thirds (see THIRDS_PER_MP). */
export type MoveThirds = number;

// ---- state ----

export interface GameState {
  schemaVersion: 1;
  scenarioId: string;
  /** Embedded so saves replay identically (ADR-0004). */
  ruleset: Ruleset;
  map: GameMap;
  /** Array order is turn order. */
  players: Player[];
  /** Index into players. */
  currentPlayer: number;
  /** Increments each time play returns to players[0]. */
  turn: number;
  units: Record<UnitId, Unit>;
  cities: Record<CityId, City>;
  nextId: number;
  rng: RngState;
  winner: PlayerId | null;
}

export interface GameMap {
  width: number;
  height: number;
  wrapX: boolean;
  /** Row-major: index = y * width + x. */
  tiles: Tile[];
}

export interface Tile {
  terrain: TerrainId;
  /** River on this tile's south-east edge; the north-west edge is read from the NW neighbour. */
  riverSE: boolean;
  /** River on this tile's south-west edge; the north-east edge is read from the NE neighbour. */
  riverSW: boolean;
  road: boolean;
  /** Rail implies road. */
  rail: boolean;
  fortress: boolean;
}

export type VictoryCondition = { type: 'captureAllCities' };

export interface Player {
  id: PlayerId;
  name: string;
  colour: string;
  control: 'human' | 'ai';
  /** Meeting any one of these wins the game. */
  victoryConditions: VictoryCondition[];
  eliminated: boolean;
  /** Per tile: null = unseen; otherwise what the player last saw there. */
  remembered: (RememberedTile | null)[];
  /** Tiles revealed by recon, cleared at the end of this player's turn. */
  revealed: Coord[];
}

export interface RememberedTile {
  city: { id: CityId; owner: PlayerId; size: number; walls: boolean } | null;
}

export type AirStance = 'none' | 'airSuperiority';

export interface Unit {
  id: UnitId;
  type: UnitTypeId;
  owner: PlayerId;
  pos: Coord;
  hp: number;
  veteran: VeteranLevel;
  movesLeft: MoveThirds;
  fortified: boolean;
  /** Moved, attacked or bombarded this turn, so it does not heal. */
  actedThisTurn: boolean;
  /** The transport or carrier this unit is aboard. */
  carriedBy: UnitId | null;
  /** Aircraft only: the city or carrier it flies from. */
  base: { kind: 'city'; id: CityId } | { kind: 'carrier'; id: UnitId } | null;
  /** A reaction set up in advance during the owner's turn (ADR-0002). */
  stance: AirStance;
  interceptsLeft: number;
  orders: GotoOrder | null;
  justParadropped: boolean;
}

export interface GotoOrder {
  kind: 'goto';
  target: Coord;
}

export interface City {
  id: CityId;
  name: string;
  owner: PlayerId;
  pos: Coord;
  size: number;
  walls: boolean;
  shieldsPerTurn: number;
  shieldsStored: number;
  queue: UnitTypeId[];
  /** Re-queue the last item when it completes. */
  repeat: boolean;
}

// ---- actions ----

/** The actor is always players[currentPlayer]; actions on anyone else's units are rejected. */
export type Action =
  | { type: 'move'; unitId: UnitId; to: Coord }
  | { type: 'attack'; unitId: UnitId; target: Coord }
  | { type: 'bombard'; unitId: UnitId; target: Coord }
  | { type: 'fortify'; unitId: UnitId }
  | { type: 'board'; unitId: UnitId; carrierId: UnitId }
  | { type: 'setOrders'; unitId: UnitId; orders: GotoOrder | null }
  | { type: 'airMission'; unitId: UnitId; mission: 'bomb' | 'recon'; target: Coord }
  | { type: 'airSuperiority'; unitId: UnitId }
  | { type: 'rebase'; unitId: UnitId; to: { kind: 'city'; id: CityId } | { kind: 'carrier'; id: UnitId } }
  | { type: 'paradrop'; unitId: UnitId; to: Coord }
  | { type: 'setProduction'; cityId: CityId; queue: UnitTypeId[]; repeat: boolean }
  | { type: 'endTurn' };

// ---- events (derived output for animation and the combat log; never saved) ----

export type CombatRound = 'A' | 'D';

export type GameEvent =
  | { type: 'unitMoved'; unitId: UnitId; from: Coord; to: Coord }
  | {
      type: 'combat';
      attacker: UnitId;
      defender: UnitId;
      /** Who won each round, in order. */
      rounds: CombatRound[];
      winner: UnitId;
      /** The attacker's strength. */
      attack: number;
      /** The defender's strength, itemised. */
      defence: DefenceBreakdown;
    }
  | {
      type: 'bombarded';
      unitId: UnitId;
      target: UnitId;
      hits: number;
      misses: number;
      /** HP actually lost: hits past the 1 HP floor do nothing. */
      damage: number;
      /** The bombarding unit's bombard strength. */
      strength: number;
      /** The target's strength, itemised. */
      defence: DefenceBreakdown;
    }
  | { type: 'intercepted'; fighter: UnitId; bomber: UnitId; rounds: CombatRound[]; winner: UnitId }
  | { type: 'unitDestroyed'; unitId: UnitId }
  | { type: 'unitCaptured'; unitId: UnitId; newOwner: PlayerId }
  | { type: 'unitPromoted'; unitId: UnitId; to: VeteranLevel }
  | { type: 'cityCaptured'; cityId: CityId; newOwner: PlayerId }
  | { type: 'unitBuilt'; unitId: UnitId; cityId: CityId }
  | { type: 'turnStarted'; player: PlayerId; turn: number }
  | { type: 'gameWon'; winner: PlayerId };

export type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; reason: string };
