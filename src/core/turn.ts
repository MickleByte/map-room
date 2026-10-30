/** Turn flow: ending one player's turn and starting the next. Mutates a draft state. */
import { fullMoves } from './movement';
import { maxHp } from './ruleset';
import { cityAt, currentPlayer, unitsOf } from './state';
import type { GameEvent, GameState, Unit } from './types';
import { advanceOrders } from './units';

export function endTurn(state: GameState, events: GameEvent[]): void {
  const count = state.players.length;
  let next = state.currentPlayer;
  do {
    next = (next + 1) % count;
    if (next === 0) state.turn++;
  } while (state.players[next]!.eliminated && next !== state.currentPlayer);
  state.currentPlayer = next;
  startTurn(state, events);
}

/** Refresh the current player's units, then carry out their standing go-to orders. */
export function startTurn(state: GameState, events: GameEvent[]): void {
  const player = currentPlayer(state);
  events.push({ type: 'turnStarted', player: player.id, turn: state.turn });

  const units = unitsOf(state, player.id).sort((a, b) => a.id - b.id);
  for (const unit of units) {
    if (!unit.actedThisTurn) heal(state, unit);
    unit.movesLeft = fullMoves(state, unit);
    unit.actedThisTurn = false;
    unit.justParadropped = false;
    unit.interceptsLeft = state.ruleset.air.interceptsPerTurn;
  }
  for (const unit of units) {
    if (unit.orders && state.units[unit.id]) advanceOrders(state, unit, events);
  }
}

/** A unit that rested last turn recovers: fully in a friendly city, otherwise a little. */
function heal(state: GameState, unit: Unit): void {
  const { healing } = state.ruleset;
  const max = maxHp(state.ruleset, unit.veteran);
  const city = cityAt(state, unit.pos);
  const inFriendlyCity = city?.owner === unit.owner;
  unit.hp = inFriendlyCity && healing.fullInFriendlyCity ? max : Math.min(max, unit.hp + healing.perTurn);
}
