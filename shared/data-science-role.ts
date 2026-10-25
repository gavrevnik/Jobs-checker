import he from 'he';

// Only source title/description participate: never company reputation, CRM notes or AI scores.
function responsibilities(description: string) {
  const lines = he
    .decode(description.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ''))
    .replace(/<\/(?:p|div|li|h[1-6])>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[’‘]/g, "'")
    .replace(/\b(responsibilities|requirements|qualifications|benefits)\s*:/gi, '\n$1:\n')
    .split(/\n+/)
    .map((line) => line.replace(/^[^\p{L}\p{N}]+/u, '').trim())
    .filter(Boolean);
  const start = lines.findIndex((line) =>
    /^(?:your (?:mission|day.to.day|responsibilities)|responsibilities|what you(?:'ll| will) (?:do|be (?:working on|doing))|in this (?:role|position),? you(?:'ll| will)|about the role|(?:the role'?s )?key responsibilities(?: and tasks)?|you'll play a key role by)[\s:….]*$/i.test(
      line,
    ),
  );
  const body = lines.slice(start < 0 ? 0 : start + 1);
  const end = body.findIndex((line) =>
    /^(?:about you|experience and qualifications|qualifications|requirements|your toolkit|what (?:we(?:'re| are) looking for|you(?:'ll| will) need|you need|we offer)|you(?:'ll| will) thrive in this role if|you should apply if|we'd love to hear from you if|what'?s in it for you|(?:the )?interview process|benefits(?: and perks)?|equal opportunit)/i.test(
      line,
    ),
  );
  return (end < 0 ? body : body.slice(0, end))
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .filter(
      (line) =>
        // General employer advertising and negated duties are not candidate responsibilities.
        !/^(?:we|our company|our platform)\b/i.test(line) &&
        !/\b(?:do|does|will) not\s+(?:\w+\s+){0,2}(?:run|design|analy[sz]e|measure|evaluate)\b|\bno responsibility for\b/i.test(
          line,
        ),
    );
}

export function analyticalDataScientist(job: { title: string; description?: string }) {
  const duties = responsibilities(job.description || '');
  const engineering = duties.some(
    (line) =>
      /\b(?:design|build|develop|deploy|productionali[sz]e|own|operate|maintain|monitor|improve|evolve)\b.{0,180}\b(?:production(?:[-\s]+\w+){0,4} (?:models?|systems?|pipelines?|machine learning)|(?:ml|genai|llm|machine learning|neural|ranking) (?:models?|systems?|pipelines?).{0,100}(?:production|deployment|serving)|mlops|model serving|feature stores?|model registr(?:y|ies)|machine learning infrastructure)\b/i.test(
        line,
      ) ||
      /\b(?:train|fine.tune|implement)\b.{0,100}\b(?:deep learning|neural|llm|large language|two.tower|dcn.v2)\b/i.test(
        line,
      ) ||
      /\b(?:train|fine.tune|deploy|productionali[sz]e)\b.{0,100}\bmodels?\b.{0,80}\b(?:production|serving)\b/i.test(
        line,
      ),
  );
  const dataEngineering = duties.filter((line) =>
    /\b(?:build|develop|design|own|operate|maintain)\b.{0,120}\b(?:etl|elt|data ingestion|data warehouses?|data pipelines?)\b/i.test(
      line,
    ),
  );
  if (engineering || dataEngineering.length >= 2) return false;
  const measurement = duties.some((line) =>
    /\b(?:analy[sz]\w*|investigat\w*|measur\w*|evaluat\w*|quantif\w*|estimat\w*|defin\w*|design\w*|run|develop\w*|execut\w*|establish\w*|set|evolve|own|lead|apply|guide|enable)\b.{0,180}\b(?:a\s*\/\s*b|ab test\w*|experiment\w*|causal\w*|incrementality|synthetic control|difference.in.differences|measurement|metric\w*|retention|conversion|engagement|elasticity|profitability|lifetime value|cohorts?)\b/i.test(
      line,
    ),
  );
  const decisions = duties.some((line) =>
    /\b(?:inform\w*|influenc\w*|guid\w*|shap\w*|steer\w*|support\w*|driv\w*|optimi[sz]\w*|improv\w*|design\w*|build\w*|iterat\w*|partner\w*|work\w*|collaborat\w*|translat\w*|advis\w*|lead\w*)\b.{0,180}\b(?:product|commercial|marketing|pricing|revenue|business|stakeholders?|decision\w*)\b/i.test(
      line,
    ),
  );
  if (dataEngineering.length && !(measurement && decisions)) return false;
  // Explicit analytical titles retain the previous behaviour, even with a short ATS snippet.
  // "Data Products" / "Growth Data Products" are not evidence of product analytics.
  if (
    !/\bdata products?\b/i.test(job.title) &&
    /\b(?:product data scientist|data scientist\b.*\b(?:analytics|insights|decision|product)\b)/i.test(
      job.title,
    )
  )
    return true;
  return measurement && decisions;
}
