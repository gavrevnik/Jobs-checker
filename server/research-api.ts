import type { Express } from 'express';
import { z } from 'zod';
import type { Store } from './store.js';
import { CompanyResearch } from './company-research.js';
import { ResearchPaidGate } from './research-paid.js';
import { registry } from '../shared/company-research.js';
const context = z.object({
  country: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .optional(),
  profileId: z.string().max(100).optional(),
});
export function registerResearchApi(app: Express, store: Store) {
  const research = new CompanyResearch(store),
    paid = new ResearchPaidGate(store);
  app.get('/api/company-research/criteria', (_req, res) => res.json(registry));
  app.get('/api/company-research', (req, res) => {
    const c = context.parse(req.query);
    res.json(research.list(c.country, c.profileId));
  });
  app.post('/api/company-research/recalculate', (req, res) => {
    const { companyIds } = z
      .strictObject({
        companyIds: z.array(z.string().min(1)).min(1).max(5000).optional(),
      })
      .parse(req.body);
    res.json(research.recalculateScores(companyIds));
  });
  app.post('/api/company-research/preview', (req, res) => res.json(research.preview(req.body)));
  app.post('/api/company-research/import', (req, res) => res.json(research.apply(req.body)));
  app.get('/api/company-research/history', (req, res) =>
    res.json({
      runs: research.history(
        z
          .string()
          .max(100)
          .parse(req.query.companyId || ''),
      ),
    }),
  );
  app.get('/api/company-research/paid', (_req, res) => res.json(paid.plan()));
  app.post('/api/company-research/paid/authorize', async (req, res) =>
    res.json(await paid.authorize(req.body)),
  );
  app.post('/api/company-research/paid/execute', async (req, res) =>
    res.json(await paid.execute(req.body)),
  );
  app.get('/api/company-research/:id/plan', (req, res) => {
    const c = context.parse(req.query);
    res.json(research.plan(String(req.params.id), c.country));
  });
  app.get('/api/company-research/:id', (req, res) => {
    const c = context.parse(req.query);
    res.json(research.profile(String(req.params.id), c.country, c.profileId));
  });
  app.post('/api/company-research/:id/observations', (req, res) =>
    res.json(research.manual(String(req.params.id), req.body)),
  );
  app.patch('/api/company-research/flags/:id', (req, res) =>
    res.json(research.reviewFlag(String(req.params.id), req.body)),
  );
  app.patch('/api/company-research/observations/:id', (req, res) =>
    res.json(research.review(String(req.params.id), req.body)),
  );
  app.patch('/api/company-research/:id/preferences', (req, res) =>
    res.json(research.preferences(String(req.params.id), req.body)),
  );
}
