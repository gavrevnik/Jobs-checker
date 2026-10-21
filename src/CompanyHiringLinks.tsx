import { ExternalLink } from 'lucide-react';
import { companyHiringLinks, type CompanyHiring } from '../shared/company-hiring';

export function CompanyHiringLinks({ company }: { company: { hiringSources?: CompanyHiring } }) {
  const links = companyHiringLinks(company);
  return links.length ? (
    <div className="company-hiring-links" aria-label="Карьерные страницы компании">
      {links.map((link) => (
        <a key={link.label} href={link.url} target="_blank" rel="noreferrer">
          {link.label} <ExternalLink size={12} aria-hidden="true" />
        </a>
      ))}
    </div>
  ) : null;
}
