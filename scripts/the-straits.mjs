// Builds src/data/scenarios/the-straits.json, the Milestone 1 sample scenario.
//
//   node scripts/the-straits.mjs
//
// The map is laid out in screen space (ADR-0001): a tile (x, y) has its centre at
// X = x + (y & 1) / 2 and Y = y / 2, so the 60 × 80-row map is 60 × 40 tiles on screen
// and a step in any of the 8 directions moves at most one tile across or down.
// Everything is computed from fixed formulas, so the output never changes between runs.
//
// West: Red (the human). East: Blue (the AI). A channel 3–6 tiles wide runs down the
// middle with one land bridge, fortified at both ends; open ocean lies across the wrap.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import prettier from 'prettier';

const W = 60;
const H = 80;
const OUT = new URL('../src/data/scenarios/the-straits.json', import.meta.url);

// ---- geometry ----
const centreX = (x, y) => x + (y & 1) / 2;
const wrapX = (x) => ((x % W) + W) % W;
const key = (x, y) => y * W + wrapX(x);
/** The tile whose centre is nearest a screen point. */
const tileNear = (X, Y) => {
  const y = Math.max(0, Math.min(H - 1, Math.round(Y * 2)));
  return { x: wrapX(Math.round(X - (y & 1) / 2)), y };
};
const OFFSETS = [
  [0, -2],
  [1, -1],
  [2, 0],
  [1, 1],
  [0, 2],
  [-1, 1],
  [-2, 0],
  [-1, -1],
];
function neighbours(x, y) {
  const out = [];
  for (const [dd, dy] of OFFSETS) {
    const ny = y + dy;
    if (ny < 0 || ny >= H) continue;
    const d = 2 * x + (y & 1) + dd;
    out.push({ x: wrapX((d - (ny & 1)) / 2), y: ny });
  }
  return out;
}
const dist = (a, b) => {
  let dd = Math.abs(2 * a.x + (a.y & 1) - (2 * b.x + (b.y & 1)));
  dd = Math.min(dd, 2 * W - dd);
  return (dd + Math.abs(a.y - b.y)) / 2;
};

// ---- coastlines ----
const westCoast = (Y) => 7.5 + 1.5 * Math.sin(0.45 * Y + 1) + 0.8 * Math.sin(1.3 * Y);
const eastCoast = (Y) => 52.5 + 1.5 * Math.sin(0.4 * Y + 2) + 0.8 * Math.sin(1.7 * Y);
/** How far a screen X is from the channel, 0 near it rising to 1, so both shores of the channel end level. */
const offChannel = (X) => Math.min(1, Math.max(0, Math.abs(X - 29.5) - 11) / 5);
const northShore = (X) => 4 + offChannel(X) * (1.2 * Math.sin(0.3 * X) + 0.6 * Math.sin(1.1 * X) - 1);
const southShore = (X) => 36 - offChannel(X) * (1.2 * Math.sin(0.27 * X + 1) + 0.6 * Math.sin(0.9 * X) - 1);
/** The channel's west shore and width (in tiles, 3–6), per row. */
const channelWest = (Y) => 27 + 1.2 * Math.sin(0.35 * Y) * Math.min(1, Math.abs(Y - 19.75) / 4);
const channelWidth = (Y) => Math.max(3, Math.min(6, Math.round(4.5 + 1.6 * Math.sin(0.5 * Y + 4.26))));
/** Rows of the land bridge across the channel. */
const BRIDGE_ROWS = [38, 39, 40, 41];

const land = new Array(W * H).fill(false);
/** Per row: the first channel column and the channel width. */
const channel = [];
for (let y = 0; y < H; y++) {
  const Y = y / 2;
  const first = Math.round(channelWest(Y) - (y & 1) / 2);
  const width = channelWidth(Y);
  channel.push({ first, width });
  for (let x = 0; x < W; x++) {
    const X = centreX(x, y);
    const inLat = Y > northShore(X) && Y < southShore(X);
    const inChannel = x >= first && x < first + width;
    const bridge = BRIDGE_ROWS.includes(y);
    land[key(x, y)] = inLat && X > westCoast(Y) && X < eastCoast(Y) && (!inChannel || bridge);
  }
}
const isLand = (c) => land[key(c.x, c.y)];

