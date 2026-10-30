# Strictly sequential turns; reactions are set up in advance

Players take whole turns in a fixed order: A acts with everything, then B, then A again. The game never pauses to ask the defending player anything during someone else's turn.

Anything that happens on an enemy's turn has to be set up in advance by the defender on their own turn. In Milestone 1 the only such reaction is a fighter on air superiority. The engine then resolves it automatically inside the acting player's action, for example when a bomber flies into an interceptor's range.

We chose this over reaction prompts or simultaneous turns for three reasons. Every action resolves completely from the state plus the RNG. The AI runs uninterrupted in its worker. Hotseat or networked play later needs no extra round trips. Later reactions, such as defensive bombard, must follow the same pattern: a stance set during the owner's turn and resolved automatically.
