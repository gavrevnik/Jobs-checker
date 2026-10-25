import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Store } from '../server/store';
import { CompanyResearch } from '../server/company-research';
import { importPublicCases, parsePublicCasesMarkdown } from '../server/public-cases-import';
import { CompanyPublicCases, PublicCasesContent } from '../src/CompanyPublicCases';
import type { Company } from '../shared/model';

const stores: Store[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.db.close()));
function setup() {
  const store = new Store(':memory:');
  stores.push(store);
  const company = store.saveCompany({ name: 'Example', notes: 'My note' });
  return { store, company };
}
function document(id: string, summary = 'Проверяли *метод* и `events`, сохранив контекст.') {
  return `# Исследование

Вводная часть.

## Example

**company_id:** \`${id}\`\x20\x20
**Команды и продукты:** Data Platform; исторический опыт.
**Темы:** \`#ab_testing\` \`#data_quality\`

- **Проверка метрик.** ${summary} [Team publication](https://example.test/blog?version=1) (2021; исторический материал).
- **Проверка событий.** Второй самостоятельный кейс. [Another source](https://example.test/events) (без указанной даты).
`;
}
const parse = (md: string) => parsePublicCasesMarkdown(md, 'research.md', '2026-10-22T10:00:00Z');

describe('Public cases import', () => {
  it('preserves full descriptions, scope, topics and imprecise publication dates', () => {
    const { company } = setup();
    const [section] = parse(document(company.id));
    expect(section.cases).toHaveLength(2);
    expect(section.cases[0]).toMatchObject({
      title: 'Проверка метрик.',
      summary: 'Проверяли *метод* и `events`, сохранив контекст.',
      scope: 'Data Platform; исторический опыт.',
      topics: ['ab_testing', 'data_quality'],
      source: {
        publication: '2021; исторический материал',
        url: 'https://example.test/blog?version=1',
      },
      sourceDocument: 'research.md',
      importedAt: '2026-10-22T10:00:00Z',
    });
    expect(section.cases[1].source.publication).toBe('без указанной даты');
    expect(section.cases[0].sourceDigest).toHaveLength(64);
  });

  it('previews without writes, appends once and preserves all previous company and research state', () => {
    const { store, company } = setup();
    const research = new CompanyResearch(store);
    research.preferences(company.id, { priority: 'Target', notes: 'Keep this queue' });
    const { job } = store.addJob({
      title: 'Analyst',
      company: 'Example',
      url: 'https://example.test/job',
    });
    store.updateJob(job.id, { stage: 'interview', notes: 'Interview note' });
    research.profile(company.id); // establish the existing score/history before the import
    const snapshot = (table: string) => store.db.prepare(`SELECT * FROM ${table}`).all();
    const tables = [
      'jobs',
      'company_research_preferences',
      'company_research_scores',
      'company_research_observations',
      'company_research_runs',
      'selection_profile_versions',
    ];
    const before = tables.map(snapshot);
    const rawBefore = store.db
      .prepare('SELECT data FROM companies WHERE id=?')
      .get(company.id)!.data;
    const sections = parse(document(company.id));
    expect(importPublicCases(store.db, sections)[0].added).toBe(2);
    expect(store.db.prepare('SELECT data FROM companies WHERE id=?').get(company.id)!.data).toBe(
      rawBefore,
    );
    importPublicCases(store.db, sections, true);
    expect(
      importPublicCases(
        store.db,
        parsePublicCasesMarkdown(document(company.id), 'again.md'),
        true,
      )[0],
    ).toMatchObject({ added: 0, skipped: 2, total: 2 });
    const stored = store.get<Company>('companies', company.id)!;
    const { publicCases, ...rest } = stored;
    expect(rest).toEqual(company);
    expect(publicCases).toHaveLength(2);
    expect(tables.map(snapshot)).toEqual(before);
    // Ordinary profile edits and the standard export preserve the new optional data.
    store.saveCompany({ ...stored, notes: 'Edited note', publicCases: undefined }, company.id);
    expect(store.state().companies[0].publicCases).toEqual(publicCases);
    expect(research.profile(company.id).company.publicCases).toEqual(publicCases);
    // A later revised report is additive: the earlier text and provenance remain available.
    importPublicCases(store.db, parse(document(company.id, 'Уточнённый вывод.')), true);
    expect(store.get<Company>('companies', company.id)!.publicCases).toHaveLength(3);
  });

  it('rejects truncated input, unsafe URLs and wrong company identity without partial writes', () => {
    const { store, company } = setup();
    expect(() =>
      parse(document(company.id).replace('https://example.test/events', 'javascript:alert')),
    ).toThrow();
    expect(() => parse(document(company.id) + '\nНераспознанный текст')).toThrow();
    expect(() => parse(document(company.id) + document(company.id))).toThrow();
    const valid = parse(document(company.id));
    const missing = parse(document('26e7a172-e75d-4da9-a088-1158d85e43fe'));
    expect(() => importPublicCases(store.db, [...valid, ...missing], true)).toThrow(
      'Компания не найдена',
    );
    expect(() =>
      importPublicCases(
        store.db,
        parse(document(company.id).replace('## Example', '## Different')),
        true,
      ),
    ).toThrow('Название компании не совпадает');
    expect(store.get<Company>('companies', company.id)!.publicCases).toBeUndefined();
  });
});

it('hides empty public cases and renders supplied research safely with working source links', () => {
  const { company } = setup();
  expect(renderToStaticMarkup(<CompanyPublicCases company={company} />)).toBe('');
  const cases = parse(
    document(company.id, 'Текст <script>alert(1)</script> и *метод* с `events`.'),
  )[0].cases;
  expect(
    renderToStaticMarkup(<CompanyPublicCases company={{ ...company, publicCases: cases }} />),
  ).toContain('Публичные кейсы (2)');
  const html = renderToStaticMarkup(<PublicCasesContent cases={cases} />);
  expect(html).toContain('<em>метод</em>');
  expect(html).toContain('<code>events</code>');
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  expect(html).toContain('href="https://example.test/blog?version=1"');
  expect(html).toContain('без указанной даты');
});
