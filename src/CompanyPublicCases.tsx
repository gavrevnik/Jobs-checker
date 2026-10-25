import { Fragment, useCallback, useState } from 'react';
import type { Company } from '../shared/model';
import type { CompanyPublicCase } from '../shared/company-public-cases';
import { Modal } from './components';

// Only the inline emphasis/code used by the research format is supported. React escapes
// everything else; raw HTML or Markdown links in a summary are never executed.
export function PublicCaseText({ text }: { text: string }) {
  return text
    .split(/(`[^`]+`|\*[^*]+\*)/g)
    .map((part, i) => (
      <Fragment key={i}>
        {part.startsWith('`') && part.endsWith('`') ? (
          <code>{part.slice(1, -1)}</code>
        ) : part.startsWith('*') && part.endsWith('*') ? (
          <em>{part.slice(1, -1)}</em>
        ) : (
          part
        )}
      </Fragment>
    ));
}

export function PublicCasesContent({ cases }: { cases: CompanyPublicCase[] }) {
  const scopes = [...new Set(cases.map((c) => c.scope))];
  const topics = [...new Set(cases.flatMap((c) => c.topics))];
  return (
    <div className="company-column-details company-public-cases">
      {scopes.length === 1 && (
        <p className="information-scope">
          <strong>Команды и продукты:</strong> {scopes[0]}
        </p>
      )}
      {topics.length > 0 && (
        <div className="public-case-topics" aria-label="Темы кейсов">
          {topics.map((topic) => (
            <span key={topic}>#{topic}</span>
          ))}
        </div>
      )}
      <p className="information-notice">
        Даты относятся к публикациям. Кейсы описывают опыт указанных команд.
      </p>
      {cases.map((item) => (
        <article key={item.id} className="information-item">
          <h3>{item.title}</h3>
          {scopes.length > 1 && <p className="information-scope">{item.scope}</p>}
          <p className="information-answer">
            <PublicCaseText text={item.summary} />
          </p>
          <p className="public-case-source">
            <a href={item.source.url} target="_blank" rel="noreferrer">
              {item.source.title} ↗
            </a>{' '}
            <span>({item.source.publication})</span>
          </p>
        </article>
      ))}
      <small>
        Из предоставленного исследования ·{' '}
        {[...new Set(cases.map((c) => c.sourceDocument))].join(', ')}
      </small>
    </div>
  );
}

export function CompanyPublicCases({
  company,
}: {
  company: Pick<Company, 'name' | 'publicCases'>;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const cases = company.publicCases || [];
  if (!cases.length) return null;
  return (
    <div className="comparison-public-cases-section">
      <button
        className="comparison-heading-button"
        aria-label={`Публичные кейсы (${cases.length}): ${company.name}`}
        onClick={() => setOpen(true)}
      >
        Публичные кейсы ({cases.length})
      </button>
      {open && (
        <Modal title={`${company.name} · Публичные кейсы (${cases.length})`} close={close} wide>
          <PublicCasesContent cases={cases} />
        </Modal>
      )}
    </div>
  );
}
