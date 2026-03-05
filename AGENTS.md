# Repository Guidelines

## Project Structure & Module Organization
- App code lives in src/:
  - src/app/ for Next.js routes ([locale] UI routes and api/ handlers).
  - src/lib/ for domain/runtime logic (task queue, workers, billing, run-runtime).
  - src/components/ for reusable UI.
  - src/features/video-editor/ for editor-specific modules.
- Data and schema:
  - prisma/schema.prisma for DB models.
  - data/ for local file storage.
- Tests are in tests/unit, tests/integration, and tests/concurrency.
- Docs and incident/design records are under docs/.

## Build, Test, and Development Commands
- npm run dev: start Next.js + workers + watchdog + bull-board concurrently.
- npm run build: generate Prisma client and build production bundle.
- npm run start: run production server and worker processes.
- npm run lint: run ESLint.
- npm run test:unit:all: run all unit tests with Vitest.
- npm run test:integration:api: run API integration tests.
- npm run test:behavior:full: run behavior guards + unit/api/chain behavior suites.
- Docker local stack: docker compose up -d.

## Coding Style & Naming Conventions
- Language: TypeScript (strict typing expected). Avoid any unless truly unavoidable.
- Indentation: 2 spaces; keep functions focused and small.
- Naming:
  - React components: PascalCase (example: NovelPromotionWorkspace.tsx).
  - Hooks and utilities: camelCase (example: useWorkspaceProjectSnapshot.ts).
  - Route folders and scripts: kebab-case where applicable.
- Use existing lint rules in .eslintrc.json and eslint.config.mjs before submitting.

## Testing Guidelines
- Framework: Vitest.
- Add or adjust tests for every behavior change, especially workers, task routes, and runtime event mapping.
- Prefer precise assertions on payload/state transitions, not only call-count assertions.
- Keep test scope aligned with change type: unit for logic, integration for route/DB/queue contracts.

## Commit & Pull Request Guidelines
- History favors conventional prefixes: fix(...), feat, docs, chore, release.
- Recommended format: type(scope): concise summary.
- PRs should include:
  - problem statement and root cause,
  - summary of changes,
  - test evidence (commands + results),
  - screenshots/video for UI-impacting changes,
  - linked issue/incidents when relevant.

## Security & Configuration Tips
- Never commit secrets. Use .env and .env.example as templates.
- Treat INTERNAL_TASK_TOKEN, API keys, and DB credentials as sensitive.
- Validate model/provider config with existing guard scripts before release.
