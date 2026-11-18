import { z } from 'zod';

const text = (max: number) => z.string().trim().min(1).max(max);
const glassdoorUrl = z
  .url()
  .max(2000)
  .refine((value) => {
    if (!URL.canParse(value)) return false;
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      !url.port &&
      /^(?:www\.)?glassdoor\.(?:com|co\.uk|ca|de|fr|es|it|nl|ie|at|ch|com\.au|co\.in|com\.br|com\.hk|sg|co\.nz|com\.mx|co\.kr|co\.jp)$/i.test(
        url.hostname,
      )
    );
  }, 'Нужна публичная HTTPS-ссылка Glassdoor');
const sourceFields = { url: glassdoorUrl, checkedOn: z.iso.date() };
const sourceSchema = z.discriminatedUnion('via', [
  z.strictObject({ ...sourceFields, via: z.literal('public_web') }),
  z.strictObject({ ...sourceFields, via: z.literal('browser') }),
  z.strictObject({
    ...sourceFields,
    via: z.literal('apify'),
    runId: z.string().regex(/^[a-zA-Z0-9]{1,40}$/),
  }),
]);
const common = {
  id: z.string().regex(/^(?:report|question):[1-9]\d{0,19}$/),
  role: text(200).optional(),
  location: text(200).optional(),
  publishedOn: z.iso.date().optional(),
  sources: z.array(sourceSchema).min(1).max(20),
};
const question = z.strictObject({
  text: text(2000),
  wording: z.enum(['quoted', 'paraphrased']),
});
const assignment = z.strictObject({
  format: z.enum(['take_home', 'live', 'unspecified']),
  details: text(6000),
  timeLimit: text(160).optional(),
});
export const companyGlassdoorEntrySchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...common,
      kind: z.literal('interview'),
      interviewOn: z.iso.date().optional(),
      summary: text(6000).optional(),
      questions: z.array(question).max(30).optional(),
      assignments: z.array(assignment).max(15).optional(),
    }),
    z.strictObject({ ...common, kind: z.literal('employee_review'), summary: text(6000) }),
  ])
  .refine(
    (entry) =>
      entry.kind === 'employee_review'
        ? entry.id.startsWith('report:')
        : Boolean(entry.summary || entry.questions?.length || entry.assignments?.length),
    'Укажите содержание интервью или ID отчёта сотрудника',
  );
export const companyGlassdoorInfoSchema = z
  .array(companyGlassdoorEntrySchema)
  .max(500)
  .refine(
    (entries) => new Set(entries.map((entry) => entry.id)).size === entries.length,
    'Повторяющиеся ID Glassdoor',
  );
export const companyGlassdoorUpdateSchema = z.strictObject({
  entries: z.array(companyGlassdoorEntrySchema).min(1).max(50),
});
export type CompanyGlassdoorEntry = z.infer<typeof companyGlassdoorEntrySchema>;

function mergeBy<T>(previous: T[], incoming: T[], key: (item: T) => string): T[] {
  return [...new Map([...previous, ...incoming].map((item) => [key(item), item])).values()];
}

export function mergeCompanyGlassdoorInfo(
  stored: CompanyGlassdoorEntry[],
  incoming: CompanyGlassdoorEntry[],
) {
  const entries = new Map(stored.map((entry) => [entry.id, entry]));
  for (const entry of incoming) {
    const previous = entries.get(entry.id);
    if (!previous) {
      entries.set(entry.id, entry);
      continue;
    }
    if (previous.kind !== entry.kind)
      throw new Error('Тип материала конфликтует с сохранённым ID Glassdoor');
    const sources = mergeBy(previous.sources, entry.sources, (source) =>
      [source.via, source.url, source.via === 'apify' ? source.runId : ''].join('|'),
    );
    if (previous.kind === 'interview' && entry.kind === 'interview') {
      const questions = mergeBy(previous.questions ?? [], entry.questions ?? [], (item) =>
        item.text.toLowerCase(),
      );
      const assignments = mergeBy(previous.assignments ?? [], entry.assignments ?? [], (item) =>
        item.details.toLowerCase(),
      );
      entries.set(entry.id, {
        ...previous,
        ...entry,
        sources,
        ...(questions.length ? { questions } : {}),
        ...(assignments.length ? { assignments } : {}),
      });
    } else {
      entries.set(entry.id, { ...previous, ...entry, sources });
    }
  }
  return companyGlassdoorInfoSchema.parse([...entries.values()]);
}
