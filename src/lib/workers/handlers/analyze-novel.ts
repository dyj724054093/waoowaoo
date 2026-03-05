import type { Job } from 'bullmq'
import { prisma } from '@/lib/prisma'
import { executeAiTextStep } from '@/lib/ai-runtime'
import { withInternalLLMStreamCallbacks } from '@/lib/llm-observe/internal-stream-context'
import { getArtStylePrompt, removeLocationPromptSuffix } from '@/lib/constants'
import { reportTaskProgress } from '@/lib/workers/shared'
import { assertTaskActive } from '@/lib/workers/utils'
import { createWorkerLLMStreamCallbacks, createWorkerLLMStreamContext } from './llm-stream'
import type { TaskJobData } from '@/lib/task/types'
import { buildPrompt, PROMPT_IDS } from '@/lib/prompt-i18n'
import { resolveAnalysisModel } from './resolve-analysis-model'

const ZH_NONE = '\u65e0'
const ERR_MISSING_CONTENT = '\u8bf7\u5148\u586b\u5199\u5168\u5c40\u8d44\u4ea7\u8bbe\u5b9a\u6216\u5267\u672c\u5185\u5bb9'
const STAGE_LABEL_PREPARE = '\u51c6\u5907\u8d44\u4ea7\u5206\u6790\u53c2\u6570'
const STAGE_LABEL_CHARACTER_DONE = '\u89d2\u8272\u5206\u6790\u5b8c\u6210'
const STAGE_LABEL_LOCATION_DONE = '\u573a\u666f\u5206\u6790\u5b8c\u6210'
const STAGE_LABEL_LOCATION_RECALL_DONE = '\u573a\u666f\u53ec\u56de\u8865\u5168\u5b8c\u6210'
const STAGE_LABEL_PERSIST = '\u4fdd\u5b58\u8d44\u4ea7\u5206\u6790\u7ed3\u679c'
const STAGE_LABEL_DONE = '\u8d44\u4ea7\u5206\u6790\u5df2\u5b8c\u6210'
const STEP_TITLE_CHARACTER = '\u89d2\u8272\u5206\u6790'
const STEP_TITLE_LOCATION = '\u573a\u666f\u5206\u6790'
const STEP_TITLE_LOCATION_RECALL = '\u573a\u666f\u53ec\u56de\u8865\u5168'
const CHANGE_REASON_DEFAULT = '\u521d\u59cb\u5f62\u8c61'
const LOCATION_INVALID_KEYWORDS = [
  '\u5e7b\u60f3',
  '\u62bd\u8c61',
  '\u65e0\u660e\u786e',
  '\u7a7a\u95f4\u951a\u70b9',
  '\u672a\u8bf4\u660e',
  '\u4e0d\u660e\u786e',
]
const ANALYZE_TEXT_STEP_MAX_ATTEMPTS = 3
const ANALYZE_TEXT_STEP_RETRY_DELAY_MS = 1500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryableAnalyzeError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const maybeRetryable = (error as { retryable?: unknown }).retryable
    if (maybeRetryable === true) return true
  }

  const message = error instanceof Error ? error.message : String(error || '')
  const normalized = message.toLowerCase()
  return normalized.includes('llm_empty_response')
    || normalized.includes('stream_empty')
    || normalized.includes('ai_retryerror')
    || normalized.includes('maxretriesexceeded')
    || normalized.includes('bad gateway')
    || normalized.includes('statuscode":502')
    || normalized.includes('status code: 502')
}

function readText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)
}

function nameMatchesWithAlias(existingName: string, newName: string): boolean {
  const a = existingName.toLowerCase().trim()
  const b = newName.toLowerCase().trim()
  if (a === b) return true
  const aliasesA = a.split('/').map(s => s.trim()).filter(Boolean)
  const aliasesB = b.split('/').map(s => s.trim()).filter(Boolean)
  return aliasesB.some(alias => aliasesA.includes(alias))
}

function parseJsonResponse(responseText: string): Record<string, unknown> {
  let cleanedText = responseText.trim()
  cleanedText = cleanedText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')
  const firstBrace = cleanedText.indexOf('{')
  const lastBrace = cleanedText.lastIndexOf('}')
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleanedText = cleanedText.substring(firstBrace, lastBrace + 1)
  }
  return JSON.parse(cleanedText) as Record<string, unknown>
}

