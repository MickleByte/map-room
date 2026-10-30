# Map Room — Milestone 1 proposal

Status: **awaiting approval**. Decisions agreed so far are recorded in [GLOSSARY.md](../GLOSSARY.md) and [docs/adr/](adr/). This document covers the folder structure, the core types, the draft roster and ruleset, and the build plan.

Items marked **⚑** are choices I made that weren't covered in our Q&A. Each is easy to change; please confirm or override them.

---

## 1. Folder structure

```
map-room/
├── index.html
├── package.json            # npm; vite, typescript, pixi.js v8, vitest, eslint, prettier, playwright
├── tsconfig.json
├── vite.config.ts          # also holds the vitest config
├── eslint.config.js        # bans DOM/pixi/idb imports inside src/core and src/ai
├── src/
│   ├── core/               # PURE game logic: (state, action) => newState. No DOM, no Pixi, no IndexedDB.
│   │   ├── types.ts        # GameState, Unit, Tile, City, Player, Action, GameEvent
│   │   ├── rng.ts          # seeded PRNG (sfc32); its state lives in GameState
│   │   ├── grid.ts         # coords, wrap, neighbours, distance, river-crossing test
│   │   ├── ruleset.ts      # Ruleset types, validation, lookups
│   │   ├── scenario.ts     # scenario JSON → initial GameState (validated)
│   │   ├── movement.ts     # move costs, A* pathfinding, reachable tiles, enter-ability
│   │   ├── visibility.ts   # sight, remembered tiles, recon reveals
│   │   ├── combat/
│   │   │   ├── modifiers.ts  # attack/defence modifier stack, itemised for the UI
│   │   │   ├── odds.ts       # exact win probability (DP over HP); no RNG
│   │   │   ├── resolve.ts    # combat rounds, best defender, advance, capture
│   │   │   ├── bombard.ts
│   │   │   └── air.ts        # missions, interception
│   │   ├── cities.ts       # production, capture
│   │   ├── turn.ts         # end turn, start-of-turn processing (healing, production, go-to orders)
│   │   ├── victory.ts
│   │   ├── reducer.ts      # applyAction(): validate → apply → events
│   │   └── queries.ts      # read-only helpers for the UI and AI (legal targets, odds preview…)
│   ├── ai/
│   │   ├── decide.ts       # pure: (state, playerId) => Action[]
│   │   ├── evaluate.ts     # threat/target scoring helpers
│   │   └── worker.ts       # Web Worker wrapper around decide()
│   ├── data/
│   │   ├── ruleset.json    # terrain, combat modifiers, veteran levels, misc constants
│   │   ├── units.json      # unit types
│   │   └── scenarios/
│   │       └── the-straits.json
│   ├── persistence/
│   │   ├── saves.ts        # IndexedDB save slots + autosave
│   │   └── files.ts        # JSON export/import for saves and scenarios
│   ├── render/             # PixiJS only; reads state, never changes it
│   │   ├── iso.ts          # grid ↔ screen projection, wrap-aware
│   │   ├── mapLayer.ts     # terrain, rivers, roads/rails, fortresses, cities
│   │   ├── unitLayer.ts    # stacks, HP bars, veteran pips, selection
│   │   ├── fogLayer.ts
│   │   ├── overlays.ts     # path preview, attack/bombard range, mission range
│   │   ├── camera.ts       # pan / zoom / wrap
│   │   ├── minimap.ts
│   │   ├── animator.ts     # plays GameEvents (moves, combat, bombard) with speed/skip
│   │   └── art.ts          # placeholder shapes and icons drawn in code
│   ├── ui/                 # DOM panels over the canvas
│   │   ├── unitPanel.ts
│   │   ├── tilePanel.ts
│   │   ├── cityPanel.ts    # production queue
│   │   ├── oddsTooltip.ts
│   │   ├── combatLog.ts
│   │   ├── topBar.ts       # turn, player, end turn
│   │   ├── menus.ts        # new game / save / load / import / export
│   │   └── endScreen.ts    # victory / defeat
│   ├── app/
│   │   ├── controller.ts   # owns GameState; turns input into Actions; runs the AI turn via the worker
│   │   └── input.ts        # mouse/keyboard → intents
│   └── main.ts
├── tests/                  # (unit tests live next to their code as *.test.ts; this holds fixtures)
│   └── fixtures/           # tiny hand-written maps/states for tests
└── e2e/                    # Playwright: smoke tests + screenshots used while building
```

