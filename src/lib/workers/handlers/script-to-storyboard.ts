import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { resolveProjectModelCapabilityGenerationOptions } from '@/lib/config-service'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { logAIAnalysis } from '@/lib/logging/semantic'
import { onProjectNameAvailable } from '@/lib/logging/file-writer'
import { buildCharactersIntroduction } from '@/lib/constants'
import { TaskTerminatedError } from '@/lib/task/errors'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { executePipelineGraph, type GraphExecutorState } from '@/lib/run-runtime/graph-executor'
import {
  runScriptToStoryboardOrchestrator,
  JsonParseError,
  type ScriptToStoryboardStepMeta,
  type ScriptToStoryboardStepOutput,
  type ScriptToStoryboardOrchestratorResult,
} from '@/lib/novel-promotion/script-to-storyboard/orchestrator'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import {
  asJsonRecord,
  buildStoryboardJson,
  parseEffort,
  parseTemperature,
  parseVoiceLinesJson,
  persistStoryboardsAndPanels,
  toPositiveInt,
  type JsonRecord,
} from './script-to-storyboard-helpers'
import { buildPrompt, getPromptTemplate, PROMPT_IDS } from '@/lib/prompt-i18n'
import { resolveAnalysisModel } from './resolve-analysis-model'
import { parseSeedancePanels, validateSeedanceOutput } from '@/lib/seedance'

type AnyObj = Record<string, unknown>
const MAX_VOICE_ANALYZE_ATTEMPTS = 2

function isReasoningEffort(value: unknown): value is 'minimal' | 'low' | 'medium' | 'high' {
  return value === 'minimal' || value === 'low' || value === 'medium' || value === 'high'
}

