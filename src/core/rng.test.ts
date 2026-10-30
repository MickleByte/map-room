import { describe, expect, it } from 'vitest';
import { Rng, seedRng } from './rng';

const draws = (seed: number, n: number) => {
  const rng = new Rng(seedRng(seed));
  return Array.from({ length: n }, () => rng.next());
};

describe('rng', () => {
  it('produces the same sequence for the same seed', () => {
    expect(draws(123, 100)).toEqual(draws(123, 100));
  });

  it('produces different sequences for neighbouring seeds', () => {
    expect(draws(1, 10)).not.toEqual(draws(2, 10));
  });

  it('continues identically after its state is saved and restored', () => {
    const a = new Rng(seedRng(7));
    for (let i = 0; i < 50; i++) a.next();
    const b = new Rng(JSON.parse(JSON.stringify(a.state())));
    expect(Array.from({ length: 20 }, () => b.next())).toEqual(Array.from({ length: 20 }, () => a.next()));
  });

  it('draws floats in [0, 1) with a roughly uniform mean', () => {
    const xs = draws(99, 20000);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThan(1);
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    expect(mean).toBeCloseTo(0.5, 1);
  });

  it('chance(p) succeeds about p of the time', () => {
    const rng = new Rng(seedRng(5));
    let hits = 0;
    for (let i = 0; i < 20000; i++) if (rng.chance(0.2)) hits++;
    expect(hits / 20000).toBeCloseTo(0.2, 1);
  });
});
