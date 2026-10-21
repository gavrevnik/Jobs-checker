import {
  criterionState,
  effectiveVerdict,
  registry,
  scopeKey,
  stale,
  type StoredObservation,
  type InfrastructureValue,
} from './company-research.js';

export type ResearchTag = {
  label: string;
  scope: string;
  observationIds: string[];
  details: string;
  countries: string[];
  assessment?: boolean;
};

export function factScope(o: StoredObservation) {
  return [
    o.scope.country,
    o.scope.city,
    o.scope.role,
    o.scope.level,
    o.scope.job_url ? 'По вакансии' : '',
    o.scope.context && !/^(source:|legacy_|official_|research coverage)/i.test(o.scope.context)
      ? o.scope.context.replace(/^historical_job(?=;|$)/, 'Историческая вакансия')
      : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

export function verifiedResearchFacts(observations: StoredObservation[], now = Date.now()) {
  return observations.filter((o) => {
    const c = registry.criteria.find((c) => c.id === o.criterion_id);
    return (
      c &&
      !o.rejected &&
      o.verifiedAt &&
      o.value !== null &&
      o.confidence !== 'low' &&
      !stale(o, now) &&
      o.evidence.some(
        (e) =>
          c.allowed_sources.includes(e.source_type) &&
          ['official', 'job', 'engineering', 'report', 'conference'].includes(e.source_type),
      )
    );
  });
}
export function currentResearchFacts(observations: StoredObservation[], now = Date.now()) {
  const candidates = verifiedResearchFacts(observations, now);
  // A disputed claim must not become a positive tag; other roles/countries remain independent.
  const groups = new Map<string, StoredObservation[]>();
  for (const o of candidates) {
    const key = o.criterion_id + scopeKey(o.scope);
    groups.set(key, [...(groups.get(key) || []), o]);
  }
  return [...groups.values()].flatMap((group) =>
    criterionState(group[0].criterion_id, group, '', now).verdict === 'conflicting' ? [] : group,
  );
}

export function collectTags() {
  const tags = new Map<
    string,
    { label: string; observations: Map<string, StoredObservation>; bases: Set<string> }
  >();
  return {
    add(label: string, o: StoredObservation, basis?: string) {
      const key = label.trim().toLowerCase();
      const item = tags.get(key) || {
        label: label.trim(),
        observations: new Map(),
        bases: new Set<string>(),
      };
      item.observations.set(o.id, o);
      if (basis) item.bases.add(basis);
      tags.set(key, item);
    },
    values(): ResearchTag[] {
      return [...tags.values()].map(({ label, observations, bases }) => {
        const facts = [...observations.values()];
        return {
          label,
          ...(bases.size ? { assessment: true } : {}),
          countries: [
            ...new Set(facts.map((o) => o.scope.country).filter((v): v is string => !!v)),
          ],
          observationIds: [...observations.keys()],
          scope: [...new Set(facts.map(factScope).filter(Boolean))].join('; '),
          details:
            (bases.size ? 'Оценка анализа\n' + [...bases].join('\n') + '\n\n' : '') +
            facts
              .map((o) =>
                [
                  factScope(o) || 'Компания',
                  o.reasoning,
                  'Проверено ' + o.verifiedAt?.slice(0, 10),
                  ...o.evidence.map((e) => e.url),
                ]
                  .filter(Boolean)
                  .join('\n'),
              )
              .join('\n\n'),
        };
      });
    },
  };
}

// Normalize already researched tags/structured values, never mine raw job text for stack claims.
const infrastructureCatalog: [string, RegExp][] = [
  ['SQL', /\bSQL\b/i],
  ['Python', /\bpython\b/i],
  ['R', /^R$/],
  ['Jupyter', /\bjupyter(?:lab)?\b/i],
  ['Hex', /\bhex\b/i],
  ['Deepnote', /\bdeepnote\b/i],
  ['pandas', /\bpandas\b/i],
  ['NumPy', /\bnumpy\b/i],
  ['SciPy', /\bscipy\b/i],
  ['statsmodels', /\bstatsmodels\b/i],
  ['PostgreSQL', /\bpostgre(?:sql|s)?\b/i],
  ['MySQL', /\bmysql\b/i],
  ['ClickHouse', /\bclickhouse\b/i],
  ['Snowflake', /\bsnowflake\b/i],
  ['BigQuery', /\bbigquery\b/i],
  ['Redshift', /\bredshift\b/i],
  ['Databricks', /\bdatabricks\b/i],
  ['Hadoop', /\bhadoop\b/i],
  ['Spark', /\bspark\b/i],
  ['PySpark', /\bpyspark\b/i],
  ['Trino', /\btrino\b/i],
  ['Presto', /\bpresto\b/i],
  ['DuckDB', /\bduckdb\b/i],
  ['Kafka', /\bkafka\b/i],
  ['Flink', /\bflink\b/i],
  ['Airflow', /\bairflow\b/i],
  ['Dagster', /\bdagster\b/i],
  ['dbt', /\bdbt\b/i],
  ['Fivetran', /\bfivetran\b/i],
  ['Airbyte', /\bairbyte\b/i],
  ['Segment', /\bsegment\b/i],
  ['RudderStack', /\brudderstack\b/i],
  ['Tableau', /\btableau\b/i],
  ['Looker Studio', /\b(?:looker\s*studio|data\s*studio)\b/i],
  ['Looker', /\blooker\b(?!\s*studio)/i],
  ['Power BI', /\bpower\s*bi\b/i],
  ['Metabase', /\bmetabase\b/i],
  ['Superset', /\bsuperset\b/i],
  ['Sigma', /\bsigma\b/i],
  ['Omni', /\bomni\b/i],
  ['Amplitude Experiment', /\bamplitude\s+experiment\b/i],
  ['Amplitude', /\bamplitude\b(?!\s+experiment)/i],
  ['Mixpanel', /\bmixpanel\b/i],
  ['PostHog', /\bposthog\b/i],
  ['GA4', /\b(?:GA4|Google Analytics 4)\b/i],
  ['GrowthBook', /\bgrowthbook\b/i],
  ['Optimizely', /\boptimizely\b/i],
  ['Statsig', /\bstatsig\b/i],
  ['Eppo', /\beppo\b/i],
  ['LaunchDarkly', /\blaunchdarkly\b/i],
  ['DataHub', /\bdatahub\b/i],
  ['Monte Carlo', /\bmonte\s+carlo\b/i],
  ['Great Expectations', /\bgreat expectations\b/i],
  ['OpenMetadata', /\bopenmetadata\b/i],
  ['MLflow', /\bmlflow\b/i],
  ['BQML', /\bbqml\b/i],
  ['DoubleML', /\bdoubleml\b/i],
  ['AWS', /\bAWS\b/i],
  ['GCP', /\bGCP\b/i],
  ['Azure', /\bazure\b/i],
  ['Git', /\bgit\b/i],
  ['Docker', /\bdocker\b/i],
  ['Kubernetes', /\bkubernetes\b/i],
  ['Neo4j', /\bneo4j\b/i],
];
const infrastructurePractices =
  /^(?:Data quality|Data reliability|Data governance|BI governance|Analytics FinOps|Central data platform|Analytics platform|ML platform|BI enablement|Event tracking automation|Tool governance)$/i;
const productOnly =
  /(?:·\s*(?:продукт|Research|R&D)|open[ -]source|public engineering research|AI research|LLM compression|Agentic engineering|AI product analytics|Data Platform team|Investment data)/i;
const culturePractice =
  /a\/b|experiment|causal|interference|incrementality|\bMMM\b|\bLTV\b|\bCAC\b|retention|pricing|metric|метрик|\bKPI\b|ownership|roadmap|self.service|feedback loop|domain analytics|embedded.*analytics|mobile.*analytics|построение аналитики|^LLM$|LLM.assisted|AI.assisted|AI.first|internal AI agents|AI adoption measurement|applied ML|predictive analytics|data products/i;

// Retire audited generic legacy labels; new model-authored statistical methods do not
// need to belong to a fixed vocabulary (e.g. CUPED, Bayesian testing, treatment effects).
const genericLegacyCulture =
  /^(Analytics engineering|Data visualization|Federated learning|Knowledge graph|Model evaluation|Observability tooling|Production ML)$/i;

export function companyResearchTags(observations: StoredObservation[], now = Date.now()) {
  const infrastructure = collectTags(),
    culture = collectTags();
  const omitted = new Set<string>();
  const facts = currentResearchFacts(observations, now);
  for (const o of facts) {
    if (o.criterion_id === 'AN01' && typeof o.value === 'boolean')
      culture.add(
        o.value ? 'Влияние на продуктовые решения' : 'Нет влияния на продуктовые решения',
        o,
      );
    if (o.criterion_id === 'AN04' && typeof o.value === 'boolean')
      culture.add(o.value ? 'A/B platform' : 'Нет A/B-платформы', o);
    if (o.criterion_id === 'AN08' && o.value === true) culture.add('Публикации сотрудников', o);
    if (o.criterion_id === 'AN06' && typeof o.value === 'string') {
      const label = {
        product_data: 'Product/Data analytics',
        bi_de_ml: 'BI / DE / ML focus',
        mixed: 'Mixed analytics role',
      }[o.value];
      if (label) culture.add(label, o);
    }
    if (o.criterion_id === 'T03' && o.value === true) culture.add('LLM-assisted analysis', o);
    if (o.criterion_id === 'T02' && o.value === true) infrastructure.add('Data quality', o);
    if (
      o.criterion_id === 'T08_INFRA' &&
      o.value &&
      typeof o.value === 'object' &&
      'assessments' in o.value
    )
      for (const assessment of (o.value as InfrastructureValue).assessments || [])
        infrastructure.add(assessment.label, o, assessment.basis);
    const structured = ['T01', 'T05', 'T06'].includes(o.criterion_id) && Array.isArray(o.value);
    const signal =
      ['AN09_CULTURE', 'T08_INFRA'].includes(o.criterion_id) &&
      o.value &&
      typeof o.value === 'object' &&
      'tags' in o.value
        ? o.value
        : null;
    const labels = structured ? (o.value as string[]) : signal?.tags || [];
    for (const label of labels) {
      if (o.criterion_id === 'AN09_CULTURE' && productOnly.test(label)) {
        omitted.add(label);
        continue;
      }
      const tech = infrastructureCatalog.filter(([, pattern]) => pattern.test(label));
      for (const [canonical] of tech) infrastructure.add(canonical, o);
      if (infrastructurePractices.test(label)) infrastructure.add(label, o);
      if (
        o.criterion_id === 'AN09_CULTURE' &&
        (culturePractice.test(label) ||
          (!tech.length &&
            !infrastructurePractices.test(label) &&
            !genericLegacyCulture.test(label)))
      ) {
        const name = /growthbook/i.test(label) ? 'A/B platform' : label;
        culture.add(name, o);
      } else if (o.criterion_id === 'T08_INFRA' || structured) {
        if (!tech.length && !infrastructurePractices.test(label)) infrastructure.add(label, o);
      } else if (!tech.length && !infrastructurePractices.test(label)) omitted.add(label);
    }
  }
  return {
    infrastructure: infrastructure.values(),
    culture: culture.values(),
    omitted: [...omitted],
  };
}

export function uncoveredTechnicalFacts(observations: StoredObservation[], now = Date.now()) {
  const tags = companyResearchTags(observations, now);
  const covered = new Set(
    [...tags.infrastructure, ...tags.culture].flatMap((t) => t.observationIds),
  );
  return verifiedResearchFacts(observations, now).filter(
    (o) =>
      ['T01', 'T02', 'T03'].includes(o.criterion_id) &&
      !covered.has(o.id) &&
      ['pass', 'fail'].includes(effectiveVerdict(o, now)),
  );
}

export function uncoveredAnalyticsFacts(observations: StoredObservation[], now = Date.now()) {
  const tags = companyResearchTags(observations, now);
  const covered = new Set(
    [...tags.infrastructure, ...tags.culture].flatMap((t) => t.observationIds),
  );
  return verifiedResearchFacts(observations, now).filter((o) => {
    const criterion = registry.criteria.find((c) => c.id === o.criterion_id)!;
    return (
      criterion.section === 'AN' &&
      criterion.kind === 'scored' &&
      o.applicability !== 'not_applicable' &&
      !covered.has(o.id)
    );
  });
}
