# 09 Hotfix Archive (2026-03-02)

## Scope

This archive records a Docker-side hotfix for openai-compatible runtime failures:

- `LLM_EMPTY_RESPONSE` on text tasks (`story_to_script`, `split_clips`)
- `403 Your request was blocked` on vision tasks (`asset_hub_reference_to_character`)

## Why this archive is needed

Container-local edits are ephemeral. After `docker pull` or image refresh,
manual fixes inside running containers are lost unless changes are tracked in
repo files and replayable patches are kept.

## Root cause summary

1. Some upstream requests returned an empty stream (`finishReason=stop`) with
   no text chunks.
2. Error normalization did not explicitly classify `LLM_EMPTY_RESPONSE`, which
   could cause non-retryable handling in upper layers.
3. openai-compatible requests without browser-like `User-Agent` were more
   likely to be blocked by gateway or edge protection.

## Code changes in this hotfix

- `src/lib/llm/chat-stream.ts`
  - Added browser-like `User-Agent` for both AI SDK client and OpenAI client.
- `src/lib/llm/vision.ts`
  - Added browser-like `User-Agent` in vision OpenAI client.
- `src/lib/ai-runtime/errors.ts`
  - Added `llm_empty_response` keyword recognition for empty response mapping.
- `src/lib/errors/normalize.ts`
  - Added empty-response keyword mapping to `GENERATION_FAILED`.

## Replay patch

Patch file:

- `docs/ai-runtime/patches/2026-03-02-openai-compatible-empty-response-hotfix.patch`

Apply on a refreshed environment:

```bash
cd /root/waoowaoo
git apply docs/ai-runtime/patches/2026-03-02-openai-compatible-empty-response-hotfix.patch
```

Then rebuild and restart app:

```bash
docker compose build app
docker compose up -d app
```

## Verification checklist

1. `docker compose ps app` shows `Up`.
2. Re-run affected text task and confirm no immediate `LLM_EMPTY_RESPONSE`.
3. Re-run affected vision task and confirm no immediate `403 blocked`.
4. Check `app` logs for absence of:
   - `llm.stream.empty_response`
   - `Your request was blocked`
## Follow-up archive

- See also: docs/ai-runtime/10-incident-archive-2026-03-03-grok-4-20-beta.md
