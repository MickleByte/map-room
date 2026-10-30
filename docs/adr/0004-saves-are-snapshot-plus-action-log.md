# Pure deterministic reducer; saves are a snapshot plus the action log

All game logic lives in `src/core` as a pure function `applyAction(state, action)`, with no DOM, rendering or storage imports. The seeded RNG's state is part of `GameState`, so the same starting state and the same actions always produce the same game.

A save stores both the current state snapshot and the full action log since the scenario started. The snapshot makes loading instant. The log makes any bug reproducible and gives us replays and future multiplayer almost for free.

The cost is that nothing in `core` may read the clock, use `Math.random`, iterate in a non-deterministic order, or depend on the rendering. Changing the ruleset or the reducer can stop old action logs from replaying. Saves therefore carry a schema version, and the ruleset is embedded in the state rather than looked up when the game runs.

There is deliberately no undo: actions that move a unit can reveal hidden information, and combat uses the RNG.
