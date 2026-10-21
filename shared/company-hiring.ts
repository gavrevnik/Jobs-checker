import { z } from 'zod';

const publicUrl = z.url().refine((value) => /^https?:\/\//i.test(value), 'Нужен HTTP(S) URL');
const checkedAt = z.iso.datetime({ offset: true });
const evidence = z.object({
  evidenceUrls: z.array(publicUrl).min(1).max(15),
  evidence: z.string().trim().min(1).max(2500),
  checkedAt,
  verificationMethod: z.enum(['official_site', 'official_ats', 'search']),
});
const careers = evidence.extend({ url: publicUrl, status: z.enum(['confirmed', 'needs_review']) });
const linkedin = evidence.extend({
  profileUrl: publicUrl.transform((value, ctx) => {
    const url = new URL(value);
    const slug = /^\/company\/([^/]+)\/?(?:jobs\/?)?$/.exec(url.pathname)?.[1];
    if (!/(^|\.)linkedin\.com$/i.test(url.hostname) || !slug) {
      ctx.addIssue({ code: 'custom', message: 'Нужна страница LinkedIn /company/{slug}/' });
      return z.NEVER;
    }
    return `https://www.linkedin.com/company/${slug}/`;
  }),
  externalCompanyId: z.string().regex(/^\d+$/).optional(),
  identityStatus: z.enum(['confirmed', 'slug_only', 'needs_review']),
});
export const companyHiringSchema = z.object({
  checkedAt,
  careers: careers.nullable().default(null),
  linkedin: linkedin.nullable().default(null),
  ats: z
    .array(
      evidence.extend({
        provider: z.enum(['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'other']),
        url: publicUrl,
        board: z.string().max(300).default(''),
        status: z.enum(['confirmed', 'needs_review']),
      }),
    )
    .max(10)
    .default([]),
  notes: z.string().max(4000).default(''),
});
export type CompanyHiring = z.infer<typeof companyHiringSchema>;

export function companyHiringLinks(company: { hiringSources?: CompanyHiring }) {
  const data = company.hiringSources;
  const links: { label: string; url: string }[] = [];
  if (data?.careers?.status === 'confirmed')
    links.push({ label: 'Careers', url: data.careers.url });
  const li = data?.linkedin;
  if (li && li.identityStatus !== 'needs_review')
    links.push({
      label: 'LinkedIn Jobs',
      url: li.externalCompanyId
        ? `https://www.linkedin.com/jobs/search/?f_C=${li.externalCompanyId}`
        : `${li.profileUrl}jobs/`,
    });
  return links;
}
