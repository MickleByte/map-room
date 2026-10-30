/** Mouse and keyboard → camera moves and tile clicks. */
import type { Camera } from '../render/camera';
import type { Point } from '../render/iso';

const DRAG_THRESHOLD = 5;
const KEY_PAN = 96;
const WHEEL_ZOOM = 1.15;

export function bindMapInput(
  canvas: HTMLCanvasElement,
  camera: Camera,
  onClick: (screen: Point) => void,
): void {
  let press: { start: Point; last: Point; dragging: boolean } | null = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const p = { x: e.offsetX, y: e.offsetY };
    press = { start: p, last: p, dragging: false };
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!press) return;
    const p = { x: e.offsetX, y: e.offsetY };
    if (!press.dragging && Math.hypot(p.x - press.start.x, p.y - press.start.y) > DRAG_THRESHOLD) {
      press.dragging = true;
    }
    if (press.dragging) camera.panByScreen(p.x - press.last.x, p.y - press.last.y);
    press.last = p;
  });

  canvas.addEventListener('pointerup', (e) => {
    if (press && !press.dragging) onClick({ x: e.offsetX, y: e.offsetY });
    press = null;
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      camera.zoomAt({ x: e.offsetX, y: e.offsetY }, e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM);
    },
    { passive: false },
  );

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const pan: Record<string, [number, number]> = {
      ArrowLeft: [KEY_PAN, 0],
      ArrowRight: [-KEY_PAN, 0],
      ArrowUp: [0, KEY_PAN],
      ArrowDown: [0, -KEY_PAN],
    };
    const d = pan[e.key];
    if (d) {
      e.preventDefault();
      camera.panByScreen(d[0], d[1]);
    } else if (e.key === '+' || e.key === '=') {
      camera.zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, WHEEL_ZOOM);
    } else if (e.key === '-') {
      camera.zoomAt({ x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 }, 1 / WHEEL_ZOOM);
    }
  });
}
