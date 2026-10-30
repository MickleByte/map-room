/**
 * A small overview map with the camera's viewport, under the viewer's fog of war.
 * Click or drag to move the camera.
 */
import { tileAt } from '../core/grid';
import type { GameState } from '../core/types';
import type { Vision } from '../core/visibility';
import { TERRAIN_COLOURS } from './art';
import { UNSEEN_COLOUR } from './fogLayer';
import type { Camera } from './camera';
import { diamond, tileCentre, worldHeight, worldWidth } from './iso';

const WIDTH = 240;

export class Minimap {
  readonly element: HTMLCanvasElement;
  private readonly base: HTMLCanvasElement;
  private readonly scale: number;

  constructor(
    private readonly state: GameState,
    private readonly camera: Camera,
  ) {
    const { map } = state;
    this.scale = WIDTH / worldWidth(map);
    const height = Math.ceil(worldHeight(map) * this.scale);

    this.base = document.createElement('canvas');
    this.base.width = WIDTH;
    this.base.height = height;

    this.element = document.createElement('canvas');
    this.element.className = 'minimap';
    this.element.width = WIDTH;
    this.element.height = height;
    this.bindPointer();
    camera.onChange(() => this.draw());
  }

  /** Redraw the terrain and cities as the viewer knows them. */
  update(vision: Vision): void {
    const ctx = this.base.getContext('2d')!;
    const { map } = this.state;
    const s = this.scale;
    ctx.fillStyle = hex(UNSEEN_COLOUR);
    ctx.fillRect(0, 0, this.base.width, this.base.height);
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const seen = vision.at({ x, y });
        if (seen === 'unseen') continue;
        const pts = diamond(tileCentre({ x, y }));
        ctx.beginPath();
        ctx.moveTo(pts[0]! * s, pts[1]! * s);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]! * s, pts[i + 1]! * s);
        ctx.closePath();
        ctx.fillStyle = hex(TERRAIN_COLOURS[tileAt(map, { x, y }).terrain] ?? 0);
        ctx.fill();
        if (seen === 'remembered') {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
          ctx.fill();
        }
      }
    }
    for (const city of vision.cities()) {
      const owner = this.state.players.find((p) => p.id === city.owner);
      const p = tileCentre(city.pos);
      ctx.fillStyle = owner?.colour ?? '#888';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.fillRect(p.x * s - 3, p.y * s - 3, 6, 6);
      ctx.strokeRect(p.x * s - 3, p.y * s - 3, 6, 6);
    }
    this.draw();
  }

  private draw(): void {
    const ctx = this.element.getContext('2d')!;
    ctx.drawImage(this.base, 0, 0);
    const v = this.camera.visibleWorld();
    const s = this.scale;
    const ww = worldWidth(this.state.map);
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 1.5;
    // On wrapping maps the viewport can straddle the seam, so draw it at each wrap offset.
    for (const k of this.state.map.wrapX ? [-1, 0, 1] : [0]) {
      ctx.strokeRect((v.x + k * ww) * s, v.y * s, v.width * s, v.height * s);
    }
  }

  private bindPointer(): void {
    const moveTo = (e: PointerEvent) => {
      const rect = this.element.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * this.element.width;
      const y = ((e.clientY - rect.top) / rect.height) * this.element.height;
      this.camera.centreOn({ x: x / this.scale, y: y / this.scale });
    };
    this.element.addEventListener('pointerdown', (e) => {
      this.element.setPointerCapture(e.pointerId);
      moveTo(e);
    });
    this.element.addEventListener('pointermove', (e) => {
      if (this.element.hasPointerCapture(e.pointerId)) moveTo(e);
    });
  }
}

function hex(colour: number): string {
  return `#${colour.toString(16).padStart(6, '0')}`;
}
