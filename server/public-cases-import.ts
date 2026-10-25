import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { companySchema } from '../shared/model.js';
import { companyPublicCaseSchema, type CompanyPublicCase } from '../shared/company-public-cases.js';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
type PublicCasesSection = { companyId: string; name: string; cases: CompanyPublicCase[] };

// This parser treats the supplied document solely as data. No HTML, commands or instructions
// from it are evaluated. Reject unrecognised content instead of silently dropping a case.
export function parsePublicCasesMarkdown(
  markdown: string,
  sourceDocument: string,
  importedAt = new Date().toISOString(),
): PublicCasesSection[] {
  const sourceDigest = digest(markdown);
  const sections = markdown.replace(/\r\n/g, '\n').split(/^## /m).slice(1);
  if (!sections.length) throw new Error('В документе нет разделов компаний');
  const seen = new Set<string>();
  return sections.map((section) => {
    const [name, ...lines] = section.trim().split('\n');
    const content = lines.filter((line) => line.trim()).map((line) => line.trim());
    const idLine = content.shift()?.match(/^\*\*company_id:\*\* `([^`]+)`$/);
    const scope = content.shift()?.match(/^\*\*Команды и продукты:\*\* (.+)$/)?.[1];
    const topicsLine = content.shift()?.match(/^\*\*Темы:\*\* (.+)$/)?.[1];
    const companyId = z.uuid().parse(idLine?.[1]);
    if (!scope || !topicsLine || !content.length || seen.has(companyId))
      throw new Error(`Неполный или повторный раздел: ${name}`);
    seen.add(companyId);
    const topics = [...topicsLine.matchAll(/`#([^`]+)`/g)].map((m) => m[1]);
    if (!topics.length || topicsLine.replace(/`#[^`]+`/g, '').trim())
      throw new Error(`Неизвестный формат тем: ${name}`);
    const caseIds = new Set<string>();
    const cases = content.map((line) => {
      const match = line.match(
        /^- \*\*(.+?)\*\* (.+?) \[([^\]]+)\]\((https?:\/\/[^\s)]+)\) \((.+)\)\.$/,
      );
      if (!match) throw new Error(`Неизвестный формат кейса: ${name} · ${line.slice(0, 90)}`);
      const [, title, summary, sourceTitle, url, publication] = match;
      const data = {
        title,
        summary,
        scope,
        topics,
        source: { title: sourceTitle, url, publication },
      };
      const id = digest(JSON.stringify({ companyId, ...data }));
      if (caseIds.has(id)) throw new Error(`Повтор кейса: ${name} · ${title}`);
      caseIds.add(id);
      return companyPublicCaseSchema.parse({
        ...data,
        id,
        importedAt,
        sourceDocument,
        sourceDigest,
      });
    });
    return { companyId, name: name.trim(), cases };
  });
}

function planImport(db: DatabaseSync, sections: PublicCasesSection[]) {
  return sections.map((section) => {
    const row = db.prepare('SELECT data FROM companies WHERE id=?').get(section.companyId);
    if (!row) throw new Error(`Компания не найдена: ${section.name} (${section.companyId})`);
    const stored = JSON.parse(String(row.data));
    const company = companySchema.parse(stored);
    if (company.name.trim().toLowerCase() !== section.name.trim().toLowerCase())
      throw new Error(`Название компании не совпадает: ${section.name} / ${company.name}`);
    const existing = new Set((company.publicCases || []).map((c) => c.id));
    const added = section.cases.filter((c) => !existing.has(c.id));
    const publicCases = [...(company.publicCases || []), ...added];
    companySchema.parse({ ...stored, publicCases });
    return { section, stored, publicCases, added: added.length };
  });
}

export function importPublicCases(
  db: DatabaseSync,
  sections: PublicCasesSection[],
  execute = false,
) {
  if (execute) db.exec('BEGIN IMMEDIATE');
  try {
    // Validate every company before the first write. Re-read inside the transaction so concurrent
    // notes/CRM edits are retained. Add only immutable case records, never replace earlier ones.
    const plan = planImport(db, sections);
    if (execute) {
      const update = db.prepare('UPDATE companies SET data=? WHERE id=?');
      for (const item of plan) {
        if (item.added)
          update.run(
            JSON.stringify({ ...item.stored, publicCases: item.publicCases }),
            item.section.companyId,
          );
      }
      db.exec('COMMIT');
    }
    return plan.map((p) => ({
      companyId: p.section.companyId,
      name: p.section.name,
      added: p.added,
      skipped: p.section.cases.length - p.added,
      total: p.publicCases.length,
    }));
  } catch (error) {
    if (execute) db.exec('ROLLBACK');
    throw error;
  }
}
