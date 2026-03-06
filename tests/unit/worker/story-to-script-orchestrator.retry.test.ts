import { describe, expect, it, vi } from 'vitest'
import { runStoryToScriptOrchestrator } from '@/lib/novel-promotion/story-to-script/orchestrator'

describe('story-to-script orchestrator retry', () => {
  it('retries retryable step failure up to 3 attempts', async () => {
    const actionCalls = new Map<string, number>()
    const characterMetas: Array<{ stepId: string; stepAttempt?: number }> = []
    const runStep = vi.fn(async (meta, _prompt, action: string) => {
      actionCalls.set(action, (actionCalls.get(action) || 0) + 1)

      if (action === 'analyze_characters') {
        characterMetas.push({ stepId: meta.stepId, stepAttempt: meta.stepAttempt })
        const count = actionCalls.get(action) || 0
        if (count < 3) {
          throw new TypeError('terminated')
        }
        return { text: JSON.stringify({ characters: [{ name: '甲', introduction: '人物介绍' }] }), reasoning: '' }
      }
      if (action === 'analyze_locations') {
        return { text: JSON.stringify({ locations: [{ name: '地点A' }] }), reasoning: '' }
      }
      if (action === 'split_clips') {
        return {
          text: JSON.stringify([
            {
              start: '甲在门口',
              end: '乙回答',
              summary: '片段摘要',
              location: '地点A',
              characters: ['甲'],
            },
          ]),
          reasoning: '',
        }
      }
      return { text: JSON.stringify({ scenes: [{ id: 1 }] }), reasoning: '' }
    })

    const result = await runStoryToScriptOrchestrator({
      content: '甲在门口。乙回答。',
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '{input} {characters_lib_name} {characters_lib_info}',
        locationPromptTemplate: '{input} {locations_lib_name}',
        clipPromptTemplate: '{input} {locations_lib_name} {characters_lib_name} {characters_introduction}',
        screenplayPromptTemplate: '{clip_content} {locations_lib_name} {characters_lib_name} {characters_introduction} {clip_id}',
      },
      runStep,
    })

    expect(result.summary.clipCount).toBe(1)
    expect(actionCalls.get('analyze_characters')).toBe(3)
    expect(characterMetas).toEqual([
      { stepId: 'analyze_characters', stepAttempt: undefined },
      { stepId: 'analyze_characters', stepAttempt: 2 },
      { stepId: 'analyze_characters', stepAttempt: 3 },
    ])
  })

  it('does not retry non-retryable failures', async () => {
    const actionCalls = new Map<string, number>()
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      actionCalls.set(action, (actionCalls.get(action) || 0) + 1)
      if (action === 'analyze_characters') {
        throw new Error('SENSITIVE_CONTENT: blocked')
      }
      return { text: JSON.stringify({ locations: [{ name: '地点A' }] }), reasoning: '' }
    })

    await expect(
      runStoryToScriptOrchestrator({
        content: '甲在门口。乙回答。',
        baseCharacters: [],
        baseLocations: [],
        baseCharacterIntroductions: [],
        promptTemplates: {
          characterPromptTemplate: '{input} {characters_lib_name} {characters_lib_info}',
          locationPromptTemplate: '{input} {locations_lib_name}',
          clipPromptTemplate: '{input} {locations_lib_name} {characters_lib_name} {characters_introduction}',
          screenplayPromptTemplate: '{clip_content} {locations_lib_name} {characters_lib_name} {characters_introduction} {clip_id}',
        },
        runStep,
      }),
    ).rejects.toThrow('SENSITIVE_CONTENT')

    expect(actionCalls.get('analyze_characters')).toBe(1)
  })

  it('adds station layered locations for story_to_script when text has spatial cues', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'analyze_characters') {
        return { text: JSON.stringify({ characters: [{ name: 'LinYu', introduction: 'hero' }] }), reasoning: '' }
      }
      if (action === 'analyze_locations') {
        return {
          text: JSON.stringify({
            locations: [{ name: 'quarantine_station_hall', summary: 'main hall' }],
          }),
          reasoning: '',
        }
      }
      if (action === 'split_clips') {
        return {
          text: JSON.stringify([
            {
              start: 'Night patrol moves outside the checkpoint station.',
              end: 'He enters from the back gate near the west fence.',
              summary: 'entry beat',
              location: 'quarantine_station_hall',
              characters: ['LinYu'],
            },
          ]),
          reasoning: '',
        }
      }
      return { text: JSON.stringify({ scenes: [{ id: 1 }] }), reasoning: '' }
    })

    const result = await runStoryToScriptOrchestrator({
      content: 'Night patrol moves outside the checkpoint station. He enters from the back gate near the west fence.',
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '{input} {characters_lib_name} {characters_lib_info}',
        locationPromptTemplate: '{input} {locations_lib_name}',
        clipPromptTemplate: '{input} {locations_lib_name} {characters_lib_name} {characters_introduction}',
        screenplayPromptTemplate: '{clip_content} {locations_lib_name} {characters_lib_name} {characters_introduction} {clip_id}',
      },
      runStep,
    })

    const names = result.analyzedLocations.map((item) => String(item.name))
    expect(names).toEqual(
      expect.arrayContaining([
        'quarantine_station_hall',
        'quarantine_station_hall_outer_perimeter',
        'quarantine_station_hall_gate_zone',
        'quarantine_station_hall_fence_line',
      ]),
    )
    expect(result.locationsLibName).toContain('quarantine_station_hall_outer_perimeter')
  })

  it('does not add layered locations for non-hub places in story_to_script', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'analyze_characters') {
        return { text: JSON.stringify({ characters: [{ name: 'LinYu', introduction: 'hero' }] }), reasoning: '' }
      }
      if (action === 'analyze_locations') {
        return {
          text: JSON.stringify({
            locations: [{ name: 'old_apartment', summary: 'small living space' }],
          }),
          reasoning: '',
        }
      }
      if (action === 'split_clips') {
        return {
          text: JSON.stringify([
            {
              start: 'She waits outside the old apartment.',
              end: 'She checks the back gate and fence in silence.',
              summary: 'apartment beat',
              location: 'old_apartment',
              characters: ['LinYu'],
            },
          ]),
          reasoning: '',
        }
      }
      return { text: JSON.stringify({ scenes: [{ id: 1 }] }), reasoning: '' }
    })

    const result = await runStoryToScriptOrchestrator({
      content: 'She waits outside the old apartment. She checks the back gate and fence in silence.',
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '{input} {characters_lib_name} {characters_lib_info}',
        locationPromptTemplate: '{input} {locations_lib_name}',
        clipPromptTemplate: '{input} {locations_lib_name} {characters_lib_name} {characters_introduction}',
        screenplayPromptTemplate: '{clip_content} {locations_lib_name} {characters_lib_name} {characters_introduction} {clip_id}',
      },
      runStep,
    })

    const names = result.analyzedLocations.map((item) => String(item.name))
    expect(names).toEqual(['old_apartment'])
  })

  it('adds outer perimeter when only gate or fence cues are present', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'analyze_characters') {
        return { text: JSON.stringify({ characters: [{ name: 'LinYu', introduction: 'hero' }] }), reasoning: '' }
      }
      if (action === 'analyze_locations') {
        return {
          text: JSON.stringify({
            locations: [{ name: 'checkpoint_station_hall', summary: 'main hall' }],
          }),
          reasoning: '',
        }
      }
      if (action === 'split_clips') {
        return {
          text: JSON.stringify([
            {
              start: 'He waits in silence near the checkpoint.',
              end: 'He moves at the back gate beside the west fence.',
              summary: 'gate patrol beat',
              location: 'checkpoint_station_hall',
              characters: ['LinYu'],
            },
          ]),
          reasoning: '',
        }
      }
      return { text: JSON.stringify({ scenes: [{ id: 1 }] }), reasoning: '' }
    })

    const result = await runStoryToScriptOrchestrator({
      content: 'He waits in silence near the checkpoint. He moves at the back gate beside the west fence.',
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '{input} {characters_lib_name} {characters_lib_info}',
        locationPromptTemplate: '{input} {locations_lib_name}',
        clipPromptTemplate: '{input} {locations_lib_name} {characters_lib_name} {characters_introduction}',
        screenplayPromptTemplate: '{clip_content} {locations_lib_name} {characters_lib_name} {characters_introduction} {clip_id}',
      },
      runStep,
    })

    const names = result.analyzedLocations.map((item) => String(item.name))
    expect(names).toEqual(
      expect.arrayContaining([
        'checkpoint_station_hall_outer_perimeter',
        'checkpoint_station_hall_gate_zone',
        'checkpoint_station_hall_fence_line',
      ]),
    )
  })

  it('normalizes Chinese hub base and remaps clip location by fence cue', async () => {
    const runStep = vi.fn(async (_meta, _prompt, action: string) => {
      if (action === 'analyze_characters') {
        return { text: JSON.stringify({ characters: [{ name: 'LinYu', introduction: 'hero' }] }), reasoning: '' }
      }
      if (action === 'analyze_locations') {
        return {
          text: JSON.stringify({
            locations: [{ name: '\u68c0\u75ab\u7ad9\u5927\u5385_\u591c\u95f4', summary: 'inside hall' }],
          }),
          reasoning: '',
        }
      }
      if (action === 'split_clips') {
        return {
          text: JSON.stringify([
            {
              start: 'He stays low near the checkpoint hall.',
              end: 'He turns to the back gate by the west fence.',
              summary: 'fence beat',
              location: '\u68c0\u75ab\u7ad9\u5927\u5385_\u591c\u95f4',
              characters: ['LinYu'],
            },
          ]),
          reasoning: '',
        }
      }
      return { text: JSON.stringify({ scenes: [{ id: 1 }] }), reasoning: '' }
    })

    const result = await runStoryToScriptOrchestrator({
      content: 'He stays low near the checkpoint hall. He turns to the back gate by the west fence.',
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '{input} {characters_lib_name} {characters_lib_info}',
        locationPromptTemplate: '{input} {locations_lib_name}',
        clipPromptTemplate: '{input} {locations_lib_name} {characters_lib_name} {characters_introduction}',
        screenplayPromptTemplate: '{clip_content} {locations_lib_name} {characters_lib_name} {characters_introduction} {clip_id}',
      },
      runStep,
    })

    const names = result.analyzedLocations.map((item) => String(item.name))
    expect(names).toEqual(
      expect.arrayContaining([
        '\u68c0\u75ab\u7ad9_\u5916\u56f4',
        '\u68c0\u75ab\u7ad9_\u51fa\u5165\u53e3',
        '\u68c0\u75ab\u7ad9_\u56f4\u680f\u7ebf',
      ]),
    )
    expect(result.clipList[0]?.location).toBe('\u68c0\u75ab\u7ad9_\u56f4\u680f\u7ebf')
  })


})

