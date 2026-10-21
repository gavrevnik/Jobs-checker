import { z } from 'zod';
import { profileSchema, type Profile } from './model.js';

export const dimensionIds = [
  'influence',
  'experimentation',
  'peers',
  'data',
  'product',
  'automation',
] as const;
export const dimensions = {
  influence: { label: 'Влияние на продукт', weight: 25, criteria: ['AN01', 'B05', 'P06'] },
  experimentation: { label: 'Эксперименты и методы', weight: 25, criteria: ['AN04'] },
  peers: { label: 'Коллеги и развитие', weight: 25, criteria: ['AN02', 'AN03'] },
  data: { label: 'Работа с данными', weight: 15, criteria: ['T02', 'T08_INFRA'] },
  product: { label: 'Продуктовые задачи', weight: 5, criteria: ['AN05', 'B04', 'B06'] },
  automation: { label: 'LLM и автоматизация', weight: 5, criteria: ['T03'] },
} as const;
export const roleFamilies = {
  product_analytics: 'Продуктовая аналитика',
  data_analytics: 'Data Analyst',
  decision_science: 'Data Science · продукт и решения',
  analytics_lead: 'Лидерство в аналитике',
} as const;
export const coreSchema = profileSchema
  .pick({ name: true, keywords: true, exclude: true, seniority: true, notes: true })
  .extend({
    roleFamilies: z
      .array(z.enum(['product_analytics', 'data_analytics', 'decision_science', 'analytics_lead']))
      .max(4)
      .default([]),
    preferMatureTeam: z.boolean().default(true),
    weights: z
      .object(
        Object.fromEntries(
          dimensionIds.map((id) => [id, z.number().int().min(0).max(100)]),
        ) as Record<(typeof dimensionIds)[number], z.ZodNumber>,
      )
      .default(
        Object.fromEntries(dimensionIds.map((id) => [id, dimensions[id].weight])) as Record<
          (typeof dimensionIds)[number],
          number
        >,
      )
      .refine(
        (w) => Object.values(w).reduce((a, b) => a + b, 0) === 100,
        'Сумма весов должна быть 100',
      ),
  });
export const scenarioSchema = profileSchema
  .pick({
    name: true,
    locations: true,
    workMode: true,
    minSalary: true,
    currency: true,
    salaryPeriod: true,
    notes: true,
  })
  .extend({
    id: z.string().trim().min(1).max(100),
    sponsorship: z.enum(['unknown', 'required', 'not_required']).default('unknown'),
    relocation: z.enum(['any', 'required', 'not_required']).default('any'),
    languages: z.array(z.string().trim().min(1).max(80)).max(15).default([]),
    enabled: z.boolean().default(true),
    legacyProfileId: z.string().max(100).default(''),
  });
export const selectionInputSchema = z
  .strictObject({
    expectedVersion: z.number().int().positive(),
    core: coreSchema,
    scenarios: z.array(scenarioSchema).max(100),
    activeScenarioId: z.string().max(100),
  })
  .superRefine((v, c) => {
    if (new Set(v.scenarios.map((s) => s.id)).size !== v.scenarios.length)
      c.addIssue({ code: 'custom', message: 'Сценарии должны иметь уникальные ID' });
    if (v.activeScenarioId && !v.scenarios.some((s) => s.id === v.activeScenarioId && s.enabled))
      c.addIssue({ code: 'custom', message: 'Активный сценарий не найден или выключен' });
  });
export type SelectionConfig = Omit<z.infer<typeof selectionInputSchema>, 'expectedVersion'> & {
  version: number;
  coreVersion: number;
  updatedAt: string;
};
export type Scenario = z.infer<typeof scenarioSchema>;
export function initialSelection(profiles: Profile[]): SelectionConfig {
  const ranked = [...profiles].sort(
    (a, b) => b.notes.length + b.keywords.length * 100 - (a.notes.length + a.keywords.length * 100),
  );
  const base = ranked[0] || profileSchema.parse({ name: 'Мой профессиональный профиль' });
  const scenarios = profiles
    .filter((p) => p.locations.length || p.workMode !== 'any' || p.minSalary !== null)
    .map((p) =>
      scenarioSchema.parse({
        ...p,
        id: p.id,
        legacyProfileId: p.id,
        notes: '',
      }),
    );
  return {
    version: 1,
    coreVersion: 1,
    updatedAt: new Date().toISOString(),
    core: coreSchema.parse({
      ...base,
      name:
        base.name
          .split('·')
          .map((s) => s.trim())
          .find((s) => /analyst|аналитик/i.test(s)) || base.name,
      roleFamilies: /analyst|аналитик/i.test(base.name + ' ' + base.keywords.join(' '))
        ? Object.keys(roleFamilies)
        : [],
    }),
    scenarios,
    activeScenarioId: '',
  };
}
export function effectiveProfile(config: SelectionConfig, requested?: string): Profile {
  const id =
    requested === 'all' || requested === 'professional-core'
      ? ''
      : (requested ?? config.activeScenarioId);
  const scenario = id
    ? config.scenarios.find((s) => s.id === id || s.legacyProfileId === id)
    : undefined;
  if (id && (!scenario || !scenario.enabled))
    throw new Error('Сценарий доступности не найден или выключен');
  return {
    ...profileSchema.parse({
      ...config.core,
      ...scenario,
      name: config.core.name,
      notes: config.core.notes,
    }),
    id: scenario?.id || 'professional-core',
    selection: {
      version: config.coreVersion,
      scenarioId: scenario?.id || '',
      roleFamilies: config.core.roleFamilies,
      scenarioName: scenario?.name || 'Без ограничений географии',
    },
  };
}
