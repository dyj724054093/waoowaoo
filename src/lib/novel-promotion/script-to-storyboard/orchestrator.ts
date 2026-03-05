import { buildCharactersIntroduction } from '@/lib/constants'
import { normalizeAnyError } from '@/lib/errors/normalize'
import { createScopedLogger } from '@/lib/logging/core'
import {
  type ActingDirection,
  type CharacterAsset,
  type ClipCharacterRef,
  type LocationAsset,
  type PhotographyRule,
  type StoryboardPanel,
  buildCharacterProfileSummary,
  formatClipId,
  getFilteredAppearanceList,
  getFilteredFullDescription,
  getFilteredLocationsDescription,
} from '@/lib/storyboard-phases'

type JsonRecord = Record<string, unknown>
const orchestratorLogger = createScopedLogger({ module: 'worker.orchestrator.script_to_storyboard' })

export type ScriptToStoryboardStepMeta = {
  stepId: string
  stepAttempt?: number
  stepTitle: string
  stepIndex: number
  stepTotal: number
}

export type ScriptToStoryboardStepOutput = {
  text: string
  reasoning: string
}

type ClipInput = {
  id: string
  content: string | null
  characters: string | null
  location: string | null
  screenplay: string | null
}

export type ScriptToStoryboardPromptTemplates = {
  phase1PlanTemplate: string
  phase2CinematographyTemplate: string
  phase2ActingTemplate: string
  phase3DetailTemplate: string
}

export type ClipStoryboardPanels = {
  clipId: string
  clipIndex: number
  finalPanels: StoryboardPanel[]
}

export type ScriptToStoryboardOrchestratorInput = {
  clips: ClipInput[]
  novelPromotionData: {
    characters: CharacterAsset[]
    locations: LocationAsset[]
  }
  promptTemplates: ScriptToStoryboardPromptTemplates
  runStep: (
    meta: ScriptToStoryboardStepMeta,
    prompt: string,
    action: string,
    maxOutputTokens: number,
  ) => Promise<ScriptToStoryboardStepOutput>
}

export type ScriptToStoryboardOrchestratorResult = {
  clipPanels: ClipStoryboardPanels[]
  summary: {
    clipCount: number
    totalPanelCount: number
    totalStepCount: number
  }
}


export class JsonParseError extends Error {
  rawText: string
  constructor(message: string, rawText: string) {
    super(message)
    this.name = 'JsonParseError'
    this.rawText = rawText
  }
}

