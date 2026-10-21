import { companyInfrastructure } from './company-infrastructure';
import { sourceDate } from './CompanySources';
import type { StoredObservation } from '../shared/company-research';

export function InfrastructureSummary({ observations }: { observations: StoredObservation[] }) {
  const infrastructure = companyInfrastructure(observations);
  return (
    <section className="infrastructure-summary">
      <h3>Сводка</h3>
      {infrastructure.summaries.length ? (
        infrastructure.summaries.map((s) => (
          <article key={s.id}>
            {s.scope && <small>{s.scope}</small>}
            <p>{s.text}</p>
            {s.notice && <small>{s.notice}</small>}
            <div className="information-source-links">
              {s.sources.map((e, i) => (
                <a
                  key={i}
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  title={`Источник ${sourceDate(e.published_at || e.observed_at)}`}
                >
                  {e.title} ↗
                </a>
              ))}
            </div>
          </article>
        ))
      ) : (
        <p>Содержательной сводки пока нет.</p>
      )}
    </section>
  );
}
