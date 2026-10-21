import type { Company, Job } from './model.js';
import { researchImportSchema, type Observation, type ResearchImport } from './company-research.js';

/** Additive conversion only. A saved card is provenance, not a newly checked public source. */
export function legacyCompanyResearch(
  companies: Company[],
  jobs: Job[],
  generatedAt: string,
  stateUrl = 'http://127.0.0.1:4317/api/state',
): ResearchImport {
  return researchImportSchema.parse({
    schema_version: '1.0',
    generated_at: generatedAt,
    research_mode: 'internal_discovery',
    companies: companies.map((company) => {
      const observedAt = company.checkedAt || company.updatedAt;
      const evidence = (excerpt: string) => [
        {
          url: `${stateUrl}#company=${encodeURIComponent(company.id)}`,
          title: `Исходная карточка ${company.name}`,
          source_type: 'user' as const,
          observed_at: observedAt,
          excerpt,
        },
      ];
      const base = {
        confidence: 'low' as const,
        scope: { context: 'legacy_company_card' },
        reasoning: 'Перенос сохранённых сведений без повторной проверки публичного источника.',
      };
      const observations: Observation[] = [
        {
          ...base,
          criterion_id: 'B04',
          value: [company.industry, company.description].filter(Boolean).join(' · ') || null,
          evidence: evidence(
            [company.industry, company.description].filter(Boolean).join(' · ') ||
              'Описание в исходной карточке отсутствует.',
          ),
        },
        {
          ...base,
          criterion_id: 'A02_HQ',
          value: null,
          reasoning:
            'Старое поле location не отделяло основной офис от офисов и найма; страну штаб-квартиры нужно проверить.',
          evidence: [],
        },
      ];
      if (company.workModes.length)
        observations.push({
          ...base,
          criterion_id: 'A05',
          value: { modes: company.workModes, eligible_countries: [] },
          evidence: evidence(
            `Сохранённые форматы: ${company.workModes.join(', ')}. География допуска неизвестна.`,
          ),
        });
      const linkedJobs = jobs.filter(
        (job) => job.companyId === company.id && /^https?:\/\//.test(job.url),
      );
      for (const job of linkedJobs) {
        const jobEvidence = [
          {
            url: job.url,
            title: `Сохранённая вакансия: ${job.title}`,
            source_type: 'user' as const,
            observed_at: job.lastSeenAt || job.updatedAt,
            excerpt: `Сохранённая карточка: ${job.location}; формат: ${job.workMode}. Это не повторная проверка объявления.`,
          },
        ];
        const scoped = {
          ...base,
          scope: { job_url: job.url, role: job.title, context: 'legacy_job_card' },
          evidence: jobEvidence,
        };
        if (job.workMode !== 'unknown')
          observations.push({
            ...scoped,
            criterion_id: 'A05',
            value: { modes: [job.workMode], eligible_countries: [] },
          });
      }
      return {
        identity: {
          name: company.name,
          company_id: company.id,
          ...(company.website ? { website: company.website } : {}),
        },
        observations,
        job_urls: [...new Set(linkedJobs.map((job) => job.url))],
        red_flags: [],
        notes: [
          'Аддитивная миграция существующей карточки. Исходные заметки, CRM-статус, оценки и вакансии сохранены. Старые оценки не пересчитаны в discovery scores.',
          company.location &&
            `Старое поле location (назначение не определено): ${company.location}`,
          company.size && `Сохранённый размер команды (не стадия финансирования): ${company.size}`,
          company.dataDrivenEvidence &&
            `Ранее сохранённое обоснование data-driven оценки, не подтверждённое новым review: ${company.dataDrivenEvidence}`,
          company.evidenceUrls.length &&
            `Прежние ссылки для последующей проверки: ${company.evidenceUrls.join('\n')}`,
        ]
          .filter(Boolean)
          .join('\n\n'),
      };
    }),
  });
}
