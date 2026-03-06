import { describe, expect, it } from 'vitest'
import { parseVoiceLinesJson } from '@/lib/workers/handlers/voice-analyze-helpers'

describe('parseVoiceLinesJson', () => {
  it('parses semantic voice line fields from structured payload', () => {
    const result = parseVoiceLinesJson(`[
      {
        "lineIndex": 1,
        "speaker": "Hero",
        "speakerNameRaw": "Hero",
        "speakerKind": "character",
        "lineType": "dialogue",
        "speakerConfidence": 0.82,
        "content": "We need to move now.",
        "emotionStrength": 0.3,
        "matchedPanel": {
          "storyboardId": "storyboard-1",
          "panelIndex": 0
        }
      }
    ]`)

    expect(result).toEqual([
      {
        lineIndex: 1,
        speaker: 'Hero',
        speakerNameRaw: 'Hero',
        speakerKind: 'character',
        lineType: 'dialogue',
        speakerConfidence: 0.82,
        content: 'We need to move now.',
        emotionStrength: 0.3,
        matchedPanel: {
          storyboardId: 'storyboard-1',
          panelIndex: 0,
        },
      },
    ])
  })

  it('falls back from legacy speaker and defaults semantic fields conservatively', () => {
    const result = parseVoiceLinesJson(`[
      {
        "lineIndex": 2,
        "speaker": "Narrator",
        "content": "Rain covered the street.",
        "emotionStrength": 0.2
      }
    ]`)

    expect(result).toEqual([
      {
        lineIndex: 2,
        speaker: 'Narrator',
        speakerNameRaw: 'Narrator',
        speakerKind: 'unknown',
        lineType: 'unknown',
        speakerConfidence: 0,
        content: 'Rain covered the street.',
        emotionStrength: 0.2,
        matchedPanel: null,
      },
    ])
  })
})
