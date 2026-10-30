import { THIRDS_PER_MP } from '../core/ruleset';

const FRACTIONS = ['', '⅓', '⅔'];

/** Movement in thirds as a mixed number, e.g. 7 → "2⅓". */
export function formatMoves(thirds: number): string {
  const whole = Math.floor(thirds / THIRDS_PER_MP);
  const part = FRACTIONS[thirds % THIRDS_PER_MP]!;
  if (whole === 0 && part) return part;
  return `${whole}${part}`;
}

export function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
