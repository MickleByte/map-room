import { describe, expect, it } from 'vitest';
import { blankMap } from '../../tests/fixtures/mini';
import { Camera } from './camera';
import { worldWidth } from './iso';

describe('Camera', () => {
  it('keeps its centre within one world width on a wrapping map', () => {
    const map = blankMap(20, 40, true);
    const cam = new Camera(map, { width: 800, height: 600 });
    cam.centreOn({ x: 10, y: 300 });
    cam.panByScreen(200, 0);
    expect(cam.centre.x).toBeGreaterThan(worldWidth(map) - 200);
    expect(cam.centre.x).toBeLessThan(worldWidth(map));
  });

  it('never zooms out past one world width on a wrapping map', () => {
    const map = blankMap(20, 40, true);
    const cam = new Camera(map, { width: 1600, height: 600 });
    cam.zoomAt({ x: 800, y: 300 }, 0.01);
    expect(cam.visibleWorld().width).toBeLessThanOrEqual(worldWidth(map) + 1e-6);
  });

  it('clamps to the map edges on a flat map', () => {
    const map = blankMap(40, 80, false);
    const cam = new Camera(map, { width: 800, height: 600 });
    cam.centreOn({ x: -1000, y: -1000 });
    const v = cam.visibleWorld();
    expect(v.x).toBeCloseTo(0);
    expect(v.y).toBeCloseTo(0);
  });

  it('keeps the point under the cursor fixed while zooming', () => {
    const map = blankMap(40, 80, false);
    const cam = new Camera(map, { width: 800, height: 600 });
    cam.centreOn({ x: 1200, y: 600 });
    const cursor = { x: 600, y: 200 };
    const before = cam.screenToWorld(cursor);
    cam.zoomAt(cursor, 1.5);
    const after = cam.screenToWorld(cursor);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});