// ---- terrain ----
// A smooth deterministic field for patches of forest, marsh and so on.
const field = (X, Y) =>
  Math.sin(0.7 * X + 1.3) * Math.cos(0.5 * Y + 0.2) +
  0.5 * Math.sin(1.7 * X + 0.9 * Y) +
  0.3 * Math.cos(2.3 * Y - 0.8 * X);
const spineX = (Y) => 44 + 1.5 * Math.sin(0.3 * Y);
/** Short hill ridges on the west continent, as segments [X1, Y1, X2, Y2]. */
const RIDGES = [
  [10, 10, 20, 13],
  [12, 27.5, 22, 25.5],
  [16, 33, 21, 31],
];
const segDist = (X, Y, [x1, y1, x2, y2]) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((X - x1) * dx + (Y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(X - (x1 + t * dx), Y - (y1 + t * dy));
};
/** Passes through the mountain spine, where it drops to hills. */
const PASSES = [13, 20, 28];

const terrain = [];
for (let y = 0; y < H; y++) {
  let row = '';
  for (let x = 0; x < W; x++) {
    const X = centreX(x, y);
    const Y = y / 2;
    if (!land[key(x, y)]) {
      const nearLand = neighbours(x, y).some(isLand);
      row += nearLand ? 'c' : 'o';
      continue;
    }
    const v = field(X, Y);
    const front = Y > 16.5 && Y < 23 && X > 22 && X < 37;
    const east = X > 30;
    const spine = Math.abs(X - spineX(Y));
    const pass = PASSES.some((p) => Math.abs(Y - p) < 0.8);
    let t;
    if (front) t = v > 0.6 ? 'f' : v > -0.2 ? 'g' : 'p';
    else if (east && Y > 5.5 && Y < 34.5 && spine < 0.6) t = pass ? 'h' : 'm';
    else if (east && Y > 5 && Y < 35 && spine < 1.6 && v > -0.6) t = 'h';
    else if (!east && RIDGES.some((r) => segDist(X, Y, r) < 0.7)) t = v > 0.9 ? 'm' : 'h';
    else if (Y < 4.5 || Y > 35.5) t = v > 0.8 ? 'h' : 't';
    else if (east && X > 46 && Y > 26 && v < 0.4) t = 'd';
    else if (!east && X < 17 && Y > 28 && v > 0.1) t = 'j';
    else if (v > 0.75) t = 'f';
    else if (v < -0.9 && neighbours(x, y).some((n) => !isLand(n))) t = 's';
    else t = v > 0 ? 'g' : 'p';
    row += t;
  }
  terrain.push(row);
}
const setTerrain = (c, t) => {
  terrain[c.y] = terrain[c.y].slice(0, c.x) + t + terrain[c.y].slice(c.x + 1);
};
const terrainAt = (c) => terrain[c.y][c.x];

// ---- the fortress lines ----
// A zig-zag of edge-sharing tiles down each end of the bridge, which no 8-way step can
// slip past. Red holds the west end, Blue the east end.
const bridgeFirst = Math.max(...BRIDGE_ROWS.map((y) => channel[y].first));
const bridgeLast = Math.min(...BRIDGE_ROWS.map((y) => channel[y].first + channel[y].width - 1));
function fortressLine(X) {
  return BRIDGE_ROWS.map((y, i) => tileNear(X + (i % 2) / 2, y / 2));
}
const redLine = fortressLine(bridgeFirst);
const blueLine = fortressLine(bridgeLast);
const fortresses = [...redLine, ...blueLine];
for (const f of fortresses) setTerrain(f, 'g');

/** Whether the line cuts every land route from `a` to `b`. */
function cuts(line, a, b) {
  const blocked = new Set(line.map((c) => key(c.x, c.y)));
  const seen = new Set([key(a.x, a.y)]);
  const queue = [a];
  while (queue.length) {
    const c = queue.pop();
    if (c.x === b.x && c.y === b.y) return false;
    for (const n of neighbours(c.x, c.y)) {
      const k = key(n.x, n.y);
      if (seen.has(k) || !isLand(n) || blocked.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return true;
}

// ---- cities ----
function landNear(X, Y, { coastal = false } = {}) {
  const target = tileNear(X, Y);
  let best = null;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = { x, y };
      if (!isLand(c)) continue;
      if (coastal && !neighbours(x, y).some((n) => !isLand(n))) continue;
      const d = dist(c, target);
      if (!best || d < best.d) best = { c, d };
    }
  return best.c;
}

const CITY_DEFS = [
  // Red, the west
  { name: 'Calder', owner: 'red', at: [12, 20], size: 14 },
  { name: 'Port Ilse', owner: 'red', at: [26, 12], size: 9, coastal: true },
  { name: 'Bramwell', owner: 'red', at: [19, 29], size: 7, walls: true },
  { name: 'Fenwick', owner: 'red', at: [bridgeFirst - 3, 20], size: 5, walls: true },
  { name: 'Oakmere', owner: 'red', at: [15, 7], size: 4 },
  { name: 'Sallow', owner: 'red', at: [11, 34], size: 3, walls: true, coastal: true },
  // Blue, the east
  { name: 'Varn', owner: 'blue', at: [49, 20], size: 13 },
  { name: 'Kestrel Bay', owner: 'blue', at: [33, 28], size: 8, coastal: true },
  { name: 'Dunlow', owner: 'blue', at: [39, 10], size: 11 },
  { name: 'Ostry', owner: 'blue', at: [bridgeLast + 3.5, 20], size: 6, walls: true },
  { name: 'Rookhill', owner: 'blue', at: [47, 31], size: 3, walls: true },
  { name: 'Tarn', owner: 'blue', at: [50, 6], size: 4, coastal: true },
];
const cities = CITY_DEFS.map((d) => {
  const c = landNear(d.at[0], d.at[1], { coastal: d.coastal });
  setTerrain(c, d.name === 'Rookhill' ? 'h' : 'g');
  return {
    name: d.name,
    owner: d.owner,
    x: c.x,
    y: c.y,
    size: d.size,
    walls: !!d.walls,
    shieldsPerTurn: 10 + 2 * d.size,
  };
});
const city = (name) => cities.find((c) => c.name === name);
const redCity = city('Calder');
const blueCity = city('Varn');
if (!cuts(redLine, redCity, blueCity)) throw new Error("Red's fortress line does not cut the bridge");
if (!cuts(blueLine, redCity, blueCity)) throw new Error("Blue's fortress line does not cut the bridge");

// ---- rivers ----
// A river is a walk along tile edges from a source vertex toward a mouth, stopping at
// the sea. Vertices are screen points where exactly one coordinate is a half-integer.
function river([sx, sy], [tx, ty], wiggle) {
  const out = [];
  let p = { X: sx, Y: sy };
  const seen = new Set();
  for (let i = 0; i < 80; i++) {
    const moves = [
      [0.5, 0.5],
      [0.5, -0.5],
      [-0.5, 0.5],
      [-0.5, -0.5],
    ].map(([dx, dy]) => ({ X: p.X + dx, Y: p.Y + dy }));
    const score = (q) => Math.hypot(q.X - tx, q.Y - ty) + wiggle * Math.sin(q.X * 1.9 + q.Y * 2.7);
    const next = moves.filter((q) => !seen.has(`${q.X},${q.Y}`)).sort((a, b) => score(a) - score(b))[0];
    if (!next) break;
    // The edge between p and next, named as the SE or SW edge of the tile above it.
    const [top, bottom] = p.Y < next.Y ? [p, next] : [next, p];
    const left = bottom.X < top.X;
    const upper = tileNear(left ? top.X - 0.5 : top.X + 0.5, top.Y);
    const lower = tileNear(top.X, top.Y + 0.5);
    if (!isLand(upper) || !isLand(lower)) break;
    out.push({ x: upper.x, y: upper.y, side: left ? 'SE' : 'SW' });
    seen.add(`${p.X},${p.Y}`);
    p = next;
  }
  return out;
}
const rivers = [
  ...river([17, 13.5], [27, 30], 0.6), // Red: from the north ridge down to the south channel
  ...river([12.5, 23], [6, 27], 0.5), // Red: past Calder to the west coast
  ...river([43, 14.5], [31, 11], 0.6), // Blue: from the spine to the north channel
  ...river([45.5, 24], [54, 30], 0.5), // Blue: from the spine to the east coast
];

// ---- roads and rails ----
const MOVE = { g: 1, p: 1, d: 1, t: 1, f: 2, j: 2, s: 2, h: 2, m: 5 };
/** The cheapest land route between two tiles. */
function route(a, b) {
  const best = new Map([[key(a.x, a.y), { cost: 0, prev: null, c: a }]]);
  const open = [{ cost: 0, c: a }];
  while (open.length) {
    open.sort((p, q) => p.cost - q.cost);
    const { cost, c } = open.shift();
    if (c.x === b.x && c.y === b.y) break;
    if (best.get(key(c.x, c.y)).cost < cost) continue;
    for (const n of neighbours(c.x, c.y)) {
      if (!isLand(n)) continue;
      const nc = cost + MOVE[terrainAt(n)];
      const seen = best.get(key(n.x, n.y));
      if (seen && seen.cost <= nc) continue;
      best.set(key(n.x, n.y), { cost: nc, prev: c, c: n });
      open.push({ cost: nc, c: n });
    }
  }
  const path = [];
  for (let node = best.get(key(b.x, b.y)); node; node = node.prev && best.get(key(node.prev.x, node.prev.y)))
    path.push([node.c.x, node.c.y]);
  return path;
}
const tilesOf = (...paths) => {
  const set = new Map();
  for (const p of paths) for (const [x, y] of p) set.set(key(x, y), [x, y]);
  return [...set.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
};
const link = (a, b) => route(city(a), city(b));
const rails = tilesOf(link('Calder', 'Fenwick'), link('Varn', 'Ostry'));
const railKeys = new Set(rails.map(([x, y]) => key(x, y)));
const roads = tilesOf(
  link('Calder', 'Oakmere'),
  link('Calder', 'Port Ilse'),
  link('Calder', 'Bramwell'),
  link('Bramwell', 'Sallow'),
  link('Port Ilse', 'Fenwick'),
  link('Bramwell', 'Fenwick'),
  link('Fenwick', 'Ostry'),
  link('Varn', 'Tarn'),
  link('Varn', 'Dunlow'),
  link('Varn', 'Rookhill'),
  link('Ostry', 'Dunlow'),
  link('Ostry', 'Kestrel Bay'),
  link('Kestrel Bay', 'Rookhill'),
).filter(([x, y]) => !railKeys.has(key(x, y)));

// ---- units ----
const units = [];
const occupied = new Map();
/** Place a unit on the free tile of the right kind nearest a screen point. */
function place(type, owner, X, Y, extra = {}, sea = false) {
  const target = tileNear(X, Y);
  let best = null;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = { x, y };
      if (isLand(c) === sea) continue;
      const who = occupied.get(key(x, y));
      if (who && who !== owner) continue;
      const enemyCity = cities.some((k) => k.x === x && k.y === y && k.owner !== owner);
      if (enemyCity) continue;
      const d = dist(c, target);
      if (!best || d < best.d) best = { c, d };
    }
  occupied.set(key(best.c.x, best.c.y), owner);
  units.push({ type, owner, x: best.c.x, y: best.c.y, ...extra });
  return best.c;
}
const at = (owner, c, type, extra = {}) => {
  occupied.set(key(c.x, c.y), owner);
  units.push({ type, owner, x: c.x, y: c.y, ...extra });
};
const centreOf = (c) => [centreX(c.x, c.y), c.y / 2];
const dug = { fortified: true };

//** The middle of the channel in a row, as a screen X. */
const channelMid = (y) => channel[y].first + (y & 1) / 2 + (channel[y].width - 1) / 2;

/**
 * One side's starting forces. `toward` is +1 when the enemy lies east (Red) and -1
 * when it lies west (Blue). `sea` gives the channel rows its ships start in.
 */
function forces(owner, toward, line, names, sea) {
  const own = (role) => city(names[role]);
  const vet = { veteran: 'veteran' };
  // Garrisons.
  for (const c of cities.filter((k) => k.owner === owner)) at(owner, c, 'infantry', dug);
  at(owner, own('capital'), 'antiTank', dug);
  // The fortress line.
  line.forEach((c, i) => at(owner, c, i % 2 ? 'antiTank' : 'infantry', dug));
  // The strike force, and guns stacked with mechanised infantry, behind the line.
  const [lx, ly] = centreOf(line[1]);
  const back = (d) => lx - toward * d;
  place('armour', owner, back(1.5), ly - 1, vet);
  place('armour', owner, back(1.5), ly);
  place('armour', owner, back(1.5), ly + 1);
  const gunsA = place('mechInfantry', owner, back(2.5), ly - 0.5);
  at(owner, gunsA, 'artillery');
  const gunsB = place('mechInfantry', owner, back(2.5), ly + 1);
  at(owner, gunsB, 'artillery');
  at(owner, gunsB, 'radarArtillery');
  // Air: a fighter and a bomber at the bridgehead, paratroopers in the port.
  at(owner, own('bridgehead'), 'fighter');
  at(owner, own('bridgehead'), 'bomber');
  at(owner, own('port'), 'paratrooper');
  at(owner, own('port'), 'paratrooper');
  // Sea: a task force and a loaded transport in one channel, a carrier in the other.
  const atSea = (type, y, extra) => place(type, owner, channelMid(y), y / 2, extra, true);
  atSea('destroyer', sea.fleet);
  atSea('battleship', sea.fleet + 2);
  atSea('transport', sea.transport, { cargo: sea.cargo.map((type) => ({ type })) });
  atSea('carrier', sea.carrier, { cargo: [{ type: 'fighter' }, { type: 'fighter' }] });
}
forces(
  'red',
  1,
  redLine,
  { capital: 'Calder', bridgehead: 'Fenwick', port: 'Port Ilse' },
  { fleet: 27, transport: 33, carrier: 60, cargo: ['armour', 'armour', 'mechInfantry', 'infantry'] },
);
forces(
  'blue',
  -1,
  blueLine,
  { capital: 'Varn', bridgehead: 'Ostry', port: 'Kestrel Bay' },
  { fleet: 51, transport: 46, carrier: 20, cargo: ['armour', 'mechInfantry', 'infantry', 'antiTank'] },
);

const scenario = {
  id: 'the-straits',
  name: 'The Straits',
  description:
    'Two continents face each other across a narrow channel, joined by a single fortified land bridge. Capture every enemy city.',
  seed: 1914,
  map: {
    width: W,
    height: H,
    wrapX: true,
    terrain,
    rivers,
    roads,
    rails,
    fortresses: fortresses.map((c) => [c.x, c.y]),
  },
  players: [
    { id: 'red', name: 'Red', colour: '#c8443a', control: 'human' },
    { id: 'blue', name: 'Blue', colour: '#3a78d8', control: 'ai' },
  ],
  cities,
  units,
};
// Formatted as Prettier would, so `prettier --check` stays clean after a rebuild.
const options = { ...(await prettier.resolveConfig(fileURLToPath(OUT))), parser: 'json' };
writeFileSync(OUT, await prettier.format(JSON.stringify(scenario), options));
console.log(
  `Wrote ${OUT.pathname}: ${cities.length} cities, ${units.length} units, ${rivers.length} river edges`,
);
