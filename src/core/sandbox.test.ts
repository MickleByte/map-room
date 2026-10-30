import { describe, expect, it } from 'vitest';
import sandbox from '../data/scenarios/sandbox.json';
import { loadScenario } from './scenario';

describe('sandbox scenario', () => {
  it('loads without validation errors', () => {
    const state = loadScenario(sandbox);
    expect(Object.keys(state.cities)).toHaveLength(6);
    expect(Object.keys(state.units).length).toBeGreaterThan(20);
  });
});
