# Repository instructions

When this checkout is inside `life-stack`, first read the shared [workspace instructions](../AGENTS.md) if they have not already been loaded. This file supplies project-specific overrides. If the shared file is absent in a standalone clone, continue with this file.

- Communicate with the user in Russian unless they request another language.
- Preserve unrelated changes and never publish, delete, or rewrite data without an explicit request.
- The canonical repository is https://github.com/gavrevnik/Jobs-checker.
- The default branch is `master`.
- The live SQLite database is `../data/jobs-checker/scout.sqlite` in the standard `life-stack` layout. `SCOUT_DB` may override it.
- Never use the live database in tests. Tests must use temporary SQLite databases.
- Keep API keys only in the ignored `.env`; never include them in source, fixtures, logs, or chat output.
- Update `README.md` when setup, storage, providers, or user-visible behavior changes.
- Before handing off code changes, run `npm test`, `npm run build`, and relevant focused verification.