export async function handleScriptToStoryboardTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as AnyObj
  const projectId = job.data.projectId
  const episodeIdRaw = typeof payload.episodeId === 'string' ? payload.episodeId : (job.data.episodeId || '')
  const episodeId = episodeIdRaw.trim()
  const inputModel = typeof payload.model === 'string' ? payload.model.trim() : ''
  const reasoning = payload.reasoning === true
  const requestedReasoningEffort = parseEffort(payload.reasoningEffort)
  const temperature = parseTemperature(payload.temperature)

  if (!episodeId) {
    throw new Error('episodeId is required')
  }

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      name: true,
      mode: true,
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }
  if (project.mode !== 'novel-promotion') {
    throw new Error('Not a novel promotion project')
  }

  // Register project name for per-project log file routing
  onProjectNameAvailable(projectId, project.name)

  const novelData = await prisma.novelPromotionProject.findUnique({
    where: { projectId },
    include: {
      characters: true,
      locations: true,
    },
  })
  if (!novelData) {
    throw new Error('Novel promotion data not found')
  }

  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      clips: { orderBy: { createdAt: 'asc' } },
    },
  })
  if (!episode || episode.novelPromotionProjectId !== novelData.id) {
    throw new Error('Episode not found')
  }
  const clips = episode.clips || []
  if (clips.length === 0) {
    throw new Error('No clips found')
  }

  const model = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel,
    projectAnalysisModel: novelData.analysisModel,
  })
  const llmCapabilityOptions = await resolveProjectModelCapabilityGenerationOptions({
    projectId,
    userId: job.data.userId,
    modelType: 'llm',
    modelKey: model,
  })
  const capabilityReasoningEffort = llmCapabilityOptions.reasoningEffort
  const reasoningEffort = requestedReasoningEffort
    || (isReasoningEffort(capabilityReasoningEffort) ? capabilityReasoningEffort : 'medium')

  await reportTaskProgress(job, 10, {
    stage: 'script_to_storyboard_prepare',
    stageLabel: 'progress.stage.scriptToStoryboardPrepare',
    displayMode: 'detail',
  })

  // ── Seedance 模板分流（含降级安全） ──
  const workflowMode = (novelData.workflowMode || 'srt') as string
  let isSeedance = workflowMode === 'seedance'

  let phase1PlanTemplate: string
  let phase2CinematographyTemplate: string
  let phase3DetailTemplate: string
  const phase2ActingTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_ACTING_DIRECTION, job.data.locale)

  if (isSeedance) {
    try {
      phase1PlanTemplate = getPromptTemplate(PROMPT_IDS.NP_SEEDANCE_STORYBOARD_PLAN, job.data.locale)
      phase2CinematographyTemplate = getPromptTemplate(PROMPT_IDS.NP_SEEDANCE_CINEMATOGRAPHER, job.data.locale)
      phase3DetailTemplate = getPromptTemplate(PROMPT_IDS.NP_SEEDANCE_DETAIL, job.data.locale)
    } catch (err) {
      // 静默降级：seedance 模板加载失败 → 退回默认模板
      logAIAnalysis(job.data.userId, 'worker', projectId, project.name, {
        action: 'SEEDANCE_TEMPLATE_FALLBACK',
        error: { message: err instanceof Error ? err.message : String(err) },
      })
      isSeedance = false
      phase1PlanTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_PLAN, job.data.locale)
      phase2CinematographyTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_CINEMATOGRAPHER, job.data.locale)
      phase3DetailTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL, job.data.locale)
    }
  } else {
    phase1PlanTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_PLAN, job.data.locale)
    phase2CinematographyTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_CINEMATOGRAPHER, job.data.locale)
    phase3DetailTemplate = getPromptTemplate(PROMPT_IDS.NP_AGENT_STORYBOARD_DETAIL, job.data.locale)
  }

  const streamContext = createWorkerLLMStreamContext(job, 'script_to_storyboard')
  const callbacks = createWorkerLLMStreamCallbacks(job, streamContext)

  const runStep = async (
    meta: ScriptToStoryboardStepMeta,
    prompt: string,
    action: string,
    _maxOutputTokens: number,
  ): Promise<ScriptToStoryboardStepOutput> => {
    void _maxOutputTokens
    await assertTaskActive(job, `script_to_storyboard_step:${meta.stepId}`)
    const progress = 15 + Math.min(70, Math.floor((meta.stepIndex / Math.max(1, meta.stepTotal)) * 70))
    await reportTaskProgress(job, progress, {
      stage: 'script_to_storyboard_step',
      stageLabel: 'progress.stage.scriptToStoryboardStep',
      displayMode: 'detail',
      message: meta.stepTitle,
      stepId: meta.stepId,
      stepAttempt: meta.stepAttempt || 1,
      stepTitle: meta.stepTitle,
      stepIndex: meta.stepIndex,
      stepTotal: meta.stepTotal,
    })

    // Log prompt input
    logAIAnalysis(job.data.userId, 'worker', projectId, project.name, {
      action: `SCRIPT_TO_STORYBOARD_PROMPT:${action}`,
      input: { stepId: meta.stepId, stepTitle: meta.stepTitle, prompt },
      model,
    })

    const disableReasoningForStoryboardPhase = /^storyboard_phase[123]_/.test(action)
    const stepReasoning = disableReasoningForStoryboardPhase ? false : reasoning
    const stepReasoningEffort = disableReasoningForStoryboardPhase ? 'minimal' : reasoningEffort

    const output = await executeAiTextStep({
      userId: job.data.userId,
      model,
      messages: [{ role: 'user', content: prompt }],
      projectId,
      action,
      meta,
      temperature,
      reasoning: stepReasoning,
      reasoningEffort: stepReasoningEffort,
    })

    // Log AI response output (full raw text included for JSON parse debugging)
    logAIAnalysis(job.data.userId, 'worker', projectId, project.name, {
      action: `SCRIPT_TO_STORYBOARD_OUTPUT:${action}`,
      output: {
        stepId: meta.stepId,
        stepTitle: meta.stepTitle,
        rawText: output.text,
        textLength: output.text.length,
        reasoningLength: output.reasoning.length,
      },
      model,
    })

    return {
      text: output.text,
      reasoning: output.reasoning,
    }
  }

  const payloadMeta = typeof payload.meta === 'object' && payload.meta !== null
    ? (payload.meta as AnyObj)
    : {}
  const runId = typeof payload.runId === 'string' && payload.runId.trim()
    ? payload.runId.trim()
    : (typeof payloadMeta.runId === 'string' ? payloadMeta.runId.trim() : '')
  if (!runId) {
    throw new Error('runId is required for script_to_storyboard pipeline')
  }

  type ScriptToStoryboardGraphState = GraphExecutorState & {
    orchestratorResult: ScriptToStoryboardOrchestratorResult | null
  }
  const initialState: ScriptToStoryboardGraphState = {
    refs: {},
    meta: {},
    orchestratorResult: null,
  }

  const pipelineState = await (async () => {
    try {
      return await withInternalLLMStreamCallbacks(
        callbacks,
        async () =>
          await executePipelineGraph({
            runId,
            projectId,
            userId: job.data.userId,
            state: initialState,
            nodes: [
              {
                key: 'script_to_storyboard_orchestrator',
                title: 'script_to_storyboard_orchestrator',
                maxAttempts: 2,
                timeoutMs: 1000 * 60 * 20,
                run: async (context) => {
                  const nextResult = await runScriptToStoryboardOrchestrator({
                    clips: clips.map((clip) => ({
                      id: clip.id,
                      content: clip.content,
                      characters: clip.characters,
                      location: clip.location,
                      screenplay: clip.screenplay,
                    })),
                    novelPromotionData: {
                      characters: novelData.characters || [],
                      locations: novelData.locations || [],
                    },
                    promptTemplates: {
                      phase1PlanTemplate,
                      phase2CinematographyTemplate,
                      phase2ActingTemplate,
                      phase3DetailTemplate,
                    },
                    runStep,
                  })

                  context.state.orchestratorResult = nextResult
                  return {
                    output: {
                      clipCount: nextResult.summary.clipCount,
                      totalPanelCount: nextResult.summary.totalPanelCount,
                    },
                  }
                },
              },
            ],
          }),
      )
    } catch (err) {
      if (err instanceof JsonParseError) {
        logAIAnalysis(job.data.userId, 'worker', projectId, project.name, {
          action: 'SCRIPT_TO_STORYBOARD_PARSE_ERROR',
          error: {
            message: err.message,
            rawTextPreview: err.rawText.slice(0, 3000),
            rawTextLength: err.rawText.length,
          },
          model,
        })
      }
      throw err
    } finally {
      await callbacks.flush()
    }
  })()

  const orchestratorResult = pipelineState.orchestratorResult
  if (!orchestratorResult) {
    throw new Error('script_to_storyboard orchestrator produced no result')
  }

  await reportTaskProgress(job, 80, {
    stage: 'script_to_storyboard_persist',
    stageLabel: 'progress.stage.scriptToStoryboardPersist',
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'script_to_storyboard_persist')

  const persistedStoryboards = await persistStoryboardsAndPanels({
    episodeId,
    clipPanels: orchestratorResult.clipPanels,
    workflowMode,
  })

  // ── Seedance 后置校验 ──
  if (isSeedance) {
    const allPanels = orchestratorResult.clipPanels.flatMap(cp => cp.finalPanels)
    const seedanceExtensions = parseSeedancePanels(allPanels as Record<string, unknown>[])
    const totalContentLength = clips.reduce(
      (sum, clip) => sum + (typeof clip.content === 'string' ? clip.content.length : 0), 0,
    )
    const panelsForValidation = allPanels.map((p, i) => ({
      panel_number: p.panel_number || i + 1,
      pace: seedanceExtensions[i]?.pace,
      expected_duration: seedanceExtensions[i]?.expected_duration,
    }))
    const warnings = validateSeedanceOutput(panelsForValidation, seedanceExtensions, totalContentLength)

    logAIAnalysis(job.data.userId, 'worker', projectId, project.name, {
      action: 'SEEDANCE_GENERATION_SUMMARY',
      input: { workflowMode, clipCount: clips.length },
      output: {
        totalPanels: allPanels.length,
        fieldsPopulated: {
          expectedDuration: seedanceExtensions.filter(e => e.expected_duration != null).length,
          shotRelation: seedanceExtensions.filter(e => e.shot_relation != null).length,
          pace: seedanceExtensions.filter(e => e.pace != null).length,
          characterLabels: seedanceExtensions.filter(e => (e.character_labels?.length ?? 0) > 0).length,
        },
        validationWarnings: warnings,
      },
    })
  }

  if (!episode.novelText || !episode.novelText.trim()) {
    throw new Error('No novel text to analyze')
  }

  const voicePrompt = buildPrompt({
    promptId: PROMPT_IDS.NP_VOICE_ANALYSIS,
    locale: job.data.locale,
    variables: {
      input: episode.novelText,
      characters_lib_name: (novelData.characters || []).length > 0
        ? (novelData.characters || []).map((item) => item.name).join('、')
        : '无',
      characters_introduction: buildCharactersIntroduction(novelData.characters || []),
      storyboard_json: buildStoryboardJson(persistedStoryboards),
    },
  })

  let voiceLineRows: JsonRecord[] | null = null
  let voiceLastError: Error | null = null
  const voiceStepMeta: ScriptToStoryboardStepMeta = {
    stepId: 'voice_analyze',
    stepTitle: 'progress.streamStep.voiceAnalyze',
    stepIndex: orchestratorResult.summary.totalStepCount,
    stepTotal: orchestratorResult.summary.totalStepCount,
  }
  try {
    for (let voiceAttempt = 1; voiceAttempt <= MAX_VOICE_ANALYZE_ATTEMPTS; voiceAttempt++) {
      const meta: ScriptToStoryboardStepMeta = {
        ...voiceStepMeta,
        stepAttempt: voiceAttempt,
      }
      try {
        const voiceOutput = await withInternalLLMStreamCallbacks(
          callbacks,
          async () => await runStep(meta, voicePrompt, 'voice_analyze', 2600),
        )
        voiceLineRows = parseVoiceLinesJson(voiceOutput.text)
        break
      } catch (error) {
        if (error instanceof TaskTerminatedError) {
          throw error
        }
        voiceLastError = error instanceof Error ? error : new Error(String(error))
        if (voiceAttempt < MAX_VOICE_ANALYZE_ATTEMPTS) {
          await reportTaskProgress(job, 84, {
            stage: 'script_to_storyboard_step',
            stageLabel: 'progress.stage.scriptToStoryboardStep',
            displayMode: 'detail',
            message: `台词分析失败，准备重试 (${voiceAttempt + 1}/${MAX_VOICE_ANALYZE_ATTEMPTS})`,
            stepId: voiceStepMeta.stepId,
            stepAttempt: voiceAttempt + 1,
            stepTitle: voiceStepMeta.stepTitle,
            stepIndex: voiceStepMeta.stepIndex,
            stepTotal: voiceStepMeta.stepTotal,
          })
        }
      }
    }
  } finally {
    await callbacks.flush()
  }
  if (!voiceLineRows) {
    throw voiceLastError!
  }

  await assertTaskActive(job, 'script_to_storyboard_voice_persist')
  const panelIdByStoryboardPanel = new Map<string, string>()
  for (const storyboard of persistedStoryboards) {
    for (const panel of storyboard.panels) {
      panelIdByStoryboardPanel.set(`${storyboard.storyboardId}:${panel.panelIndex}`, panel.id)
    }
  }

  const createdVoiceLines = await prisma.$transaction(async (tx) => {
    await tx.novelPromotionVoiceLine.deleteMany({ where: { episodeId } })
    const created: Array<{ id: string }> = []
    for (let i = 0; i < voiceLineRows.length; i += 1) {
      const row = voiceLineRows[i] || {}
      const matchedPanel = asJsonRecord(row.matchedPanel)
      const matchedStoryboardId =
        matchedPanel && typeof matchedPanel.storyboardId === 'string'
          ? matchedPanel.storyboardId.trim()
          : null
      const matchedPanelIndex = matchedPanel ? toPositiveInt(matchedPanel.panelIndex) : null
      let matchedPanelId: string | null = null
      if (matchedPanel !== null) {
        if (!matchedStoryboardId || matchedPanelIndex === null) {
          throw new Error(`voice line ${i + 1} has invalid matchedPanel reference`)
        }
        const panelKey = `${matchedStoryboardId}:${matchedPanelIndex}`
        const resolvedPanelId = panelIdByStoryboardPanel.get(panelKey)
        if (!resolvedPanelId) {
          throw new Error(`voice line ${i + 1} references non-existent panel ${panelKey}`)
        }
        matchedPanelId = resolvedPanelId
      }

      if (typeof row.emotionStrength !== 'number' || !Number.isFinite(row.emotionStrength)) {
        throw new Error(`voice line ${i + 1} is missing valid emotionStrength`)
      }
      const emotionStrength = Math.min(1, Math.max(0.1, row.emotionStrength))

      if (typeof row.lineIndex !== 'number' || !Number.isFinite(row.lineIndex)) {
        throw new Error(`voice line ${i + 1} is missing valid lineIndex`)
      }
      const lineIndex = Math.floor(row.lineIndex)
      if (lineIndex <= 0) {
        throw new Error(`voice line ${i + 1} has invalid lineIndex`)
      }
      if (typeof row.speaker !== 'string' || !row.speaker.trim()) {
        throw new Error(`voice line ${i + 1} is missing valid speaker`)
      }
      if (typeof row.content !== 'string' || !row.content.trim()) {
        throw new Error(`voice line ${i + 1} is missing valid content`)
      }

      const createdRow = await tx.novelPromotionVoiceLine.create({
        data: {
          episodeId,
          lineIndex,
          speaker: row.speaker.trim(),
          content: row.content,
          emotionStrength,
          matchedPanelId,
          matchedStoryboardId: matchedPanelId ? matchedStoryboardId : null,
          matchedPanelIndex,
        },
        select: { id: true },
      })
      created.push(createdRow)
    }
    return created
  }, { timeout: 15000 })

  await reportTaskProgress(job, 96, {
    stage: 'script_to_storyboard_persist_done',
    stageLabel: 'progress.stage.scriptToStoryboardPersistDone',
    displayMode: 'detail',
  })

  return {
    episodeId,
    storyboardCount: persistedStoryboards.length,
    panelCount: orchestratorResult.summary.totalPanelCount,
    voiceLineCount: createdVoiceLines.length,
  }
}