function readLocationsFromResponse(responseText: string): Array<Record<string, unknown>> {
  const data = parseJsonResponse(responseText)
  return Array.isArray(data.locations)
    ? (data.locations as Array<Record<string, unknown>>)
    : []
}

function estimateNarrativeBlockCount(content: string): number {
  return content
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .length
}

function shouldRunLocationRecall(content: string, firstRoundCount: number): boolean {
  if (firstRoundCount >= 5) return false

  const contentLength = content.trim().length
  const narrativeBlockCount = estimateNarrativeBlockCount(content)

  if (contentLength >= 10000) return firstRoundCount <= 4
  if (contentLength >= 4500 || narrativeBlockCount >= 24) return firstRoundCount <= 3
  if (contentLength >= 1800 || narrativeBlockCount >= 12) return firstRoundCount <= 2

  return false
}

function mergeLocationsByAlias(
  primary: Array<Record<string, unknown>>,
  recall: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  if (recall.length === 0) return primary

  const merged = [...primary]
  for (const item of recall) {
    const name = readText(item.name).trim()
    if (!name) continue

    const exists = merged.some((existing) => {
      const existingName = readText(existing.name).trim()
      return !!existingName && nameMatchesWithAlias(existingName, name)
    })
    if (!exists) merged.push(item)
  }

  return merged
}



type LocationDraft = Record<string, unknown>

function normalizeSpace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function hasAnyKeyword(text: string, keywords: string[]): boolean {
  const lowered = text.toLowerCase()
  return keywords.some((keyword) => lowered.includes(keyword.toLowerCase()))
}

function hasChineseText(value: string): boolean {
  return /[\u4e00-\u9fff]/u.test(value)
}

function hasLayerName(locations: LocationDraft[], keywords: string[]): boolean {
  return locations.some((location) => hasAnyKeyword(readText(location.name), keywords))
}

function buildLayerDescriptions(params: {
  name: string
  baseName: string
  layerSummary: string
  isZh: boolean
}): string[] {
  const { name, baseName, layerSummary, isZh } = params
  const localeNote = isZh ? 'zh-scene' : 'en-scene'
  return [
    '[' + name + '] (' + localeNote + ') wide establishing view of ' + baseName + ' ' + layerSummary + ', with clear foreground blockers, mid-ground routes, and background architecture silhouette.',
    '[' + name + '] (' + localeNote + ') low-light full-scene composition clarifying boundaries, approach paths, and entry direction around ' + baseName + '.',
    '[' + name + '] (' + localeNote + ') layered environment emphasizing spatial depth and lighting continuity for later character compositing.',
  ]
}

