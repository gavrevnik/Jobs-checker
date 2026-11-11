import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { SelectionConfig } from '../shared/selection-profile.js';

export const selectionSourceKey = 'selection-preferences-source';
export const selectionPreferenceId = 'job-search-preferences';
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const bindingSchema = z.strictObject({
  kind: z.literal('personal-radar'),
  root: z
    .string()
    .min(1)
    .refine((path) => !isAbsolute(path)),
});

type Selection = Pick<SelectionConfig, 'core' | 'scenarios' | 'activeScenarioId'>;

export class RadarSelection {
  private root: string;
  constructor(binding: string) {
    this.root = resolve(projectRoot, bindingSchema.parse(JSON.parse(binding)).root);
  }

  read() {
    const path = join(
      this.root,
      'knowledge/indexes/records/preference',
      selectionPreferenceId + '.json',
    );
    try {
      const stat = lstatSync(path);
      if (!stat.isFile() || stat.size > 256 * 1024) throw new Error('Недопустимый файл');
      return z
        .object({
          id: z.literal(selectionPreferenceId),
          domain: z.literal('job-search'),
          metadata: z.looseObject({
            selection: z.strictObject({
              core: z.unknown(),
              scenarios: z.array(z.record(z.string(), z.unknown())),
              activeScenarioId: z.string(),
            }),
          }),
        })
        .passthrough()
        .parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch (error) {
      throw new Error('Профиль поиска работы в Personal Radar недоступен или повреждён', {
        cause: error,
      });
    }
  }

  save(
    expectedRecord: ReturnType<RadarSelection['read']>,
    expectedVersion: number,
    selection: Selection,
  ) {
    const fields = {
      metadata: {
        selection: {
          ...selection,
          scenarios: selection.scenarios.map(
            ({ legacyProfileId: _legacy, ...scenario }) => scenario,
          ),
        },
      },
    };
    // The same save can resume an interrupted write through Radar's existing receipt.
    const hash = createHash('sha256')
      .update(JSON.stringify([expectedVersion, expectedRecord, fields]))
      .digest('hex');
    const requestId = [
      hash.slice(0, 8),
      hash.slice(8, 12),
      hash.slice(12, 16),
      hash.slice(16, 20),
      hash.slice(20, 32),
    ].join('-');
    const result = spawnSync(
      join(this.root, '.venv/bin/python'),
      [join(this.root, 'scripts/preference_update.py')],
      {
        input: JSON.stringify({
          root: this.root,
          entity_id: selectionPreferenceId,
          expected_record: expectedRecord,
          fields,
          request_id: requestId,
          user_instruction: 'Сохранить профиль поиска работы из Jobs Checker.',
        }),
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 256 * 1024,
      },
    );
    if (result.status !== 0)
      throw new Error(result.stderr?.trim() || 'Не удалось сохранить профиль в Personal Radar');
  }
}
