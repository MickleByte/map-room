/** Victory: checked after every action. Mutates a draft state. */
import type { GameEvent, GameState, Player, VictoryCondition } from './types';

/**
 * Declare a winner if any player now meets one of their victory conditions. The
 * acting player is checked first, then the others in turn order.
 */
export function checkVictory(state: GameState, events: GameEvent[]): void {
  if (state.winner) return;
  const count = state.players.length;
  for (let i = 0; i < count; i++) {
    const player = state.players[(state.currentPlayer + i) % count]!;
    if (player.victoryConditions.some((goal) => met(state, player, goal))) {
      state.winner = player.id;
      events.push({ type: 'gameWon', winner: player.id });
      return;
    }
  }
}

function met(state: GameState, player: Player, goal: VictoryCondition): boolean {
  switch (goal.type) {
    case 'captureAllCities':
      // Every opponent has lost all their cities.
      return Object.values(state.cities).every((city) => city.owner === player.id);
  }
}
