import { z } from 'zod';
import rulesetJson from '../data/ruleset.json';
import unitsJson from '../data/units.json';

/** Movement is counted in thirds so a road (1/3 MP) is a whole number. */
export const THIRDS_PER_MP = 3;

const domain = z.enum(['land', 'sea', 'air']);
export type Domain = z.infer<typeof domain>;

const nonNegInt = z.number().int().nonnegative();
const nonNeg = z.number().nonnegative();

const terrainSchema = z.object({
  name: z.string().min(1),
  char: z.string().length(1),
  domain: z.enum(['land', 'sea']),
  moveCost: z.number().int().positive(),
  defenceBonus: nonNeg,
  sightBonus: nonNegInt,
});
export type TerrainDef = z.infer<typeof terrainSchema>;

const unitTypeSchema = z.object({
  name: z.string().min(1),
  domain,
  attack: nonNeg,
  defence: nonNeg,
  movement: nonNegInt,
  bombardStrength: nonNeg.default(0),
  bombardRange: nonNegInt.default(0),
  rateOfFire: nonNegInt.default(0),
  operationalRange: nonNegInt.default(0),
  sight: nonNegInt.default(1),
  cost: z.number().int().positive(),
  canCaptureCities: z.boolean().default(false),
  lethalBombard: z.boolean().default(false),
  airSuperiority: z.boolean().default(false),
  paradropRange: nonNegInt.default(0),
  cargo: z.object({ capacity: z.number().int().positive(), domain }).nullable().default(null),
});
export type UnitTypeDef = z.infer<typeof unitTypeSchema>;

const veteranId = z.enum(['conscript', 'regular', 'veteran', 'elite']);
export type VeteranLevel = z.infer<typeof veteranId>;

export const rulesetSchema = z
  .object({
    terrain: z.record(z.string(), terrainSchema),
    unitTypes: z.record(z.string(), unitTypeSchema),
    combat: z.object({
      riverBonus: nonNeg,
      fortifiedBonus: nonNeg,
      fortressBonus: nonNeg,
      cityTiers: z
        .array(z.object({ minSize: z.number().int().positive(), bonus: nonNeg, wallsBonus: nonNeg }))
        .min(1),
      promotionChance: z.number().min(0).max(1),
    }),
    veteranLevels: z
      .array(z.object({ id: veteranId, name: z.string(), hp: z.number().int().positive() }))
      .length(4),
    movement: z.object({
      roadCostThirds: nonNegInt,
      railCostThirds: nonNegInt,
      attackCostThirds: z.number().int().positive(),
    }),
    healing: z.object({ perTurn: nonNegInt, fullInFriendlyCity: z.boolean() }),
    air: z.object({ interceptsPerTurn: nonNegInt, reconRadius: nonNegInt }),
    citySight: nonNegInt,
  })
  .superRefine((r, ctx) => {
    const chars = new Map<string, string>();
    for (const [id, t] of Object.entries(r.terrain)) {
      const clash = chars.get(t.char);
      if (clash)
        ctx.addIssue({ code: 'custom', message: `terrain "${id}" reuses char "${t.char}" of "${clash}"` });
      chars.set(t.char, id);
    }
    const tiers = r.combat.cityTiers;
    if (tiers[0]?.minSize !== 1)
      ctx.addIssue({ code: 'custom', message: 'first city tier must start at size 1' });
    for (let i = 1; i < tiers.length; i++) {
      if (tiers[i]!.minSize <= tiers[i - 1]!.minSize)
        ctx.addIssue({ code: 'custom', message: 'city tiers must be in increasing minSize order' });
    }
    const order = ['conscript', 'regular', 'veteran', 'elite'];
    r.veteranLevels.forEach((v, i) => {
      if (v.id !== order[i])
        ctx.addIssue({ code: 'custom', message: `veteran levels must be ordered ${order.join(', ')}` });
    });
  });

export type Ruleset = z.infer<typeof rulesetSchema>;

export class RulesetError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid ruleset:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
  }
}

export function parseRuleset(json: unknown): Ruleset {
  const result = rulesetSchema.safeParse(json);
  if (!result.success) throw new RulesetError(formatIssues(result.error));
  return result.data;
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
}

export const defaultRuleset: Ruleset = parseRuleset({ ...rulesetJson, unitTypes: unitsJson });

// ---- lookups ----

export function unitType(ruleset: Ruleset, id: string): UnitTypeDef {
  const t = ruleset.unitTypes[id];
  if (!t) throw new Error(`Unknown unit type "${id}"`);
  return t;
}

export function terrainDef(ruleset: Ruleset, id: string): TerrainDef {
  const t = ruleset.terrain[id];
  if (!t) throw new Error(`Unknown terrain "${id}"`);
  return t;
}

export function maxHp(ruleset: Ruleset, level: VeteranLevel): number {
  return ruleset.veteranLevels.find((v) => v.id === level)!.hp;
}
