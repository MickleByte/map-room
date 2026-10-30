import { describe, expect, it } from 'vitest';
import { winChance } from './odds';

/**
 * Independent check: walk every possible sequence of combat rounds and add up the
 * probability of each sequence the attacker wins.
 */
function bruteForce(attack: number, defence: number, attackerHp: number, defenderHp: number): number {
  const p = attack / (attack + defence);
  let total = 0;
  const walk = (a: number, d: number, prob: number) => {
    if (d === 0) total += prob;
    if (a === 0 || d === 0) return;
    walk(a, d - 1, prob * p);
    walk(a - 1, d, prob * (1 - p));
  };
  walk(attackerHp, defenderHp, 1);
  return total;
}

describe('winChance', () => {
  it('is the single-round chance when both sides have 1 HP', () => {
    expect(winChance(3, 1, 1, 1)).toBeCloseTo(0.75, 12);
  });

  it('is even for equal strength and HP', () => {
    expect(winChance(10, 10, 3, 3)).toBeCloseTo(0.5, 12);
  });

  it('matches a worked example: 1 HP attacker against a 2 HP defender at even strength', () => {
    // The attacker must win both rounds: 1/2 × 1/2.
    expect(winChance(5, 5, 1, 2)).toBeCloseTo(0.25, 12);
  });

  it('agrees with brute-force enumeration', () => {
    for (const [atk, def] of [
      [24, 10],
      [4, 17.5],
      [6, 6],
      [12, 31],
    ] as const) {
      for (let a = 1; a <= 5; a++) {
        for (let d = 1; d <= 5; d++) {
          expect(winChance(atk, def, a, d)).toBeCloseTo(bruteForce(atk, def, a, d), 12);
        }
      }
    }
  });

  it('is certain against a defence of 0 and hopeless with an attack of 0', () => {
    expect(winChance(4, 0, 1, 5)).toBe(1);
    expect(winChance(0, 4, 5, 1)).toBe(0);
  });
});
