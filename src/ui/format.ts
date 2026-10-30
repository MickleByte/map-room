import { THIRDS_PER_MP } from '../core/ruleset';

const FRACTIONS = ['', '⅓', '⅔'];

/** Movement in thirds as a mixed number, e.g. 7 → "2⅓". */
export function formatMoves(thirds: number): string {
  const whole = Math.floor(thirds / THIRDS_PER_MP);
  const part = FRACTIONS[thirds % THIRDS_PER_MP]!;
  if (whole === 0 && part) return part;
  return `${whole}${part}`;
}

/** A combat strength with at most two decimals: 17.5, 12, 11.25. */
export function formatStrength(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** A probability as a whole percentage, never rounding a possible result to 0% or 100%. */
export function formatPercent(p: number): string {
  if (p > 0 && p < 0.01) return '<1%';
  if (p < 1 && p > 0.99) return '>99%';
  return `${Math.round(p * 100)}%`;
}

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