function buildSpatialLayerSupplements(content: string, locations: LocationDraft[]): LocationDraft[] {
  if (!content.trim() || locations.length === 0) return []

  const text = normalizeSpace(content)
  const hasOuterCue = hasAnyKeyword(text, [
    '\u5916\u56f4',
    '\u5916\u4fa7',
    '\u7ad9\u5916',
    '\u5916\u573a',
    'outside',
    'outer',
    'perimeter',
  ])
  const hasInnerCue = hasAnyKeyword(text, [
    '\u7ad9\u5185',
    '\u5185\u90e8',
    '\u5185\u573a',
    '\u5927\u5385',
    '\u5185\u5385',
    'inside',
    'interior',
    'hall',
  ])
  const hasGateCue = hasAnyKeyword(text, [
    '\u5165\u53e3',
    '\u95e8\u53e3',
    '\u94c1\u95e8',
    '\u540e\u95e8',
    '\u4fa7\u95e8',
    'entrance',
    'gate',
    'back door',
  ])
  const hasFenceCue = hasAnyKeyword(text, [
    '\u56f4\u680f',
    '\u897f\u4fa7',
    '\u4e1c\u4fa7',
    'fence',
    'west side',
    'east side',
  ])

  if (!hasOuterCue && !hasInnerCue && !hasGateCue && !hasFenceCue) return []

  const hub = locations.find((location) =>
    hasAnyKeyword(readText(location.name), [
      '\u7ad9',
      'station',
      'checkpoint',
      'quarantine',
      'terminal',
      'dock',
    ]),
  )
  if (!hub) return []

  const baseName = normalizeSpace(readText(hub.name).split('/')[0] || '')
  if (!baseName) return []

  const isZh = hasChineseText(baseName)
  const supplements: LocationDraft[] = []
  const mergedForChecking: LocationDraft[] = [...locations]

  const tryAddLayer = (params: {
    cue: boolean
    nameZh: string
    nameEn: string
    summaryZh: string
    summaryEn: string
    keywords: string[]
  }) => {
    const { cue, nameZh, nameEn, summaryZh, summaryEn, keywords } = params
    if (!cue) return
    if (hasLayerName(mergedForChecking, keywords)) return

    const name = isZh ? `${baseName}_${nameZh}` : `${baseName}_${nameEn}`
    const summary = isZh
      ? `${baseName}\u7684${summaryZh}\uff0c\u7528\u4e8e\u627f\u63a5\u72ec\u7acb\u52a8\u4f5c\u4e0e\u7a7a\u95f4\u8c03\u5ea6\u3002`
      : `${summaryEn} layer of ${baseName} with independent narrative actions.`

    const location: LocationDraft = {
      name,
      summary,
      has_crowd: false,
      crowd_description: '',
      descriptions: buildLayerDescriptions({
        name,
        baseName,
        layerSummary: isZh ? summaryZh : summaryEn,
        isZh,
      }),
    }

    supplements.push(location)
    mergedForChecking.push(location)
  }

  tryAddLayer({
    cue: hasOuterCue,
    nameZh: '\u5916\u56f4',
    nameEn: 'outer_perimeter',
    summaryZh: '\u5916\u56f4\u7f13\u51b2\u533a',
    summaryEn: 'outer perimeter',
    keywords: ['\u5916\u56f4', '\u5916\u4fa7', '\u7ad9\u5916', 'outer', 'outside', 'perimeter'],
  })

  tryAddLayer({
    cue: hasInnerCue,
    nameZh: '\u5185\u90e8',
    nameEn: 'inner_core',
    summaryZh: '\u5185\u90e8\u6838\u5fc3\u533a',
    summaryEn: 'inner core',
    keywords: ['\u5185\u90e8', '\u7ad9\u5185', '\u5927\u5385', '\u5185\u5385', 'inner', 'inside', 'interior', 'hall'],
  })

  tryAddLayer({
    cue: hasGateCue,
    nameZh: '\u51fa\u5165\u53e3',
    nameEn: 'gate_zone',
    summaryZh: '\u51fa\u5165\u53e3\u533a',
    summaryEn: 'gate zone',
    keywords: ['\u5165\u53e3', '\u95e8\u53e3', '\u540e\u95e8', '\u4fa7\u95e8', 'gate', 'entrance', 'back door'],
  })

  tryAddLayer({
    cue: hasFenceCue,
    nameZh: '\u56f4\u680f\u7ebf',
    nameEn: 'fence_line',
    summaryZh: '\u56f4\u680f\u7ebf\u533a\u57df',
    summaryEn: 'fence line',
    keywords: ['\u56f4\u680f', 'fence', 'west side', 'east side'],
  })

  return supplements
}

