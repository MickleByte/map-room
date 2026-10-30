/**
 * Seeded PRNG (sfc32). The four 32-bit words of state live in GameState, so the
 * same state and actions always roll the same numbers (ADR-0004).
 */
export type RngState = [number, number, number, number];

/** Expand a single integer seed into a full sfc32 state using splitmix32. */
export function seedRng(seed: number): RngState {
  let s = seed >>> 0;
  const next = (): number => {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    return (z ^ (z >>> 16)) >>> 0;
  };
  const state: RngState = [next(), next(), next(), next()];
  // Warm up so nearby seeds diverge immediately.
  const rng = new Rng(state);
  for (let i = 0; i < 12; i++) rng.nextUint32();
  return rng.state();
}

/**
 * A mutable cursor over an RngState. Create one from the game state at the start
 * of an action, draw from it, then write `state()` back.
 */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(state: Readonly<RngState>) {
    [this.a, this.b, this.c, this.d] = state;
  }

  nextUint32(): number {
    const t = (((this.a + this.b) >>> 0) + this.d) >>> 0;
    this.d = (this.d + 1) >>> 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) >>> 0;
    this.c = ((this.c << 21) | (this.c >>> 11)) >>> 0;
    this.c = (this.c + t) >>> 0;
    return t;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }

  state(): RngState {
    return [this.a, this.b, this.c, this.d];
  }
}