The boundary is `core ← ai ← app → render/ui/persistence`. The `core` and `ai` folders import nothing from the others, and ESLint enforces this.

## 2. Core data types

These are a sketch, not final signatures. Everything in `GameState` is plain, JSON-serialisable data.

```ts
// ---- ids & geometry ----
type PlayerId = string;
type UnitId = number;
type CityId = number;
type UnitTypeId = string;
type TerrainId = string;
interface Coord {
  x: number;
  y: number;
}

// Movement is counted in thirds, so a road (1/3 MP) is an integer. 1 MP = 3 "move units". ⚑
type MoveUnits = number;

// ---- state ----
interface GameState {
  schemaVersion: 1;
  scenarioId: string;
  ruleset: Ruleset; // embedded so saves replay identically (ADR-0004)
  map: GameMap;
  players: Player[]; // array order = turn order
  currentPlayer: number; // index into players
  turn: number; // increments when play returns to players[0]
  units: Record<UnitId, Unit>;
  cities: Record<CityId, City>;
  nextId: number;
  rng: RngState; // [a, b, c, d] for sfc32
  winner: PlayerId | null;
}

interface GameMap {
  width: number;
  height: number;
  wrapX: boolean;
  tiles: Tile[]; // row-major: index = y * width + x
}

interface Tile {
  terrain: TerrainId;
  riverSE: boolean; // river on this tile's south-east edge; NW is read from the NW neighbour
  riverSW: boolean; // river on this tile's south-west edge; NE is read from the NE neighbour
  road: boolean;
  rail: boolean; // implies road
  fortress: boolean;
}

interface Player {
  id: PlayerId;
  name: string;
  colour: string;
  control: 'human' | 'ai';
  victoryConditions: VictoryCondition[]; // M1: [{ type: 'captureAllCities', of: PlayerId }]
  eliminated: boolean;
  remembered: (RememberedTile | null)[]; // per tile; null = unseen
  revealed: Coord[]; // recon reveals, cleared at the end of this player's turn
}

interface RememberedTile {
  cityId?: CityId;
  cityOwner?: PlayerId;
  citySize?: number;
  walls?: boolean;
}

interface Unit {
  id: UnitId;
  type: UnitTypeId;
  owner: PlayerId;
  pos: Coord;
  hp: number;
  veteran: 'conscript' | 'regular' | 'veteran' | 'elite';
  movesLeft: MoveUnits;
  fortified: boolean;
  actedThisTurn: boolean; // moved/attacked/bombarded → no healing
  carriedBy: UnitId | null; // on a transport or carrier
  base: CityId | UnitId | null; // aircraft only: city or carrier
  stance: 'none' | 'airSuperiority'; // reaction set up in advance (ADR-0002)
  interceptsLeft: number;
  orders: { kind: 'goto'; target: Coord } | null;
  justParadropped: boolean;
}

interface City {
  id: CityId;
  name: string;
  owner: PlayerId;
  pos: Coord;
  size: number;
  walls: boolean;
  shieldsPerTurn: number;
  shieldsStored: number;
  queue: UnitTypeId[];
  repeat: boolean; // re-queue the last item when it completes
}

// ---- actions (the action log is Action[]) ----
type Action =
  | { type: 'move'; unitId: UnitId; to: Coord } // one step; also boards/disembarks transports
  | { type: 'attack'; unitId: UnitId; target: Coord }
  | { type: 'bombard'; unitId: UnitId; target: Coord }
  | { type: 'fortify'; unitId: UnitId }
  | { type: 'board'; unitId: UnitId; carrierId: UnitId } // boarding in a city, where the carrier shares the tile
  | { type: 'setOrders'; unitId: UnitId; orders: Unit['orders'] }
  | { type: 'airMission'; unitId: UnitId; mission: 'bomb' | 'recon'; target: Coord }
  | { type: 'airSuperiority'; unitId: UnitId }
  | { type: 'rebase'; unitId: UnitId; to: CityId | UnitId }
  | { type: 'paradrop'; unitId: UnitId; to: Coord }
  | { type: 'setProduction'; cityId: CityId; queue: UnitTypeId[]; repeat: boolean }
  | { type: 'endTurn' };
// The actor is always state.players[state.currentPlayer]; actions on another player's units are rejected.

// ---- reducer ----
type ApplyResult = { ok: true; state: GameState; events: GameEvent[] } | { ok: false; reason: string };
function applyAction(state: GameState, action: Action): ApplyResult;

// Events drive animation and the combat log; they are derived output, not stored in saves.
type GameEvent =
  | { type: 'unitMoved'; unitId: UnitId; from: Coord; to: Coord }
  | {
      type: 'combat';
      attacker: UnitId;
      defender: UnitId;
      rounds: ('A' | 'D')[];
      winner: UnitId;
      modifiers: ModifierBreakdown;
    }
  | { type: 'bombarded'; unitId: UnitId; target: UnitId; hits: number; misses: number }
  | { type: 'intercepted'; fighter: UnitId; bomber: UnitId; rounds: ('A' | 'D')[]; winner: UnitId }
  | { type: 'unitDestroyed'; unitId: UnitId }
  | { type: 'unitCaptured'; unitId: UnitId; newOwner: PlayerId }
  | { type: 'unitPromoted'; unitId: UnitId; to: Unit['veteran'] }
  | { type: 'cityCaptured'; cityId: CityId; newOwner: PlayerId }
  | { type: 'unitBuilt'; unitId: UnitId; cityId: CityId }
  | { type: 'turnStarted'; player: PlayerId; turn: number }
  | { type: 'gameWon'; winner: PlayerId };

// ---- save file ----
interface SaveFile {
  schemaVersion: 1;
  name: string;
  savedAt: string; // set by persistence, never by core
  initialState: GameState;
  actions: Action[];
  state: GameState; // snapshot; must equal replay(initialState, actions)
}
```

