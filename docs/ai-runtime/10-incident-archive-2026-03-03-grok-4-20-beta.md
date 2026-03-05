# 10 Incident Archive (2026-03-03) - grok-4.20-beta

## Scope

This archive records a local incident check for script_to_storyboard_run after switching to grok-4.20-beta.

- Project: 058153fc-75b9-4b9d-b982-c6a674522c8c
- Episode: d188b48a-8949-41bf-a1f7-268ad364c4ac
- Task: 3ad8a93e-2ad2-486f-aa0b-ed0fa57a64e4
- Run: a6c7bcb3-3447-4be9-bb39-58a1ed37cba1

## Constraint

Only local repository documentation was updated.
No container rebuild/restart was executed in this archive step.

## Confirmed request payload

From task_events.task.created payload:

- model = openai-compatible:2114f631-063c-4f7c-bd53-91711d3b564a::grok-4.20-beta
- reasoning = false
- reasoningEffort = minimal

This confirms the user-side model/parameter change was accepted by backend task submission.

## Timeline (UTC+8)

- 2026-03-03 00:02:59: Task created, enqueued, worker started.
- 2026-03-03 00:04:02: LLM_EMPTY_RESPONSE in storyboard_phase1_plan (attempt 1).
- 2026-03-03 00:06:00: LLM_STREAM_TIMEOUT: No stream chunk received within 180s in storyboard_phase1_plan (another clip, attempt 1).
- 2026-03-03 00:06:01+: Orchestrator retry started (stepAttempt=2).

## Observation

Switching to grok-4.20-beta and lowering reasoning settings reduced risk factors,
but the flow still reproduced upstream streaming instability symptoms:

- empty stream completion (LLM_EMPTY_RESPONSE)
- per-chunk stream timeout (LLM_STREAM_TIMEOUT)

## Operational guidance (without container update)

1. If a run is stuck or repeatedly retrying, cancel by run ID first.
2. Re-submit only after previous run reaches terminal state.
3. Keep reasoning=false and reasoningEffort=minimal for this flow.
4. For unstable windows, reduce input size (smaller episode/chunk) to lower first-token latency.

## Deferred code-level mitigations (not applied in this archive)

- Add step-specific timeout override for heavy steps.
- Add model fallback chain when empty stream is detected repeatedly.
- Add stronger first-token watchdog diagnostics per provider/model.

## Follow-up archive

- See also: docs/ai-runtime/11-incident-archive-2026-03-03-upstream-403-misclassified-as-forbidden.md