function parseJsonArray<T extends JsonRecord>(responseText: string, label: string): T[] {
  let jsonText = responseText.trim()
  jsonText = jsonText.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/\s*```$/, '')

  if (!jsonText.includes('[') || !jsonText.includes(']')) {
    throw new JsonParseError(`${label}: JSON format invalid`, responseText)
  }

  const parsed = findFirstJsonObjectArray(jsonText)
  if (!parsed) {
    throw new JsonParseError(`${label}: JSON parse error: no valid object array found`, responseText)
  }

  const rows = parsed.filter((item): item is T => typeof item === 'object' && item !== null)
  if (rows.length === 0) {
    throw new JsonParseError(`${label}: invalid payload`, responseText)
  }
  return rows
}

function findFirstJsonObjectArray(text: string): unknown[] | null {
  let insideString = false
  let escaped = false
  let depth = 0
  let candidateStart = -1

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (insideString) {
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') {
        insideString = false
      }
      continue
    }

    if (char === '"') {
      insideString = true
      continue
    }

    if (char === '[') {
      if (depth === 0) candidateStart = index
      depth += 1
      continue
    }

    if (char !== ']') continue
    if (depth === 0) continue

    depth -= 1
    if (depth !== 0 || candidateStart === -1) continue

    const candidate = text.slice(candidateStart, index + 1)
    try {
      const parsed = JSON.parse(candidate)
      if (!Array.isArray(parsed) || parsed.length === 0) continue
      const hasObjectLike = parsed.some((item) => typeof item === 'object' && item !== null)
      if (!hasObjectLike) continue
      return parsed
    } catch {
      // Ignore non-JSON bracket segments such as "[关键道具]" and keep scanning.
    }
  }

  return null
}

function parseClipCharacters(raw: string | null): ClipCharacterRef[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) {
      throw new Error('characters field must be JSON array')
    }
    return parsed as ClipCharacterRef[]
  } catch (error) {
    throw new Error(`Invalid clip characters JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function parseScreenplay(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`Invalid clip screenplay JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function withStepMeta(
  stepId: string,
  stepTitle: string,
  stepIndex: number,
  stepTotal: number,
): ScriptToStoryboardStepMeta {
  return {
    stepId,
    stepTitle,
    stepIndex,
    stepTotal,
  }
}

function mergePanelsWithRules(params: {
  finalPanels: StoryboardPanel[]
  photographyRules: PhotographyRule[]
  actingDirections: ActingDirection[]
}) {
  const { finalPanels, photographyRules, actingDirections } = params
  return finalPanels.map((panel, index) => {
    const rules = photographyRules.find((rule) => rule.panel_number === panel.panel_number)
    if (!rules) {
      throw new Error(`Missing photography rule for panel_number=${String(panel.panel_number)} at index=${index}`)
    }
    const acting = actingDirections.find((item) => item.panel_number === panel.panel_number)
    if (!acting) {
      throw new Error(`Missing acting direction for panel_number=${String(panel.panel_number)} at index=${index}`)
    }

    return {
      ...panel,
      photographyPlan: {
        composition: rules.composition,
        lighting: rules.lighting,
        colorPalette: rules.color_palette,
        atmosphere: rules.atmosphere,
        technicalNotes: rules.technical_notes,
      },
      actingNotes: acting.characters,
    }
  })
}

function normalizeComparableText(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\p{L}\p{N} ]+/gu, ' ')
    .trim()
}

function isMeaningfulText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function splitComparableUnits(text: string): string[] {
  if (!text) return []
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length > 1) return words

  const chars = Array.from(text)
  if (chars.length <= 2) return chars.length === 0 ? [] : [text]

  const grams: string[] = []
  for (let i = 0; i < chars.length - 1; i += 1) {
    grams.push(`${chars[i]}${chars[i + 1]}`)
  }
  return grams
}

function jaccardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  const setA = new Set(splitComparableUnits(a))
  const setB = new Set(splitComparableUnits(b))
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection += 1
  }
  const union = setA.size + setB.size - intersection
  return union <= 0 ? 0 : intersection / union
}

function buildCharacterSignature(panel: StoryboardPanel): string {
  if (!Array.isArray(panel.characters)) return ''
  const names = panel.characters
    .map((item) => {
      if (typeof item === 'string') return item
      if (typeof item === 'object' && item !== null && typeof (item as { name?: unknown }).name === 'string') {
        return String((item as { name: string }).name)
      }
      return ''
    })
    .map((name) => normalizeComparableText(name))
    .filter(Boolean)
    .sort()

  return names.join('|')
}

const STYLIZED_CAMERA_TOKENS = [
  'dutch',
  'pov',
  'subjective',
  'handheld',
  '\u8377\u5170',
  '\u4e3b\u89c2',
  '\u624b\u6301',
]

const DISORIENTATION_CUE_TOKENS = [
  'dizzy',
  'vertigo',
  'hallucination',
  'panic',
  'disoriented',
  'confused',
  '\u7729\u6655',
  '\u5931\u8861',
  '\u6050\u614c',
  '\u6076\u5fc3',
  '\u6df7\u4e71',
  '\u6065\u60da',
]

const NARRATIVE_CUE_TOKENS = [
  'hear',
  'heard',
  'listen',
  'footstep',
  'patrol',
  'radio',
  'signal',
  'whisper',
  'say',
  'speaks',
  'dialogue',
  'look',
  'watch',
  'observe',
  'turn',
  'enter',
  'exit',
  'open',
  'close',
  'run',
  'rush',
  'attack',
  'fire',
  'aim',
  'hide',
  'crouch',
  'freeze',
  'stop',
  '\u542c',
  '\u811a\u6b65',
  '\u5de1\u903b',
  '\u8033\u673a',
  '\u8bf4',
  '\u5bf9\u8bdd',
  '\u770b',
  '\u76ef',
  '\u8f6c\u5934',
  '\u8fdb\u5165',
  '\u79bb\u5f00',
  '\u6253\u5f00',
  '\u5173\u95ed',
  '\u8dd1',
  '\u51b2',
  '\u653b\u51fb',
  '\u8eb2',
  '\u8e72',
  '\u50f5\u4f4f',
]

function cueSimilarity(a: string, b: string): number {
  const aa = normalizeComparableText(a)
  const bb = normalizeComparableText(b)
  if (!aa || !bb) return 0

  const setA = new Set(NARRATIVE_CUE_TOKENS.filter((token) => aa.includes(token)))
  const setB = new Set(NARRATIVE_CUE_TOKENS.filter((token) => bb.includes(token)))
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const token of setA) {
    if (setB.has(token)) intersection += 1
  }
  const union = setA.size + setB.size - intersection
  return union <= 0 ? 0 : intersection / union
}

function shotScaleClass(shot: string): 'wide' | 'medium' | 'close' | 'detail' | 'unknown' {
  if (!shot) return 'unknown'
  if (/(establish|master|wide|long|aerial|\u5168\u666f|\u8fdc\u666f|\u5927\u8fdc)/.test(shot)) return 'wide'
  if (/(medium|waist|ots|\u4e2d\u666f|\u8170\u666f|\u8d8a\u80a9)/.test(shot)) return 'medium'
  if (/(close|\u8fd1\u666f)/.test(shot)) return 'close'
  if (/(ecu|insert|macro|\u7279\u5199|\u7ec6\u8282)/.test(shot)) return 'detail'
  return 'unknown'
}

function hasStylizedCameraLanguage(panel: StoryboardPanel): boolean {
  const shot = normalizeComparableText(panel.shot_type)
  const move = normalizeComparableText(panel.camera_move)
  return STYLIZED_CAMERA_TOKENS.some((token) => shot.includes(token) || move.includes(token))
}

function hasDisorientationCue(panel: StoryboardPanel): boolean {
  const text = `${normalizeComparableText(panel.source_text)} ${normalizeComparableText(panel.description)}`
  if (!text.trim()) return false
  return DISORIENTATION_CUE_TOKENS.some((token) => text.includes(token))
}

function isLikelyRedundantPanel(previous: StoryboardPanel, current: StoryboardPanel): boolean {
  const prevLocation = normalizeComparableText(previous.location)
  const currLocation = normalizeComparableText(current.location)
  if (!prevLocation || !currLocation || prevLocation !== currLocation) return false

  const prevDesc = normalizeComparableText(previous.description)
  const currDesc = normalizeComparableText(current.description)
  const prevSource = normalizeComparableText(previous.source_text)
  const currSource = normalizeComparableText(current.source_text)

  const descSimilarity = jaccardSimilarity(prevDesc, currDesc)
  const sourceSimilarity = jaccardSimilarity(prevSource, currSource)

  const prevShot = normalizeComparableText(previous.shot_type)
  const currShot = normalizeComparableText(current.shot_type)
  const prevMove = normalizeComparableText(previous.camera_move)
  const currMove = normalizeComparableText(current.camera_move)

  const sameCharacters = (() => {
    const a = buildCharacterSignature(previous)
    const b = buildCharacterSignature(current)
    return !!a && a === b
  })()

  if (sameCharacters && sourceSimilarity >= 0.82) return true
  if (sameCharacters && sourceSimilarity >= 0.68 && descSimilarity >= 0.45) return true
  if (sourceSimilarity >= 0.9) return true
  if (descSimilarity >= 0.88 && sourceSimilarity >= 0.6) return true

  const stylizedPerspectiveFlags = (() => {
    const hasPrev = STYLIZED_CAMERA_TOKENS.some((token) => prevShot.includes(token) || prevMove.includes(token))
    const hasCurr = STYLIZED_CAMERA_TOKENS.some((token) => currShot.includes(token) || currMove.includes(token))
    return {
      hasPrev,
      hasCurr,
      changed: hasPrev !== hasCurr,
    }
  })()
  if (stylizedPerspectiveFlags.changed && sourceSimilarity >= 0.55 && descSimilarity >= 0.5) return true

  // If two adjacent panels share the same beat and only differ by stylized camera language,
  // treat the latter as redundant to keep storyboard rhythm focused on beat changes.
  if (sameCharacters && sourceSimilarity >= 0.78 && (stylizedPerspectiveFlags.hasPrev || stylizedPerspectiveFlags.hasCurr)) {
    return true
  }

  const sameShotAndMove = !!prevShot && prevShot === currShot && !!prevMove && prevMove === currMove
  if (sameShotAndMove && descSimilarity >= 0.52 && sourceSimilarity >= 0.3) return true

  return false
}

function areLikelySameNarrativeBeat(previous: StoryboardPanel, current: StoryboardPanel): boolean {
  const prevLocation = normalizeComparableText(previous.location)
  const currLocation = normalizeComparableText(current.location)
  if (!prevLocation || !currLocation || prevLocation !== currLocation) return false

  const prevSource = normalizeComparableText(previous.source_text)
  const currSource = normalizeComparableText(current.source_text)
  const sourceSimilarity = jaccardSimilarity(prevSource, currSource)
  const prevDesc = normalizeComparableText(previous.description)
  const currDesc = normalizeComparableText(current.description)
  const descSimilarity = jaccardSimilarity(prevDesc, currDesc)
  const cueScore = cueSimilarity(`${prevSource} ${prevDesc}`, `${currSource} ${currDesc}`)
  const hasSourceContainment = prevSource.length >= 10
    && currSource.length >= 10
    && (prevSource.includes(currSource) || currSource.includes(prevSource))

  let sameBeat = sourceSimilarity >= 0.66
  if (!sameBeat) {
    sameBeat = (hasSourceContainment && cueScore >= 0.28)
      || (descSimilarity >= 0.56 && cueScore >= 0.34)
      || cueScore >= 0.72
  }
  if (!sameBeat) return false

  const prevCharacters = buildCharacterSignature(previous)
  const currCharacters = buildCharacterSignature(current)
  if (prevCharacters && currCharacters && prevCharacters !== currCharacters) return false

  return true
}

function shouldKeepLastPanelForBeatRun(run: StoryboardPanel[]): boolean {
  if (run.length <= 1) return false

  const first = run[0]!
  const last = run[run.length - 1]!

  const firstDesc = normalizeComparableText(first.description)
  const lastDesc = normalizeComparableText(last.description)
  const descSimilarity = jaccardSimilarity(firstDesc, lastDesc)

  const firstSource = normalizeComparableText(first.source_text)
  const lastSource = normalizeComparableText(last.source_text)
  const sourceSimilarity = jaccardSimilarity(firstSource, lastSource)
  const cueScore = cueSimilarity(`${firstSource} ${firstDesc}`, `${lastSource} ${lastDesc}`)

  // If narrative cues are almost the same, this is likely just style coverage with no new information.
  if (sourceSimilarity >= 0.74 && cueScore >= 0.65) return false
  if (descSimilarity > 0.42 && cueScore >= 0.45) return false

  const firstShot = normalizeComparableText(first.shot_type)
  const lastShot = normalizeComparableText(last.shot_type)
  const firstMove = normalizeComparableText(first.camera_move)
  const lastMove = normalizeComparableText(last.camera_move)
  const shotOrMoveChanged = (firstShot && lastShot && firstShot !== lastShot)
    || (firstMove && lastMove && firstMove !== lastMove)

  const firstScale = shotScaleClass(firstShot)
  const lastScale = shotScaleClass(lastShot)
  const scaleChanged = firstScale !== 'unknown' && lastScale !== 'unknown' && firstScale !== lastScale

  const firstCharacters = buildCharacterSignature(first)
  const lastCharacters = buildCharacterSignature(last)
  const charactersChanged = !!firstCharacters && !!lastCharacters && firstCharacters !== lastCharacters

  if (charactersChanged) return true

  const visualChanged = shotOrMoveChanged || scaleChanged
  const meaningfulNarrativeDelta = sourceSimilarity < 0.72 || cueScore < 0.58 || descSimilarity < 0.32
  return visualChanged && meaningfulNarrativeDelta
}

function compactNarrativeBeatRuns(panels: StoryboardPanel[]): StoryboardPanel[] {
  if (panels.length <= 1) return panels

  const compacted: StoryboardPanel[] = []
  let index = 0

  while (index < panels.length) {
    const runStart = index
    let runEnd = index
    while (runEnd + 1 < panels.length && areLikelySameNarrativeBeat(panels[runEnd]!, panels[runEnd + 1]!)) {
      runEnd += 1
    }

    const run = panels.slice(runStart, runEnd + 1)
    compacted.push(run[0]!)
    if (shouldKeepLastPanelForBeatRun(run)) {
      compacted.push(run[run.length - 1]!)
    }

    index = runEnd + 1
  }

  return compacted
}

function dedupeAdjacentPanels(panels: StoryboardPanel[]): StoryboardPanel[] {
  if (panels.length <= 1) return panels
  const deduped: StoryboardPanel[] = [panels[0]!]

  for (let i = 1; i < panels.length; i += 1) {
    const current = panels[i]!
    const previous = deduped[deduped.length - 1]!
    if (isLikelyRedundantPanel(previous, current)) continue
    deduped.push(current)
  }

  return deduped
}

function limitStylizedAccentReuse(panels: StoryboardPanel[]): StoryboardPanel[] {
  if (panels.length <= 1) return panels

  const result: StoryboardPanel[] = []
  const usage = new Map<string, number>()

  for (const panel of panels) {
    if (!hasStylizedCameraLanguage(panel)) {
      result.push(panel)
      continue
    }

    const shot = normalizeComparableText(panel.shot_type)
    const move = normalizeComparableText(panel.camera_move)
    const tags: string[] = []

    if (shot.includes('dutch') || shot.includes('\u8377\u5170') || move.includes('dutch') || move.includes('\u8377\u5170')) {
      tags.push('dutch')
    }
    if (shot.includes('pov') || shot.includes('subjective') || shot.includes('\u4e3b\u89c2') || move.includes('pov') || move.includes('subjective') || move.includes('\u4e3b\u89c2')) {
      tags.push('pov')
    }
    if (shot.includes('handheld') || shot.includes('\u624b\u6301') || move.includes('handheld') || move.includes('\u624b\u6301')) {
      tags.push('handheld')
    }

    const previous = result[result.length - 1]
    const sameBeatAsPrevious = (() => {
      if (!previous) return false
      if (areLikelySameNarrativeBeat(previous, panel)) return true

      const prevLocation = normalizeComparableText(previous.location)
      const currLocation = normalizeComparableText(panel.location)
      if (!prevLocation || !currLocation || prevLocation !== currLocation) return false

      const prevCharacters = buildCharacterSignature(previous)
      const currCharacters = buildCharacterSignature(panel)
      if (prevCharacters && currCharacters && prevCharacters !== currCharacters) return false

      const prevNarrative = `${normalizeComparableText(previous.source_text)} ${normalizeComparableText(previous.description)}`
      const currNarrative = `${normalizeComparableText(panel.source_text)} ${normalizeComparableText(panel.description)}`
      const cueScore = cueSimilarity(prevNarrative, currNarrative)
      const descScore = jaccardSimilarity(
        normalizeComparableText(previous.description),
        normalizeComparableText(panel.description),
      )
      return cueScore >= 0.25 || descScore >= 0.62
    })()
    const allowExtraStylized = hasDisorientationCue(panel)

    let shouldDrop = false
    for (const tag of tags) {
      const used = usage.get(tag) || 0
      if (used >= 1 && sameBeatAsPrevious && !allowExtraStylized) {
        shouldDrop = true
      }
    }
    if (shouldDrop) continue

    for (const tag of tags) {
      usage.set(tag, (usage.get(tag) || 0) + 1)
    }
    result.push(panel)
  }

  return result.length > 0 ? result : [panels[0]!]
}

function estimatePanelSoftLimit(clipContent: string): number {
  const text = clipContent.trim()
  if (!text) return 6

  const sentenceCount = text
    .split(/[\u3002\uFF01\uFF1F.!?;\uFF1B\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .length

  const dialogueCount = (text.match(/[\u201C"\u300C\u300E][^\u201D"\u300D\u300F]+[\u201D"\u300D\u300F]/g) || []).length
  const byLength = Math.ceil(text.length / 140)
  const byNarrativeBeats = Math.ceil((sentenceCount + dialogueCount * 1.5) / 2)
  const floorBySentence = sentenceCount >= 3 ? 3 : 2

  return Math.max(floorBySentence, Math.min(8, Math.max(byLength, byNarrativeBeats)))
}

function trimPanelsBySpread(panels: StoryboardPanel[], limit: number): StoryboardPanel[] {
  if (panels.length <= limit) return panels
  if (limit <= 1) return [panels[0]!]

  const picked = new Set<number>([0, panels.length - 1])
  const stride = (panels.length - 1) / (limit - 1)
  for (let i = 1; i < limit - 1; i += 1) {
    picked.add(Math.round(i * stride))
  }

  return Array.from(picked)
    .sort((a, b) => a - b)
    .map((index) => panels[index]!)
}

function optimizePhase3Panels(params: { panels: StoryboardPanel[]; clipContent: string }): StoryboardPanel[] {
  const { panels, clipContent } = params
  if (panels.length <= 1) return panels

  const deduped = dedupeAdjacentPanels(panels)
  const compacted = compactNarrativeBeatRuns(deduped)
  const stylizedLimited = limitStylizedAccentReuse(compacted)
  const softLimit = estimatePanelSoftLimit(clipContent)
  const limited = stylizedLimited.length > softLimit ? trimPanelsBySpread(stylizedLimited, softLimit) : stylizedLimited

  return limited.length > 0 ? limited : [panels[0]!]
}

const MAX_STEP_ATTEMPTS = 3
const MAX_RETRY_DELAY_MS = 10_000

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeRetryDelayMs(attempt: number) {
  const base = Math.min(1_000 * Math.pow(2, Math.max(0, attempt - 1)), MAX_RETRY_DELAY_MS)
  const jitter = Math.floor(Math.random() * 300)
  return base + jitter
}

function shouldRetryStepError(error: unknown, message: string, retryable: boolean) {
  if (error instanceof JsonParseError) return true
  if (retryable) return true
  const lowerMessage = message.toLowerCase()
  return lowerMessage.includes('json') || lowerMessage.includes('parse')
}

async function runStepWithRetry<T>(
  runStep: ScriptToStoryboardOrchestratorInput['runStep'],
  baseMeta: ScriptToStoryboardStepMeta,
  prompt: string,
  action: string,
  maxOutputTokens: number,
  parse: (text: string) => T,
): Promise<{ output: ScriptToStoryboardStepOutput; parsed: T }> {
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= MAX_STEP_ATTEMPTS; attempt++) {
    const meta = attempt === 1
      ? baseMeta
      : {
        ...baseMeta,
        stepId: baseMeta.stepId,
        stepAttempt: attempt,
        stepTitle: baseMeta.stepTitle,
      }
    try {
      const output = await runStep(meta, prompt, action, maxOutputTokens)
      const parsed = parse(output.text)
      return { output, parsed }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      const normalizedError = normalizeAnyError(error, { context: 'worker' })
      const shouldRetry = attempt < MAX_STEP_ATTEMPTS
        && shouldRetryStepError(error, normalizedError.message, normalizedError.retryable)

      orchestratorLogger.error({
        action: 'orchestrator.step.retry',
        message: shouldRetry ? 'step failed, retrying' : 'step failed, no more retry',
        errorCode: normalizedError.code,
        retryable: normalizedError.retryable,
        details: {
          stepId: baseMeta.stepId,
          action,
          attempt,
          maxAttempts: MAX_STEP_ATTEMPTS,
        },
        error: {
          name: lastError.name,
          message: lastError.message,
          stack: lastError.stack,
        },
      })

      if (!shouldRetry) {
        break
      }
      const retryDelayMs = computeRetryDelayMs(attempt)
      await wait(retryDelayMs)
    }
  }
  throw lastError!
}

export async function runScriptToStoryboardOrchestrator(
  input: ScriptToStoryboardOrchestratorInput,
): Promise<ScriptToStoryboardOrchestratorResult> {
  const { clips, novelPromotionData, promptTemplates, runStep } = input
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error('No clips found')
  }

  const totalStepCount = clips.length * 4 + 2
  const charactersLibName = (novelPromotionData.characters || []).map((c) => c.name).join(', ') || 'none'
  const locationsLibName = (novelPromotionData.locations || []).map((l) => l.name).join(', ') || 'none'
  const charactersIntroduction = buildCharactersIntroduction(novelPromotionData.characters || [])

  const phase1PromptGuardrails = [
    '[Global Storyboard Planning Guardrails]',
    '1. Do not split one continuous action into multiple near-duplicate panels.',
    '2. Adjacent panels must represent different narrative beats.',
    '3. Keep panel count compact: roughly 2-3 panels for short clips, 3-5 for medium clips, only expand when new actions appear.',
    '4. If two candidate panels share the same action, location, and emotional state, merge them into one panel.',
    '5. Prefer one opening panel that anchors both environment and protagonist position when they happen in the same time/place.',
    '6. Split panels only when there is a clear beat change: location shift, objective shift, new conflict cue, or explicit dialogue turn.',
    '7. Ignore fixed character-count heuristics (for example, 15 chars = 1 shot); narrative beats always take priority.',
    '8. Follow continuity coverage order when possible: establishing/master -> subject action -> reaction or insert.',
    '9. If a beat does not introduce new action or new information, do not add extra coverage angles.',
  ].join('\n')

  const phase3PromptGuardrails = [
    '[Global Shot Rhythm Guardrails]',
    '1. Avoid repeating the same shot_type + camera_move in adjacent panels unless the narrative beat changes clearly.',
    '2. Prefer shot diversity across adjacent panels (establishing / subject / reaction) to keep context coherent.',
    '3. If a panel only rephrases the previous panel without new information, merge or remove it.',
    '4. Dutch angle / POV are accents, not defaults: use each at most once per clip and only when source_text implies disorientation or direct subjectivity.',
    '5. Do not create objective-view and subjective-view duplicates for the same beat.',
    '6. Apply continuity editing discipline: preserve screen direction and use shot changes only when 30-degree or shot-size differences carry narrative value.',
    '7. Use re-establishing shots only when geography becomes unclear after close coverage, not as repeated filler.',
    '8. Prefer match-on-action progression over stylistic angle hopping.',
  ].join('\n')

  const phase1PanelsByClipId = new Map<string, StoryboardPanel[]>()

  const phase1Results = await Promise.all(
    clips.map(async (clip, i) => {
      const clipIndex = i + 1
      const clipContent = typeof clip.content === 'string' ? clip.content.trim() : ''
      if (!clipContent) {
        throw new Error(`Clip ${formatClipId(clip)} content is empty`)
      }
      const clipCharacters = parseClipCharacters(clip.characters)
      const filteredAppearanceList = getFilteredAppearanceList(novelPromotionData.characters || [], clipCharacters)
      const filteredFullDescription = getFilteredFullDescription(novelPromotionData.characters || [], clipCharacters)
      const clipJson = JSON.stringify(
        {
          id: clip.id,
          content: clipContent,
          characters: clipCharacters,
          location: clip.location || null,
        },
        null,
        2,
      )

      let phase1Prompt = promptTemplates.phase1PlanTemplate
        .replace('{characters_lib_name}', charactersLibName)
        .replace('{locations_lib_name}', locationsLibName)
        .replace('{characters_introduction}', charactersIntroduction)
        .replace('{characters_appearance_list}', filteredAppearanceList)
        .replace('{characters_full_description}', filteredFullDescription)
        .replace('{clip_json}', clipJson)

      const screenplay = parseScreenplay(clip.screenplay)
      if (screenplay) {
        phase1Prompt = phase1Prompt.replace('{clip_content}', '[SCREENPLAY_FORMAT]\n' + JSON.stringify(screenplay, null, 2))
      } else {
        phase1Prompt = phase1Prompt.replace('{clip_content}', clipContent)
      }
      phase1Prompt = `${phase1Prompt}\n\n${phase1PromptGuardrails}`

      const phase1Meta = withStepMeta(
        `clip_${clip.id}_phase1`,
        'progress.streamStep.storyboardPlan',
        clipIndex,
        totalStepCount,
      )
      const { parsed: planPanels } = await runStepWithRetry(
        runStep, phase1Meta, phase1Prompt, 'storyboard_phase1_plan', 2600,
        (text) => {
          const panels = parseJsonArray<StoryboardPanel>(text, `phase1:${formatClipId(clip)}`)
          if (panels.length === 0) {
            throw new Error(`Phase 1 returned empty panels for clip ${formatClipId(clip)}`)
          }
          return panels
        },
      )

      return {
        clipId: clip.id,
        planPanels,
      }
    }),
  )

  for (const result of phase1Results) {
    phase1PanelsByClipId.set(result.clipId, result.planPanels)
  }

  const clipPanels = await Promise.all(
    clips.map(async (clip, index): Promise<ClipStoryboardPanels> => {
      const clipIndex = index + 1
      const clipCharacters = parseClipCharacters(clip.characters)
      const clipLocation = clip.location || null
      const planPanels = phase1PanelsByClipId.get(clip.id) || []
      if (planPanels.length === 0) {
        throw new Error(`Missing phase1 result for clip ${formatClipId(clip)}`)
      }

      const filteredFullDescription = getFilteredFullDescription(novelPromotionData.characters || [], clipCharacters)
      const filteredLocationsDescription = getFilteredLocationsDescription(
        novelPromotionData.locations || [],
        clipLocation,
      )
      const profileSummary = buildCharacterProfileSummary(novelPromotionData.characters || [], clipCharacters)

      const phase2Meta = withStepMeta(
        `clip_${clip.id}_phase2_cinematography`,
        'progress.streamStep.cinematographyRules',
        clips.length + index * 3 + 1,
        totalStepCount,
      )
      const phase2ActingMeta = withStepMeta(
        `clip_${clip.id}_phase2_acting`,
        'progress.streamStep.actingDirection',
        clips.length + index * 3 + 2,
        totalStepCount,
      )
      const phase3Meta = withStepMeta(
        `clip_${clip.id}_phase3_detail`,
        'progress.streamStep.storyboardDetailRefine',
        clips.length + index * 3 + 3,
        totalStepCount,
      )

      const phase2Prompt = promptTemplates.phase2CinematographyTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace(/\{panel_count\}/g, String(planPanels.length))
        .replace('{locations_description}', filteredLocationsDescription)
        .replace('{characters_info}', filteredFullDescription)

      const phase2ActingPrompt = promptTemplates.phase2ActingTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace(/\{panel_count\}/g, String(planPanels.length))
        .replace('{characters_info}', filteredFullDescription)

      let phase3Prompt = promptTemplates.phase3DetailTemplate
        .replace('{panels_json}', JSON.stringify(planPanels, null, 2))
        .replace('{characters_age_gender}', filteredFullDescription)
        .replace('{characters_profile_summary}', profileSummary)
        .replace('{locations_description}', filteredLocationsDescription)
      phase3Prompt = `${phase3Prompt}\n\n${phase3PromptGuardrails}`

      const [
        { parsed: photographyRules },
        { parsed: actingDirections },
        { parsed: filteredPhase3Panels },
      ] = await Promise.all([
        runStepWithRetry(
          runStep, phase2Meta, phase2Prompt, 'storyboard_phase2_cinematography', 2400,
          (text) => parseJsonArray<PhotographyRule>(text, `phase2:${formatClipId(clip)}`),
        ),
        runStepWithRetry(
          runStep, phase2ActingMeta, phase2ActingPrompt, 'storyboard_phase2_acting', 2400,
          (text) => parseJsonArray<ActingDirection>(text, `phase2-acting:${formatClipId(clip)}`),
        ),
        runStepWithRetry(
          runStep, phase3Meta, phase3Prompt, 'storyboard_phase3_detail', 2600,
          (text) => {
            const panels = parseJsonArray<StoryboardPanel>(text, `phase3:${formatClipId(clip)}`)
            const filtered = panels.filter(
              (panel) => isMeaningfulText(panel.description)
                && isMeaningfulText(panel.location)
                && isMeaningfulText(panel.source_text),
            )
            if (filtered.length === 0) {
              throw new Error(`Phase 3 returned empty valid panels for clip ${formatClipId(clip)}`)
            }
            return filtered
          },
        ),
      ])

      const optimizedPhase3Panels = optimizePhase3Panels({
        panels: filteredPhase3Panels,
        clipContent: typeof clip.content === 'string' ? clip.content : '',
      })

      return {
        clipId: clip.id,
        clipIndex,
        finalPanels: mergePanelsWithRules({
          finalPanels: optimizedPhase3Panels,
          photographyRules,
          actingDirections,
        }),
      }
    }),
  )

  const totalPanelCount = clipPanels.reduce((sum, item) => sum + item.finalPanels.length, 0)
  return {
    clipPanels,
    summary: {
      clipCount: clips.length,
      totalPanelCount,
      totalStepCount,
    },
  }
}