⚑ **Immutability.** The reducer uses **Immer** (`produce`) so updates stay readable and the state stays immutable. The alternative is hand-written spread updates.

⚑ **Validation.** Scenario and save JSON is validated with **zod** when it's imported, so a bad file fails with a clear message instead of a crash halfway through the game.

## 3. Draft ruleset (edit freely)

### Terrain

| Terrain   | Move cost (MP) | Defence | Notes                |
| --------- | -------------- | ------- | -------------------- |
| Grassland | 1              | +0%     |                      |
| Plains    | 1              | +0%     |                      |
| Desert    | 1              | +10%    |                      |
| Tundra    | 1              | +0%     |                      |
| Forest    | 2              | +25%    |                      |
| Jungle    | 2              | +25%    |                      |
| Marsh     | 2              | +20%    |                      |
| Hills     | 2              | +50%    | +1 sight             |
| Mountains | 3              | +100%   | +1 sight             |
| Coast     | 1 (sea)        | +0%     | sea; all ships       |
| Ocean     | 1 (sea)        | +0%     | sea; all ships in M1 |

### Modifiers and constants

| Setting                                  | Default                                                                |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| River crossing (defence)                 | +25%                                                                   |
| Fortified (defence)                      | +25%                                                                   |
| Fortress (defence, implies fortified)    | +50%                                                                   |
| City size 1–6                            | +0%, or **+100% with walls**                                           |
| City size 7–12                           | +50% (walls ignored)                                                   |
| City size 13+                            | +100% (walls ignored)                                                  |
| Modifiers stack                          | additively (e.g. hills 50% + fortified 25% + river 25% = ×2.0) ⚑       |
| Road cost                                | 1/3 MP                                                                 |
| Rail cost                                | 0                                                                      |
| HP by veteran level                      | 2 / 3 / 4 / 5                                                          |
| Promotion chance on a win                | 1 in 5 (attacker or defender; not bombard/air)                         |
| Healing                                  | +1 HP if the unit didn't act; full HP in a friendly city               |
| Attack cost                              | 1 MP; needs > 0 MP left                                                |
| Bombard cost                             | all remaining MP; target cannot fall below 1 HP unless `lethalBombard` |
| Transport / carrier capacity             | 4 / 4                                                                  |
| Interceptions per fighter per enemy turn | 1                                                                      |
| Recon reveal radius                      | 2                                                                      |
| City sight                               | 2                                                                      |
| Paradrop range                           | 6                                                                      |

