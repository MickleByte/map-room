/**
 * Units on the map. Each tile shows one unit token (the selected unit, else the
 * strongest defender), with HP, veteran level, fortified status and stack size.
 * Shapes go into one GraphicsContext shared by every wrap copy.
 */
import { Container, GraphicsContext, Text } from 'pixi.js';
import { tileIndex } from '../core/grid';
import { maxHp } from '../core/ruleset';
import { cityAt, currentPlayer, typeOf } from '../core/state';
import type { GameState, Unit, UnitId } from '../core/types';
import { tileCentre } from './iso';

const TOKEN_W = 24;
const TOKEN_H = 16;
const VETERAN_PIPS = { conscript: 0, regular: 1, veteran: 2, elite: 3 } as const;

export interface UnitDrawing {
  shapes: GraphicsContext;
  /** Builds the stack-size labels for one wrap copy (Text can't be shared). */
  labels: () => Container;
}

/** Visible stacks: units not aboard a ship, grouped by tile. */
function stacks(state: GameState): Map<number, Unit[]> {
  const out = new Map<number, Unit[]>();
  for (const u of Object.values(state.units)) {
    if (u.carriedBy !== null) continue;
    const k = tileIndex(state.map, u.pos);
    const list = out.get(k) ?? [];
    list.push(u);
    out.set(k, list);
  }
  return out;
}

/** The unit a tile shows: the selected one if present, else the best land/sea defender. */
export function topUnit(state: GameState, units: Unit[], selected: UnitId | null): Unit {
  const chosen = units.find((u) => u.id === selected);
  if (chosen) return chosen;
  const score = (u: Unit) => {
    const def = typeOf(state, u);
    return (def.domain === 'air' ? -1000 : 0) + def.defence * 10 + def.attack;
  };
  return [...units].sort((a, b) => score(b) - score(a) || a.id - b.id)[0]!;
}

export function drawUnits(state: GameState, selected: UnitId | null): UnitDrawing {
  const shapes = new GraphicsContext();
  const badges: { x: number; y: number; count: number }[] = [];
  const mover = currentPlayer(state).id;

  for (const units of stacks(state).values()) {
    const unit = topUnit(state, units, selected);
    const owner = state.players.find((p) => p.id === unit.owner)!;
    const colour = parseInt(owner.colour.slice(1), 16);
    const p = tileCentre(unit.pos);
    const lift = cityAt(state, unit.pos) ? 16 : 6;
    const bx = p.x - TOKEN_W / 2;
    const by = p.y - lift - TOKEN_H;
    const spent = unit.owner === mover && unit.movesLeft <= 0;
    const alpha = spent ? 0.55 : 1;

    if (unit.fortified) {
      shapes
        .moveTo(bx - 3, by + TOKEN_H - 2)
        .lineTo(bx - 3, by + TOKEN_H + 3)
        .lineTo(bx + TOKEN_W + 3, by + TOKEN_H + 3)
        .lineTo(bx + TOKEN_W + 3, by + TOKEN_H - 2)
        .stroke({ width: 2.5, color: 0x5b4630, alpha });
    }
    shapes.rect(bx, by, TOKEN_W, TOKEN_H).fill({ color: colour, alpha });
    drawSymbol(shapes, unit.type, bx, by, alpha);
    shapes
      .rect(bx, by, TOKEN_W, TOKEN_H)
      .stroke({ width: unit.id === selected ? 2.5 : 1.2, color: unit.id === selected ? 0xffe08a : 0x111111 });

    // HP bar: one segment per HP.
    const hpMax = maxHp(state.ruleset, unit.veteran);
    const seg = TOKEN_W / hpMax;
    const hpColour = unit.hp / hpMax > 0.6 ? 0x5ad15a : unit.hp / hpMax > 0.3 ? 0xe8c547 : 0xe0533f;
    shapes.rect(bx, by + TOKEN_H + 1, TOKEN_W, 3).fill(0x111111);
    for (let i = 0; i < unit.hp; i++)
      shapes.rect(bx + i * seg + 0.5, by + TOKEN_H + 1.5, seg - 1, 2).fill(hpColour);

    // Veteran pips down the left side.
    for (let i = 0; i < VETERAN_PIPS[unit.veteran]; i++) {
      shapes
        .circle(bx - 4, by + 3 + i * 5, 1.8)
        .fill(0xffe08a)
        .stroke({ width: 0.8, color: 0x111111 });
    }

    if (units.length > 1) badges.push({ x: bx + TOKEN_W + 1, y: by - 1, count: units.length });
  }

  for (const b of badges) shapes.circle(b.x, b.y, 6).fill(0x111111).stroke({ width: 1, color: 0xdddddd });

  const labels = () => {
    const layer = new Container();
    for (const b of badges) {
      const t = new Text({
        text: String(b.count),
        style: { fontFamily: 'system-ui, sans-serif', fontSize: 9, fontWeight: '700', fill: 0xffffff },
        resolution: 3,
      });
      t.anchor.set(0.5);
      t.position.set(b.x, b.y);
      layer.addChild(t);
    }
    return layer;
  };
  return { shapes, labels };
}

