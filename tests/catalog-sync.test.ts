import { expect, it } from 'vitest';
import { Store } from '../server/store';
import {
  catalogLinks,
  catalogStatus,
  setCatalogInterest,
} from '../../personal-radar/catalog_sync/node';
it('keeps CRM state local while canonical interest goes into a coalesced outbox', () => {
  const store = new Store(':memory:');
  try {
    const company = store.saveCompany({ name: 'Fixture', notes: 'Keep note', status: 'watching' });
    store.db
      .prepare('INSERT INTO catalog_entity_links VALUES (?,?,?,?,?,?,?,?)')
      .run(
        'companies',
        company.id,
        'owner',
        'fixture',
        'a'.repeat(40),
        new Date().toISOString(),
        JSON.stringify({ id: 'fixture', name: 'Fixture', type: 'organization' }),
        '{}',
      );
    setCatalogInterest(store.db, 'companies', company.id, 'high');
    setCatalogInterest(store.db, 'companies', company.id, 'low');
    expect(catalogStatus(store.db).outbox.pending).toBe(1);
    expect(catalogLinks(store.db)[0].pending[0].value).toBe('low');
    expect(store.get<any>('companies', company.id)?.notes).toBe('Keep note');
    expect(() => setCatalogInterest(store.db, 'companies', company.id, 'invalid')).toThrow();
    expect(store.list('jobs')).toHaveLength(0);
  } finally {
    store.db.close();
  }
});
