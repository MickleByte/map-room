# Map Room

A turn-based strategy game about late-game combat scenarios: players fight over cities on an isometric map with land, sea and air forces.

## Game and turns

**Scenario**:
A hand-made starting setup: map, players, cities, starting units and victory conditions.
_Avoid_: Level, mission (mission means an air mission)

**Player**:
One side in a game, controlled by a human or by the AI.
_Avoid_: Civ, faction, nation

**Turn**:
One player's complete go: they act with all their units and cities, then play passes to the next player.
_Avoid_: Round (round means a combat round)

**Action**:
A single player command that changes the game, such as a move, an attack or ending the turn.
_Avoid_: Command, move (move is one kind of action)

**Action log**:
The ordered list of every action taken since the scenario started.
_Avoid_: History, replay

**Ruleset**:
The tables of numbers that define the game: terrain, unit types and combat modifiers.
_Avoid_: Config, settings

**Victory condition**:
A goal belonging to one player; meeting any of their goals wins the game.

## Map

**Tile**:
One diamond-shaped square of the map, with a single terrain type.
_Avoid_: Cell, hex, square

**Terrain**:
The ground type of a tile, which sets its movement cost and defence bonus.

**River**:
A line along a tile edge that gives a defence bonus to units attacked across it.

**Road**:
A tile improvement that lowers the movement cost of entering the tile.

**Rail**:
A tile improvement that makes entering the tile free.
_Avoid_: Railroad

**Fortress**:
A tile improvement that gives defenders a defence bonus and counts them as fortified.

**Wrap**:
The map joining at its east and west edges, so units can move off one side and onto the other.

## Visibility

**Unseen**:
A tile the player has never seen.

**Remembered**:
A tile the player has seen before but cannot see now; it shows terrain and cities as last seen, with no units.
_Avoid_: Explored, fogged

**Visible**:
A tile the player can currently see, units included.

**Sight**:
How many tiles away a unit or city can see.

## Units

**Unit**:
One military piece on the map, belonging to one player.
_Avoid_: Piece, troop

**Unit type**:
The definition that every unit of that kind shares, such as its attack, defence and movement.
_Avoid_: Class, template

**Domain**:
Where a unit operates: land, sea or air.

**Stack**:
All the units on one tile.
_Avoid_: Army, group

**HP**:
How much damage a unit can take before it is destroyed; the maximum depends on its veteran level.
_Avoid_: Health, hit points, strength

**Veteran level**:
A unit's experience grade: Conscript, Regular, Veteran or Elite.
_Avoid_: Rank, experience

**Promotion**:
A unit moving up one veteran level after winning a combat.

**Fortified**:
The state of a land unit that has dug in and gains a defence bonus until it moves.

**Go-to order**:
A standing instruction for a unit to keep moving toward a destination over several turns.
_Avoid_: Path, waypoint

**Cargo**:
Units being carried by a transport or a carrier.

## Combat

**Attack**:
A unit fighting the best defender on a tile it could legally move into.
_Avoid_: Assault, battle

**Combat**:
One fight between two units, settled over a series of combat rounds until one is destroyed.

**Combat round**:
One exchange within a combat, in which the loser loses 1 HP.
_Avoid_: Turn, tick

**Best defender**:
The unit in a stack with the highest defence after modifiers; it fights when the tile is attacked.

**Advance**:
The attacker moving into a tile once the attack has destroyed its last defender.

**Capture**:
Taking ownership of an enemy city, or of enemy units that cannot defend, by advancing into their tile.

**Bombard**:
A ranged attack that damages a unit's HP without moving in; it usually cannot destroy the target.
_Avoid_: Shelling, artillery strike

**Rate of fire**:
How many bombard rounds one bombard fires.

**Combat odds**:
The exact chance that an attack will succeed, shown before the player commits to it.

## Air

**Base**:
The friendly city or carrier an aircraft operates from.
_Avoid_: Airfield, home

**Operational range**:
How far from its base an aircraft can fly a mission.

**Mission**:
A round trip by an aircraft from its base: a bombing run, recon, or air superiority.

**Air superiority**:
A fighter mission, set up during its owner's turn, in which it waits to intercept enemy bombers on the enemy's turn.
_Avoid_: Patrol, CAP

**Interception**:
A fighter on air superiority fighting an enemy bomber flying a mission within its operational range.

**Rebase**:
An aircraft moving permanently to a different base.

**Paradrop**:
Airborne infantry dropping from a city onto a tile some distance away.

## Cities

**City**:
A settlement that produces units, heals units and bases aircraft; it is the main objective in a scenario.
_Avoid_: Town, base (base means an air base)

**City size**:
A number that sets how strong a city's defence bonus is.
_Avoid_: Population

**Walls**:
City defences that add a defence bonus to small cities.

**Shields**:
The production a city puts toward units each turn.
_Avoid_: Production points, hammers

**Production queue**:
The ordered list of units a city will build.