⚑ **Stacking modifiers.** Bonuses add together, then multiply once. The alternative is multiplying each bonus separately, which snowballs: hills plus fortress plus river would give ×2.8 instead of ×2.0.

⚑ **Interception combat.** An interception is an ordinary combat to the death: the fighter's attack against the bomber's defence, reusing the normal resolver. Whichever survives carries on; a surviving bomber completes its mission. This replaces the "short air combat" from our Q&A. If you'd rather it be capped at N rounds, it's a single setting.

### Units

These are original names, and all numbers live in `units.json`. Range and operational range are in tiles. "Bombard" is strength / range / rate of fire.

| Id             | Name                | Dom  | Atk | Def | Move | Bombard    | Op range | Sight | Cost | Flags                      |
| -------------- | ------------------- | ---- | --- | --- | ---- | ---------- | -------- | ----- | ---- | -------------------------- |
| infantry       | Line Infantry       | land | 4   | 10  | 1    | –          | –        | 1     | 90   | canCaptureCities           |
| mechInfantry   | Mechanised Infantry | land | 6   | 18  | 3    | –          | –        | 1     | 110  | canCaptureCities           |
| armour         | Battle Tank         | land | 24  | 16  | 3    | –          | –        | 1     | 140  | canCaptureCities           |
| antiTank       | Tank Hunter         | land | 10  | 14  | 1    | –          | –        | 1     | 80   | canCaptureCities           |
| artillery      | Field Battery       | land | 0   | 0   | 1    | 12 / 2 / 2 | –        | 1     | 80   | — (captured if left alone) |
| radarArtillery | Radar Battery       | land | 0   | 0   | 2    | 18 / 3 / 3 | –        | 2     | 120  | —                          |
| paratrooper    | Airborne Infantry   | land | 6   | 9   | 1    | –          | –        | 1     | 100  | canCaptureCities, paradrop |
| fighter        | Interceptor         | air  | 8   | 4   | –    | 2 / – / 1  | 6        | 2     | 100  | airSuperiority             |
| bomber         | Strategic Bomber    | air  | 0   | 3   | –    | 16 / – / 3 | 10       | 2     | 140  | —                          |
| transport      | Troopship           | sea  | 0   | 6   | 5    | –          | –        | 1     | 100  | cargo: 4 land              |
| destroyer      | Escort Destroyer    | sea  | 12  | 10  | 8    | 6 / 1 / 1  | –        | 2     | 100  | —                          |
| battleship     | Dreadnought         | sea  | 18  | 18  | 5    | 12 / 2 / 3 | –        | 2     | 180  | —                          |
| carrier        | Fleet Carrier       | sea  | 0   | 10  | 5    | –          | –        | 2     | 160  | cargo: 4 air               |

Aircraft bombard range is "anywhere within operational range", so their Range column shows "–". There's no anti-tank bonus against armour yet, so the Tank Hunter is simply a cheap, strong defender with some attack. A unit-vs-unit bonus system can come later.

## 4. Sample scenario: "The Straits"