export async function handleAnalyzeNovelTask(job: Job<TaskJobData>) {
  const payload = (job.data.payload || {}) as Record<string, unknown>
  const projectId = job.data.projectId

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      mode: true,
    },
  })
  if (!project) {
    throw new Error('Project not found')
  }
  if (project.mode !== 'novel-promotion') {
    throw new Error('Not a novel promotion project')
  }

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
  const analysisModel = await resolveAnalysisModel({
    userId: job.data.userId,
    inputModel: payload.model,
    projectAnalysisModel: novelData.analysisModel,
  })

  const firstEpisode = await prisma.novelPromotionEpisode.findFirst({
    where: { novelPromotionProjectId: novelData.id },
    orderBy: { createdAt: 'asc' },
    select: {
      novelText: true,
    },
  })

  let contentToAnalyze = readText(novelData.globalAssetText) || readText(firstEpisode?.novelText)
  if (!contentToAnalyze.trim()) {
    throw new Error(ERR_MISSING_CONTENT)
  }

  const maxContentLength = 30000
  if (contentToAnalyze.length > maxContentLength) {
    contentToAnalyze = contentToAnalyze.substring(0, maxContentLength)
  }

  const charactersLibName = (novelData.characters || []).map((item) => item.name).join(', ')
  const locationsLibName = (novelData.locations || []).map((item) => item.name).join(', ')
  const characterPromptTemplate = buildPrompt({
    promptId: PROMPT_IDS.NP_AGENT_CHARACTER_PROFILE,
    locale: job.data.locale,
    variables: {
      input: contentToAnalyze,
      characters_lib_info: charactersLibName || ZH_NONE,
    },
  })
  const locationPromptTemplate = buildPrompt({
    promptId: PROMPT_IDS.NP_SELECT_LOCATION,
    locale: job.data.locale,
    variables: {
      input: contentToAnalyze,
      locations_lib_name: locationsLibName || ZH_NONE,
    },
  })

  await reportTaskProgress(job, 20, {
    stage: 'analyze_novel_prepare',
    stageLabel: STAGE_LABEL_PREPARE,
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'analyze_novel_prepare')

  const streamContext = createWorkerLLMStreamContext(job, 'analyze_novel')
  const streamCallbacks = createWorkerLLMStreamCallbacks(job, streamContext)

  let characterCompletion!: Awaited<ReturnType<typeof executeAiTextStep>>
  let locationCompletion!: Awaited<ReturnType<typeof executeAiTextStep>>
  let locationRecallCompletion: Awaited<ReturnType<typeof executeAiTextStep>> | null = null
  let parsedLocations = [] as Array<Record<string, unknown>>

  const executeAiTextStepWithRetry = async (params: {
    prompt: string
    temperature: number
    action: string
    meta: {
      stepId: string
      stepTitle: string
      stepIndex: number
      stepTotal: number
    }
  }) => {
    let lastError: unknown = null

    for (let attempt = 1; attempt <= ANALYZE_TEXT_STEP_MAX_ATTEMPTS; attempt += 1) {
      await assertTaskActive(job, `${params.meta.stepId}:attempt:${attempt}`)
      try {
        return await executeAiTextStep({
          userId: job.data.userId,
          model: analysisModel,
          messages: [{ role: 'user', content: params.prompt }],
          temperature: params.temperature,
          projectId,
          action: params.action,
          meta: {
            ...params.meta,
            stepAttempt: attempt,
          },
        })
      } catch (error) {
        lastError = error
        if (!isRetryableAnalyzeError(error) || attempt >= ANALYZE_TEXT_STEP_MAX_ATTEMPTS) {
          throw error
        }
        await sleep(ANALYZE_TEXT_STEP_RETRY_DELAY_MS * attempt)
      }
    }

    throw (lastError instanceof Error ? lastError : new Error('analyze step failed'))
  }

  try {
    await withInternalLLMStreamCallbacks(
      streamCallbacks,
      async () => {
        ;[characterCompletion, locationCompletion] = await Promise.all([
          executeAiTextStepWithRetry({
            prompt: characterPromptTemplate,
            temperature: 0.7,
            action: 'analyze_characters',
            meta: {
              stepId: 'analyze_characters',
              stepTitle: STEP_TITLE_CHARACTER,
              stepIndex: 1,
              stepTotal: 2,
            },
          }),
          executeAiTextStepWithRetry({
            prompt: locationPromptTemplate,
            temperature: 0.7,
            action: 'analyze_locations',
            meta: {
              stepId: 'analyze_locations',
              stepTitle: STEP_TITLE_LOCATION,
              stepIndex: 2,
              stepTotal: 2,
            },
          }),
        ])
      },
    )

    parsedLocations = readLocationsFromResponse(locationCompletion.text)
    const shouldRecall = shouldRunLocationRecall(contentToAnalyze, parsedLocations.length)

    if (shouldRecall) {
      const locationRecallPromptTemplate = buildPrompt({
        promptId: PROMPT_IDS.NP_SELECT_LOCATION_RECALL,
        locale: job.data.locale,
        variables: {
          input: contentToAnalyze,
          locations_lib_name: locationsLibName || ZH_NONE,
          existing_locations_json: JSON.stringify(parsedLocations, null, 2),
        },
      })

      locationRecallCompletion = await withInternalLLMStreamCallbacks(
        streamCallbacks,
        async () =>
          await executeAiTextStepWithRetry({
            prompt: locationRecallPromptTemplate,
            temperature: 0.5,
            action: 'analyze_locations_recall',
            meta: {
              stepId: 'analyze_locations_recall',
              stepTitle: STEP_TITLE_LOCATION_RECALL,
              stepIndex: 3,
              stepTotal: 3,
            },
          }),
      )
    }
  } finally {
    await streamCallbacks.flush()
  }

  const characterResponseText = characterCompletion.text
  const locationResponseText = locationCompletion.text

  await reportTaskProgress(job, 60, {
    stage: 'analyze_novel_characters_done',
    stageLabel: STAGE_LABEL_CHARACTER_DONE,
    displayMode: 'detail',
    stepId: 'analyze_characters',
    stepTitle: STEP_TITLE_CHARACTER,
    stepIndex: 1,
    stepTotal: 2,
    done: true,
    output: characterResponseText,
  })

  await reportTaskProgress(job, 70, {
    stage: 'analyze_novel_locations_done',
    stageLabel: STAGE_LABEL_LOCATION_DONE,
    displayMode: 'detail',
    stepId: 'analyze_locations',
    stepTitle: STEP_TITLE_LOCATION,
    stepIndex: 2,
    stepTotal: 2,
    done: true,
    output: locationResponseText,
  })

  const charactersData = parseJsonResponse(characterResponseText)
  const parsedNewCharacters = Array.isArray(charactersData.new_characters)
    ? (charactersData.new_characters as Array<Record<string, unknown>>)
    : []
  const parsedLegacyCharacters = Array.isArray(charactersData.characters)
    ? (charactersData.characters as Array<Record<string, unknown>>)
    : []
  const parsedCharacters = parsedNewCharacters.length > 0 ? parsedNewCharacters : parsedLegacyCharacters
  const parsedUpdatedCharacters = Array.isArray(charactersData.updated_characters)
    ? (charactersData.updated_characters as Array<Record<string, unknown>>)
    : []

  if (locationRecallCompletion !== null) {
    const recallResponseText = locationRecallCompletion.text
    const parsedRecallLocations = readLocationsFromResponse(recallResponseText)
    parsedLocations = mergeLocationsByAlias(parsedLocations, parsedRecallLocations)

    await reportTaskProgress(job, 73, {
      stage: 'analyze_novel_locations_recall_done',
      stageLabel: STAGE_LABEL_LOCATION_RECALL_DONE,
      displayMode: 'detail',
      stepId: 'analyze_locations_recall',
      stepTitle: STEP_TITLE_LOCATION_RECALL,
      stepIndex: 3,
      stepTotal: 3,
      done: true,
      output: recallResponseText,
    })
  }

  const layeredSupplements = buildSpatialLayerSupplements(contentToAnalyze, parsedLocations)
  if (layeredSupplements.length > 0) {
    parsedLocations = mergeLocationsByAlias(parsedLocations, layeredSupplements)
  }

  await reportTaskProgress(job, 75, {
    stage: 'analyze_novel_persist',
    stageLabel: STAGE_LABEL_PERSIST,
    displayMode: 'detail',
  })
  await assertTaskActive(job, 'analyze_novel_persist')

  const createdCharacters: Array<{ id: string }> = []
  for (const item of parsedCharacters) {
    const name = readText(item.name).trim()
    if (!name) continue

    const existsInLibrary = (novelData.characters || []).some(
      (character) => nameMatchesWithAlias(character.name, name),
    )
    if (existsInLibrary) continue

    const expectedAppearances = Array.isArray(item.expected_appearances)
      ? (item.expected_appearances as Array<Record<string, unknown>>).map((ea) => ({
        id: typeof ea.id === 'number' ? ea.id : 1,
        change_reason: readText(ea.change_reason) || CHANGE_REASON_DEFAULT,
      }))
      : undefined

    const profileData = {
      role_level: item.role_level,
      archetype: item.archetype,
      personality_tags: toStringArray(item.personality_tags),
      era_period: item.era_period,
      social_class: item.social_class,
      occupation: item.occupation,
      costume_tier: item.costume_tier,
      suggested_colors: toStringArray(item.suggested_colors),
      primary_identifier: item.primary_identifier,
      visual_keywords: toStringArray(item.visual_keywords),
      gender: item.gender,
      age_range: item.age_range,
      expected_appearances: expectedAppearances,
    }

    const created = await prisma.novelPromotionCharacter.create({
      data: {
        novelPromotionProjectId: novelData.id,
        name,
        aliases: JSON.stringify(toStringArray(item.aliases)),
        introduction: readText(item.introduction) || null,
        profileData: JSON.stringify(profileData),
        profileConfirmed: false,
      },
      select: { id: true },
    })
    createdCharacters.push(created)
  }

  for (const item of parsedUpdatedCharacters) {
    const name = readText(item.name).trim()
    if (!name) continue
    const existingChar = (novelData.characters || []).find(
      (character) => nameMatchesWithAlias(character.name, name),
    )
    if (!existingChar) continue

    try {
      const updateData: Record<string, unknown> = {}
      const updatedIntroduction = readText(item.updated_introduction)
      if (updatedIntroduction) {
        updateData.introduction = updatedIntroduction
      }
      const updatedAliases = toStringArray(item.updated_aliases)
      if (updatedAliases.length > 0) {
        const existingAliases = (() => {
          try { return JSON.parse(existingChar.aliases || '[]') as string[] } catch { return [] }
        })()
        const merged = [...new Set([...existingAliases, ...updatedAliases])]
        updateData.aliases = JSON.stringify(merged)
      }
      if (Object.keys(updateData).length > 0) {
        await prisma.novelPromotionCharacter.update({
          where: { id: existingChar.id },
          data: updateData,
        })
      }
    } catch {
      // Ignore update failures to avoid blocking the main flow.
    }
  }

  const createdLocations: Array<{ id: string }> = []
  for (const item of parsedLocations) {
    const name = readText(item.name).trim()
    if (!name) continue

    const descriptionsRaw = Array.isArray(item.descriptions)
      ? (item.descriptions as unknown[])
      : (readText(item.description) ? [readText(item.description)] : [])
    const descriptions = descriptionsRaw
      .map((value) => readText(value))
      .filter(Boolean)
    const firstDescription = descriptions[0] || ''

    const isInvalid = LOCATION_INVALID_KEYWORDS.some((keyword) =>
      name.includes(keyword) || firstDescription.includes(keyword),
    )
    if (isInvalid) continue

    const existsInLibrary = (novelData.locations || []).some(
      (location) => nameMatchesWithAlias(location.name, name),
    )
    if (existsInLibrary) continue

    const created = await prisma.novelPromotionLocation.create({
      data: {
        novelPromotionProjectId: novelData.id,
        name,
        summary: readText(item.summary) || null,
      },
      select: { id: true },
    })

    const cleanDescriptions = descriptions.map((value) => removeLocationPromptSuffix(value || ''))
    for (let i = 0; i < cleanDescriptions.length; i += 1) {
      await prisma.locationImage.create({
        data: {
          locationId: created.id,
          imageIndex: i,
          description: cleanDescriptions[i],
        },
      })
    }

    createdLocations.push(created)
  }

  await prisma.novelPromotionProject.update({
    where: { id: novelData.id },
    data: {
      artStylePrompt: getArtStylePrompt(novelData.artStyle, job.data.locale) || '',
    },
  })

  await reportTaskProgress(job, 96, {
    stage: 'analyze_novel_done',
    stageLabel: STAGE_LABEL_DONE,
    displayMode: 'detail',
  })

  return {
    success: true,
    characters: createdCharacters,
    locations: createdLocations,
    characterCount: createdCharacters.length,
    locationCount: createdLocations.length,
  }
}