describe('story-to-script orchestrator recall fallback', () => {
  it('runs location recall when first-pass locations are empty', async () => {
    const actionCalls: string[] = []
    const runStep = vi.fn(async (_meta, prompt, action: string) => {
      actionCalls.push(action)

      if (action === 'analyze_characters') {
        return { text: JSON.stringify({ characters: [{ name: 'LinYu', introduction: 'hero' }] }), reasoning: '' }
      }
      if (action === 'analyze_locations') {
        return { text: JSON.stringify({ locations: [] }), reasoning: '' }
      }
      if (action === 'analyze_locations_recall') {
        expect(String(prompt)).toContain('[]')
        return {
          text: JSON.stringify({
            locations: [{ name: '药房_夜间', summary: '检疫站内部药房' }],
          }),
          reasoning: '',
        }
      }
      if (action === 'split_clips') {
        return {
          text: JSON.stringify([
            {
              start: '林屿停在药房门口',
              end: '沈昭在东门低声确认',
              summary: '药房潜入',
              location: '药房_夜间',
              characters: ['LinYu'],
            },
          ]),
          reasoning: '',
        }
      }
      return { text: JSON.stringify({ scenes: [{ id: 1 }] }), reasoning: '' }
    })

    const result = await runStoryToScriptOrchestrator({
      content: '林屿停在药房门口。沈昭在东门低声确认。',
      baseCharacters: [],
      baseLocations: [],
      baseCharacterIntroductions: [],
      promptTemplates: {
        characterPromptTemplate: '{input} {characters_lib_name} {characters_lib_info}',
        locationPromptTemplate: '{input} {locations_lib_name}',
        locationRecallPromptTemplate: '{input} {locations_lib_name} {existing_locations_json}',
        clipPromptTemplate: '{input} {locations_lib_name} {characters_lib_name} {characters_introduction}',
        screenplayPromptTemplate: '{clip_content} {locations_lib_name} {characters_lib_name} {characters_introduction} {clip_id}',
      },
      runStep,
    })

    expect(actionCalls).toContain('analyze_locations_recall')
    const names = result.analyzedLocations.map((item) => String(item.name))
    expect(names).toContain('药房_夜间')
    expect(result.locationsLibName).toContain('药房_夜间')
  })
})
