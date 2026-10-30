import { describe, expect, it } from 'vitest';
import rulesetJson from '../data/ruleset.json';
import unitsJson from '../data/units.json';
import { defaultRuleset, maxHp, parseRuleset, RulesetError } from './ruleset';

const raw = () => structuredClone({ ...rulesetJson, unitTypes: unitsJson });

describe('ruleset', () => {
  it('loads the default ruleset with the full starter roster', () => {
    expect(Object.keys(defaultRuleset.unitTypes)).toHaveLength(13);
    expect(Object.keys(defaultRuleset.terrain)).toHaveLength(11);
  });

  it('fills in defaults for optional unit fields', () => {
    const infantry = defaultRuleset.unitTypes.infantry!;
    expect(infantry.bombardStrength).toBe(0);
    expect(infantry.lethalBombard).toBe(false);
    expect(infantry.cargo).toBeNull();
  });

  it('maps veteran levels to HP', () => {
    expect(maxHp(defaultRuleset, 'conscript')).toBe(2);
    expect(maxHp(defaultRuleset, 'elite')).toBe(5);
  });

  it('rejects terrain types that share a map character', () => {
    const r = raw();
    r.terrain.plains.char = 'g';
    expect(() => parseRuleset(r)).toThrow(/reuses char "g"/);
  });

  it('rejects city tiers out of order', () => {
    const r = raw();
    r.combat.cityTiers.reverse();
    expect(() => parseRuleset(r)).toThrow(RulesetError);
  });

  it('reports the path of a bad field', () => {
    const r = raw() as { unitTypes: Record<string, { attack: unknown }> };
    r.unitTypes.armour!.attack = 'lots';
    expect(() => parseRuleset(r)).toThrow(/unitTypes\.armour\.attack/);
  });
});
