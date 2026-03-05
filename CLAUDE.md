# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

waoowaoo is an AI-powered short drama / comic video production tool. Core pipeline: **Novel text → Script analysis → Character & scene generation → Storyboard → Video synthesis**. Built with Next.js 15 + React 19, MySQL + Prisma, Redis + BullMQ, Remotion for video compositing.

## Build & Run Commands

```bash
# Development (starts Next.js + worker + watchdog + bull-board concurrently)
npm run dev

# Build
npm run build          # prisma generate + next build

# Lint
npm run lint

# Docker (full stack: MySQL + Redis + App)
docker compose up -d
```

## Test Commands

```bash
# Single test file
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/worker/xxx.test.ts

# Worker handler tests
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/worker

# API route tests
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/integration/api

# Helper / utility tests
BILLING_TEST_BOOTSTRAP=0 npx vitest run tests/unit/helpers

# Billing tests (needs bootstrap)
BILLING_TEST_BOOTSTRAP=1 npx vitest run tests/unit/billing tests/integration/billing

# Full regression (guards + unit + integration + chain)
npm run test:regression

# PR pre-submit (with diagnostics on failure)
npm run test:pr

# Guard scripts (architectural enforcement)
npm run test:guards
npm run check:config-center-guards
npm run check:test-coverage-guards
```

**Note**: `BILLING_TEST_BOOTSTRAP=0` skips DB/Redis setup for pure unit tests. Use `=1` for integration/billing tests.

## Architecture

### Runtime Model: 4 Concurrent Processes

`npm run start` / `npm run dev` launches 4 processes via `concurrently`:
1. **Next.js server** (`start:next`) — pages + API routes on port 3000
2. **BullMQ workers** (`start:worker`) — image/video/voice/text queue consumers (`src/lib/workers/index.ts`)
3. **Watchdog** (`start:watchdog`) — monitors stuck tasks, heartbeat timeouts (`scripts/watchdog.ts`)
4. **Bull Board** (`start:board`) — admin queue dashboard on port 3010 (`scripts/bull-board.ts`)

### Core Business Pipeline (`src/lib/novel-promotion/`)

The novel-to-video pipeline flows through stages:
1. **story-to-script** — Novel text → structured screenplay (characters, locations, dialogue)
2. **script-to-storyboard** — Screenplay → visual storyboard panels with shot descriptions
3. **run-stream** — Orchestrates the full pipeline execution via SSE streaming

### Worker Queue System (`src/lib/workers/`)

4 BullMQ queues with ~45 handlers in `handlers/`:
- **image** — character portraits, location scenes, storyboard panels, asset generation
- **video** — video generation from storyboard shots
- **voice** — voice analysis, voice design, TTS synthesis
- **text** — LLM tasks (script analysis, novel parsing, prompt generation)

Worker handlers follow the pattern: receive job → call AI provider → write results to DB via Prisma.

### AI Provider Layer

- **LLM**: `src/lib/llm/providers/` — ark (ByteDance Volcano), google, openai-compat
- **Image generation**: `src/lib/generators/image/` — google, gemini-compatible, openai-compatible
- **Video generation**: `src/lib/generators/video/` — google, openai-compatible
- **Audio/TTS**: `src/lib/generators/audio/` — qwen (Alibaba)
- **AI runtime**: `src/lib/ai-runtime/` — unified model dispatch with capability catalog (`standards/capabilities/`) and pricing catalog (`standards/pricing/`)

### API Routes (`src/app/api/`)

Next.js route handlers. Key modules: `tasks/` (task CRUD + submission), `runs/` (pipeline execution), `sse/` (real-time streaming), `projects/` (project management), `asset-hub/` (reusable assets), `task-target-states/` (optimistic UI state).

### Data Model (Prisma)

Core entity chain: **Project → Episode → Storyboard → Shot → Clip**
Supporting entities: **Character** (with multiple `CharacterAppearance`s), **Location** (with multiple `LocationImage`s), **VoiceLine**, **VideoEditorProject**
Infrastructure: **MediaObject** (unified media reference, local or COS storage), **Billing** (ledger, freeze/unfreeze)

### i18n

`next-intl` with locale prefix (`/zh/...`, `/en/...`). Translation files in `messages/{zh,en}/` (~30 modules). AI-generated content also respects locale via `prompt-i18n` system (`src/lib/prompt-i18n/`).

### Logging

Structured logging via `src/lib/logging/` — not `console.log`. Use `logInfo`, `logError`, `logWarn` from `@/lib/logging/core`. JSON format with automatic sensitive field redaction.

## Critical Constraints (from AGENTS.md)

1. **No `any` type** — all types must be explicit
2. **Explicit failure, zero implicit fallback** — never silently swallow errors, auto-switch models, or provide defaults for missing data
3. **No fake data** — never generate placeholder/dummy data to mask failures
4. **Behavior-level test assertions** — assert on specific DB field values, function arguments, return values. `toHaveBeenCalled()` alone is insufficient
5. **No self-answering tests** — mock returns X then asserts X without business logic in between is forbidden
6. **Bug fixes require regression tests** — `it()` name must describe the bug scenario
7. **File size discipline** — files mixing UI, state, data fetching, and transform logic must be split by responsibility

## Guard Scripts

Architectural invariants enforced via `scripts/guards/`:
- `no-api-direct-llm-call` — API routes must not call LLM directly (use worker queue)
- `no-model-key-downgrade` — prevent model config degradation
- `no-provider-guessing` — provider must be explicitly configured
- `no-hardcoded-model-capabilities` — use capability catalog
- `file-line-count-guard` — enforce file size limits
- `no-duplicate-endpoint-entry` — prevent duplicate API route registration
- `test-*-coverage-guard` — ensure test coverage for routes and task types

Run all guards: `npm run test:guards`

## Path Alias

`@/` maps to `src/` (configured in tsconfig.json and vitest.config.ts).

## Storage

Configurable via `STORAGE_TYPE` env: `local` (filesystem under `data/uploads/`) or `cos` (Tencent Cloud COS). Media references go through `MediaObject` model.
