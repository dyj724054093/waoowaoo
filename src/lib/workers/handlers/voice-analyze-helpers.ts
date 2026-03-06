export interface StoryboardPanelLike {
  panelIndex: number
  srtSegment: string | null
  description: string | null
  characters: string | null
}

export interface StoryboardLike {
  id: string
  panels: StoryboardPanelLike[]
}

export interface VoiceLineMatchedPanel {
  storyboardId?: string
  panelIndex?: number
}

export type VoiceLineType = 'dialogue' | 'narration' | 'inner_thought' | 'quoted_speech' | 'unknown'
export type VoiceSpeakerKind = 'character' | 'narrator' | 'unknown'

export interface VoiceLinePayload {
  lineIndex?: number
  speaker?: string
  speakerNameRaw?: string
  speakerKind?: VoiceSpeakerKind
  lineType?: VoiceLineType
  speakerConfidence?: number
  content?: string
  emotionStrength?: number
  matchedPanel?: VoiceLineMatchedPanel | null
}

const VOICE_LINE_TYPES = new Set<VoiceLineType>([
  'dialogue',
  'narration',
  'inner_thought',
  'quoted_speech',
  'unknown',
])

const VOICE_SPEAKER_KINDS = new Set<VoiceSpeakerKind>([
  'character',
  'narrator',
  'unknown',
])

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text ? text : undefined
}

function normalizeVoiceLineType(value: unknown): VoiceLineType {
  if (typeof value === 'string' && VOICE_LINE_TYPES.has(value as VoiceLineType)) {
    return value as VoiceLineType
  }
  return 'unknown'
}

function normalizeVoiceSpeakerKind(value: unknown): VoiceSpeakerKind {
  if (typeof value === 'string' && VOICE_SPEAKER_KINDS.has(value as VoiceSpeakerKind)) {
    return value as VoiceSpeakerKind
  }
  return 'unknown'
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}

function parseVoiceLinePayload(value: unknown): VoiceLinePayload | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const matchedPanelRaw =
    record.matchedPanel && typeof record.matchedPanel === 'object'
      ? (record.matchedPanel as Record<string, unknown>)
      : null
  const speaker = normalizeText(record.speaker)
  const speakerNameRaw = normalizeText(record.speakerNameRaw) || speaker

  return {
    lineIndex: typeof record.lineIndex === 'number' ? record.lineIndex : undefined,
    speaker: speaker || speakerNameRaw,
    speakerNameRaw,
    speakerKind: normalizeVoiceSpeakerKind(record.speakerKind),
    lineType: normalizeVoiceLineType(record.lineType),
    speakerConfidence: normalizeConfidence(record.speakerConfidence),
    content: typeof record.content === 'string' ? record.content : undefined,
    emotionStrength: typeof record.emotionStrength === 'number' ? record.emotionStrength : undefined,
    matchedPanel: matchedPanelRaw
      ? {
          storyboardId: typeof matchedPanelRaw.storyboardId === 'string' ? matchedPanelRaw.storyboardId : undefined,
          panelIndex: typeof matchedPanelRaw.panelIndex === 'number' ? matchedPanelRaw.panelIndex : undefined,
        }
      : null,
  }
}

export function buildStoryboardJson(storyboards: StoryboardLike[]): string {
  const panelsData: Array<{
    storyboardId: string
    panelIndex: number
    text_segment: string
    description: string
    characters: string
  }> = []

  for (const sb of storyboards) {
    const panels = sb.panels || []
    for (const panel of panels) {
      panelsData.push({
        storyboardId: sb.id,
        panelIndex: panel.panelIndex,
        text_segment: panel.srtSegment || '',
        description: panel.description || '',
        characters: panel.characters || '',
      })
    }
  }

  if (panelsData.length === 0) {
    return '?????'
  }

  return JSON.stringify(panelsData, null, 2)
}

export function parseVoiceLinesJson(responseText: string): VoiceLinePayload[] {
  let jsonText = responseText.trim()
  jsonText = jsonText.replace(/^```json\s*/i, '')
  jsonText = jsonText.replace(/^```\s*/, '')
  jsonText = jsonText.replace(/\s*```$/, '')

  const firstBracket = jsonText.indexOf('[')
  const lastBracket = jsonText.lastIndexOf(']')
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    jsonText = jsonText.substring(firstBracket, lastBracket + 1)
  }

  const parsed = JSON.parse(jsonText)
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('Invalid voice lines data structure')
  }
  const voiceLines = parsed
    .map((item) => parseVoiceLinePayload(item))
    .filter((item): item is VoiceLinePayload => Boolean(item))
  if (voiceLines.length === 0) {
    throw new Error('Invalid voice lines data structure')
  }
  return voiceLines
}
