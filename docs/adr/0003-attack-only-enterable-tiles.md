# A unit can only attack a tile it could legally move into

An attack is a move that has to fight its way in. If the attacker destroys the last defender, it advances into the tile, chess-style. So a unit may only attack tiles it could legally enter. Land units can't attack ships at sea. Ships can't attack land. Units without `canCaptureCities` can't attack an enemy city. Aircraft never attack; they only fly missions.

The only ways to hit across domains or at range are bombard and air missions. These never advance and, unless the unit has `lethalBombard`, never kill.

This goes against Civilization III, which lets units attack tiles they can't occupy. We chose it so that attacking and advancing are one rule, with no "won but stays put" special cases. When amphibious assault is added later, it will be a unit flag that widens the set of tiles that unit can enter, not an exception to this rule.
