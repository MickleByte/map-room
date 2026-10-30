import { describe, expect, it } from 'vitest';
import { formatMoves } from './format';

describe('formatMoves', () => {
  it('shows movement thirds as mixed numbers', () => {
    expect(formatMoves(0)).toBe('0');
    expect(formatMoves(1)).toBe('⅓');
    expect(formatMoves(2)).toBe('⅔');
    expect(formatMoves(3)).toBe('1');
    expect(formatMoves(7)).toBe('2⅓');
  });
});