- A map 60 columns wide by 80 staggered rows (about 60×40 tile-widths on screen) that wraps left–right. Two continents are split by a sea channel 3–6 tiles wide, with one land bridge guarded by a fortress line.
- Rivers cross both continents, and there are hill ridges and a mountain spine on one side.
- There are 6 cities per side, with sizes from 3 to 14 so every city-size tier shows up. Some cities have walls.
- Starting forces bring every system into play within the first few turns:
  - infantry and anti-tank dug in on the fortress line
  - armour and mech infantry ready to attack
  - artillery and radar artillery behind the front
  - a destroyer and battleship task force in the channel
  - a transport with cargo aboard
  - a carrier with fighters
  - land-based fighters and bombers
  - paratroopers in a rear city

## 5. Build plan

Each step ends green: tests pass, `tsc` is clean, and steps with visible output get a Playwright screenshot I check myself.

1. **Scaffold.** Vite + TS + Pixi v8 + Vitest + ESLint/Prettier + Playwright, with the import-boundary lint rule. Shows a blank canvas.
2. **Core foundations.** Types, the seeded RNG, wrap-aware grid helpers (neighbours, distance, river crossing), ruleset and unit JSON with validation, and the scenario loader. A small test scenario. _Tests: RNG determinism, wrap distance, the river-crossing rule, scenario validation errors._
3. **Map rendering.** Isometric terrain, rivers, roads and rails, fortresses, cities and placeholder art. Camera pan and zoom with wrap-around drawing, the minimap, tile selection and the tile info panel.
4. **Units and movement.** Unit and stack rendering, the unit panel and selection cycling. Movement costs in thirds and the "can always enter while MP > 0" rule. A* pathfinding with a path preview showing turn counts. The move action and go-to orders. _Tests: movement costs with roads, rail and terrain; paths across the wrap; the partial-MP rule._
5. **Fog of war.** Sight (+1 on hills and mountains), remembered tiles and the fog layer.
6. **Combat.** The itemised modifier stack, best-defender choice, exact odds, round resolution, killing defenders one by one, advance and capture (including defence-0 units), promotion, fortify and healing. The odds tooltip and combat log. _Tests: every modifier, the odds maths against brute-force enumeration, seeded combat outcomes, the attack-only-enterable-tiles rule (ADR-0003)._
7. **Bombard.** Land and sea bombard, range checks, the non-lethal floor and range overlays. _Tests: the floor, lethal bombard, range across the wrap._
8. **Sea.** Boarding and disembarking, transport cargo, carriers, and cargo sinking with its ship. Ship-vs-ship combat.
9. **Air.** Bases, operational range, bombing and recon missions, rebase, the air superiority stance and interception, and paradrops. _Tests: interception triggering and limits, range checks, recon reveal and expiry._
10. **Cities and turn flow.** Production with overflow and repeat, the city panel, city capture (−1 size, queue cleared), start-of-turn processing (production, healing, go-to orders, resetting stances), end turn, the victory check and the end screen. _Tests: production overflow, capture effects, victory._
11. **AI.** A pure `decide()` running in the worker. Priorities in order:
    1. garrison threatened cities
    2. bombard before attacking
    3. attack when the odds are at least a threshold (default 65%) ⚑
    4. bombers on the best targets in range, fighters on air superiority over threatened cities
    5. advance toward the nearest enemy city
    6. produce units to fill gaps

    The AI's turn plays back through the animator with speed and skip controls. _Tests: AI decisions on small fixture states (it bombards first, declines bad odds, garrisons an empty city)._

12. **Persistence.** IndexedDB save slots, an autosave at the start of each human turn, JSON export and import for saves and scenarios, and a replay check (the snapshot must match a replay of the log) in tests.
13. **Sample scenario and polish.** Build "The Straits", play it through against the AI with Playwright screenshots, and tune the numbers.

After you approve this, I'll open one GitHub issue per step on MickleByte/map-room, then start on step 1.
