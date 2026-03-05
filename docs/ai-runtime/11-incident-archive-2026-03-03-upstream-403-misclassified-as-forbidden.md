# 11 Incident Archive (2026-03-03) - upstream 403 misclassified as FORBIDDEN

## Scope

This archive records a local hotfix for image generation failures that were shown in UI as no permission.

Project and queue context:

- Project: 058153fc-75b9-4b9d-b982-c6a674522c8c
- Queue: waoowaoo-image
- Task type: image_panel
- Model: openai-compatible:2114f631-063c-4f7c-bd53-91711d3b564a::grok-imagine-1.0-edit

## Constraint

Only local repository code and docs were updated in this archive step.
No docker pull, no image rebuild, and no container restart were executed.

## Symptom

UI message reported no permission.

Worker logs in the same window showed:

- 500 Upstream 429: Too many requests
- 500 upload failed: 403 with Just a moment challenge page

## Root cause

This is not a local account or project authorization issue.
It is an error normalization misclassification.

1. Upstream image service returned blocked challenge 403 or rate-limit 429.
2. Normalization logic mapped part of upstream 403 to FORBIDDEN.
3. Frontend rendered FORBIDDEN with a local permission denied copy.

As a result, upstream blocking looked like local permission denial.

## Evidence summary

1. In the same time window, regenerate-panel-image user.operation entries were mostly status 200.
2. Failures were concentrated in worker logs and matched 429 and challenge 403 patterns.
3. Stack traces were in upstream image generation path, not in project authorization path.

## Modified locations

1. src/lib/errors/normalize.ts
   - Added helper function isUpstreamBlocked403(message)
   - Detects just a moment, cloudflare, your request was blocked, html, upstream patterns

2. src/lib/errors/normalize.ts
   - Added split logic in status=403 branch:
     - upstream block pattern -> EXTERNAL_ERROR
     - normal permission denied -> FORBIDDEN

3. tests/unit/task/normalize-error.test.ts
   - Added three test cases:
     - challenge html 403 -> EXTERNAL_ERROR
     - your request was blocked -> EXTERNAL_ERROR
     - permission denied -> FORBIDDEN

## Fix replay

Replay patch file:

- docs/ai-runtime/patches/2026-03-03-upstream-403-misclassification-hotfix.patch

Apply on refreshed environment:

    cd /root/waoowaoo
    git apply docs/ai-runtime/patches/2026-03-03-upstream-403-misclassification-hotfix.patch

Then rebuild and restart app service:

    docker compose build app
    docker compose up -d app

## Verification checklist

1. Trigger regenerate-panel-image again.
2. If upstream challenge 403 appears, it should no longer be displayed as FORBIDDEN.
3. This class of error should map to EXTERNAL_ERROR or provider-side error.
4. Real local permission failures must still map to FORBIDDEN.

## Operations guidance without container update

1. Reduce concurrent image regeneration submissions.
2. Retry in smaller batches with short cooldown.
3. Monitor 429 and challenge 403 signatures in worker logs.
