import 'dotenv/config';
// CLI uses the same HTTP layer as MCP/UI: one cache, quota ledger and database writer.
const [command = 'status', json = '{}'] = process.argv.slice(2);
const routes: Record<string, string> = {
  status: '',
  search: '/search',
  monitor: '/monitor',
  board: '/boards',
  web: '/web-plan',
  ats: '/ats',
  enrich: '/enrich',
};
if (!(command in routes))
  throw new Error('Команды: status, search, monitor, board, web, ats, enrich');
const base = new URL(process.env.SCOUT_API_URL || `http://127.0.0.1:${process.env.PORT || 4317}`);
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))
  throw new Error('Нужен локальный SCOUT_API_URL');
const response = await fetch(new URL(`/api/source-tools${routes[command]}`, base), {
  method: command === 'status' ? 'GET' : 'POST',
  headers: { 'Content-Type': 'application/json' },
  ...(command === 'status' ? {} : { body: JSON.stringify(JSON.parse(json)) }),
  redirect: 'error',
  signal: AbortSignal.timeout(300000),
});
console.log(JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exitCode = 1;
