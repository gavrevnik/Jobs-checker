import { useEffect, useState } from 'react';
import { api } from './api';
import { Modal } from './components';
import { companyUsefulLinks } from './company-useful-links';
import type { ComparisonProfile } from './company-comparison';

export function CompanyUsefulLinksModal({
  companyId,
  name,
  close,
}: {
  companyId: string;
  name: string;
  close: () => void;
}) {
  const [profile, setProfile] = useState<ComparisonProfile | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void api<ComparisonProfile>(
      `/company-research/${encodeURIComponent(companyId)}`,
      'GET',
      undefined,
      controller.signal,
    )
      .then(setProfile)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [companyId]);
  const links = profile ? companyUsefulLinks(profile) : [];
  return (
    <Modal title={`${name} · Полезные ссылки`} close={close} wide>
      {error ? (
        <p role="alert">{error}</p>
      ) : !profile ? (
        <p role="status">Загрузка…</p>
      ) : !links.length ? (
        <p>Ссылки пока не сохранены.</p>
      ) : (
        <div className="compact-company-scroll">
          <table className="compact-company-table useful-links-table">
            <thead>
              <tr>
                <th>Источник</th>
                <th>Ссылка</th>
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.url}>
                  <th scope="row">{link.label}</th>
                  <td>
                    <a href={link.url} target="_blank" rel="noreferrer">
                      {link.url}
                    </a>
                    {link.note && <small>{link.note}</small>}
                    {link.children.length > 0 && (
                      <ul className="useful-link-articles">
                        {link.children.map((article) => (
                          <li key={article.url}>
                            <a href={article.url} target="_blank" rel="noreferrer">
                              {article.label}
                            </a>
                            {article.note && <small>{article.note}</small>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