/** NATO-style symbols in white, inside the token box. */
function drawSymbol(g: GraphicsContext, type: string, bx: number, by: number, alpha: number): void {
  const w = TOKEN_W;
  const h = TOKEN_H;
  const cx = bx + w / 2;
  const cy = by + h / 2;
  const line = { width: 1.4, color: 0xffffff, alpha };
  const cross = () =>
    g
      .moveTo(bx, by)
      .lineTo(bx + w, by + h)
      .moveTo(bx + w, by)
      .lineTo(bx, by + h);
  const tracks = () => g.roundRect(bx + 4, by + 4, w - 8, h - 8, 4);
  const hull = (len: number) =>
    g.poly([cx - len, cy + 1, cx + len, cy + 1, cx + len - 3, cy + 5, cx - len + 3, cy + 5]);

  switch (type) {
    case 'infantry':
      cross().stroke(line);
      break;
    case 'mechInfantry':
      cross().stroke(line);
      tracks().stroke(line);
      break;
    case 'armour':
      tracks().stroke(line);
      break;
    case 'antiTank':
      g.moveTo(bx + 3, by + h - 2)
        .lineTo(cx, by + 2)
        .lineTo(bx + w - 3, by + h - 2)
        .stroke(line);
      break;
    case 'artillery':
      g.circle(cx, cy, 2.6).fill({ color: 0xffffff, alpha });
      break;
    case 'radarArtillery':
      g.circle(cx, cy + 2, 2.4).fill({ color: 0xffffff, alpha });
      g.arc(cx, cy + 2, 6, Math.PI * 1.15, Math.PI * 1.85).stroke(line);
      break;
    case 'paratrooper':
      cross().stroke(line);
      g.moveTo(cx - 6, by + 4)
        .quadraticCurveTo(cx, by - 1, cx + 6, by + 4)
        .stroke(line);
      break;
    case 'fighter':
      g.poly([cx, by + 2, cx + 3, cy + 1, cx + 8, cy + 4, cx, cy + 3, cx - 8, cy + 4, cx - 3, cy + 1]).fill({
        color: 0xffffff,
        alpha,
      });
      break;
    case 'bomber':
      g.poly([
        cx,
        by + 2,
        cx + 2,
        cy - 1,
        cx + 10,
        cy + 2,
        cx + 2,
        cy + 2,
        cx,
        by + h - 2,
        cx - 2,
        cy + 2,
        cx - 10,
        cy + 2,
        cx - 2,
        cy - 1,
      ]).fill({
        color: 0xffffff,
        alpha,
      });
      break;
    case 'transport':
      hull(8).fill({ color: 0xffffff, alpha });
      g.rect(cx - 4, cy - 4, 8, 5).stroke(line);
      break;
    case 'destroyer':
      hull(7).fill({ color: 0xffffff, alpha });
      g.moveTo(cx, cy + 1)
        .lineTo(cx, cy - 5)
        .stroke(line);
      break;
    case 'battleship':
      hull(9).fill({ color: 0xffffff, alpha });
      g.rect(cx - 6, cy - 2, 4, 3).fill({ color: 0xffffff, alpha });
      g.rect(cx + 2, cy - 2, 4, 3).fill({ color: 0xffffff, alpha });
      break;
    case 'carrier':
      g.rect(cx - 10, cy, 20, 3).fill({ color: 0xffffff, alpha });
      g.rect(cx + 3, cy - 4, 3, 4).fill({ color: 0xffffff, alpha });
      break;
    default:
      g.circle(cx, cy, 3).stroke(line);
  }
}
