import 'dotenv/config';
import express from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import { Store } from './store.js';
import { SourceTools } from './source-tools.js';
import { SyncService } from './providers.js';
import { loadDemo } from './demo.js';
import type { Company, Source } from '../shared/model.js';

const app = express();
const port = Number(process.env.PORT || 4317);
const store = new Store(resolve(process.env.SCOUT_DB || '../data/jobs-checker/scout.sqlite'));
const sync = new SyncService(store);
const sourceTools = new SourceTools(store);
app.disable('x-powered-by');
app.use((req, res, next) => {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(req.hostname))
    return res.status(403).json({ error: 'Только локальный доступ' });
  const origin = req.get('origin');
  if (origin && ![`http://localhost:${port}`, `http://127.0.0.1:${port}`].includes(origin))
    return res.status(403).json({ error: 'Недопустимый origin' });
  if (
    req.path.startsWith('/api/') &&
    ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) &&
    !req.is('application/json')
  )
    return res.status(415).json({ error: 'Требуется application/json' });
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '20mb' }));
app.use('/api', (req, res, next) => {
  if (
    ['POST', 'PATCH', 'DELETE'].includes(req.method) &&
    (sync.busy || sourceTools.busy) &&
    /^\/(sources|source-tools|sync)(\/|$)/.test(req.path)
  )
    return res.status(409).json({ error: 'Дождитесь завершения загрузки' });
  next();
});
app.get('/api/source-tools', (_req, res) => res.json(sourceTools.status()));
app.patch('/api/source-tools/providers/:id', (req, res) =>
  res.json(sourceTools.configure(String(req.params.id), req.body)),
);
app.post('/api/source-tools/search', async (req, res) =>
  res.json(await sourceTools.search(req.body)),
);
app.post('/api/source-tools/boards', (req, res) => res.json(sourceTools.addBoard(req.body)));
app.post('/api/source-tools/monitor', async (req, res) =>
  res.json(await sourceTools.monitor(req.body)),
);
app.post('/api/source-tools/enrich', async (req, res) =>
  res.json(await sourceTools.enrich(req.body)),
);
app.post('/api/source-tools/web-plan', (req, res) => res.json(sourceTools.webPlan(req.body)));
app.post('/api/source-tools/ats', (req, res) => res.json(sourceTools.ats(req.body)));
app.post('/api/source-tools/discovery-history', (req, res) =>
  res.json({ reviews: store.discoveryHistory(req.body) }),
);
app.post('/api/source-tools/discovery-review', (req, res) =>
  res.json(store.saveDiscoveryReview(req.body)),
);
app.get('/api/state', (_req, res) => res.json(store.state()));
app.get('/api/health', (_req, res) =>
  res.json({ ok: true, application: 'jobs-checker', workspace: resolve('.'), syncing: sync.busy }),
);
app.post('/api/jobs', (req, res) => res.json(store.addJob(req.body)));
app.patch('/api/jobs/:id', (req, res) =>
  res.json(store.updateJob(String(req.params.id), req.body)),
);
app.delete('/api/jobs/:id', (req, res) => {
  store.delete('jobs', String(req.params.id));
  res.json({ ok: true });
});
app.post('/api/companies', (req, res) => {
  const key = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (
    typeof req.body.name === 'string' &&
    store.list<Company>('companies').some((c) => key(c.name) === key(req.body.name))
  )
    return res
      .status(409)
      .json({ error: 'Компания уже есть в базе. Откройте её карточку для редактирования.' });
  res.json(store.saveCompany(req.body));
});
app.patch('/api/companies/:id', (req, res) => {
  const old = store.get<Company>('companies', String(req.params.id));
  res.json(
    store.transaction(() => store.saveCompany({ ...old, ...req.body }, String(req.params.id))),
  );
});
app.post('/api/profiles', (req, res) => res.json(store.saveProfile(req.body)));
app.patch('/api/profiles/:id', (req, res) =>
  res.json(store.saveProfile(req.body, String(req.params.id))),
);
app.delete('/api/profiles/:id', (req, res) => {
  if (store.list('profiles').length <= 1)
    return res.status(400).json({ error: 'Оставьте хотя бы один профиль' });
  store.delete('profiles', String(req.params.id));
  res.json({ ok: true });
});
app.post('/api/sources', (req, res) => res.json(store.saveSource(req.body)));
app.patch('/api/sources/:id', (req, res) => {
  if (sync.busy) return res.status(409).json({ error: 'Дождитесь завершения обновления' });
  const old = store.get<Source>('sources', String(req.params.id));
  res.json(store.saveSource({ ...old, ...req.body }, String(req.params.id)));
});
app.delete('/api/sources/:id', (req, res) => {
  if (sync.busy) return res.status(409).json({ error: 'Дождитесь завершения обновления' });
  store.delete('sources', String(req.params.id));
  res.json({ ok: true });
});
app.post('/api/sync', async (req, res) => {
  const results = await sync.run(
    typeof req.body.sourceId === 'string' ? req.body.sourceId : undefined,
  );
  res.json({ results });
});
app.post('/api/import/preview', (req, res) => res.json(store.importData(req.body, true)));
app.post('/api/import', (req, res) => res.json(store.importData(req.body)));
app.get('/api/export', (_req, res) => {
  const { adzunaConfigured: _, ...data } = store.state();
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="jobs-checker-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  res.json({ version: 1, exportedAt: new Date().toISOString(), ...data });
});
app.post('/api/demo', (_req, res) => res.json(loadDemo(store)));
app.delete('/api/demo', (_req, res) => {
  store.clearDemo();
  res.json({ ok: true });
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Метод API не найден' }));
app.use(
  (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ZodError)
      return res.status(400).json({
        error: err.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
          .slice(0, 2000),
      });
    const message = err instanceof Error ? err.message : 'Ошибка сервера';
    if (/UNIQUE constraint/.test(message))
      return res.status(409).json({ error: 'Запись с такой ссылкой или идентификатором уже есть' });
    res.status(400).json({ error: message.slice(0, 1000) });
  },
);

if (process.argv.includes('--production')) {
  if (!existsSync(resolve('dist/index.html'))) throw new Error('Сначала выполните npm run build');
  app.use(express.static(resolve('dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(resolve('dist/index.html')));
} else {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { host: '127.0.0.1' } },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}
const server = app.listen(port, '127.0.0.1', () =>
  console.log(
    `\n  Jobs checker доступен на http://127.0.0.1:${port}\n  База: ${resolve(process.env.SCOUT_DB || '../data/jobs-checker/scout.sqlite')}\n`,
  ),
);
server.on('error', (error) => {
  console.error(error.message);
  process.exit(1);
});
process.on('SIGINT', () => {
  server.close();
  store.db.close();
  process.exit(0);
});
process.on('SIGTERM', () => {
  server.close();
  store.db.close();
  process.exit(0);
});
