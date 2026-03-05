import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  project: { findUnique: vi.fn() },
  userPreference: { findUnique: vi.fn(async () => ({ analysisModel: null })) },
  novelPromotionProject: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
  novelPromotionEpisode: { findFirst: vi.fn() },
  novelPromotionCharacter: {
    create: vi.fn(async () => ({ id: 'char-new-1' })),
    update: vi.fn(async () => ({})),
  },
  novelPromotionLocation: { create: vi.fn(async () => ({ id: 'loc-new-1' })) },
  locationImage: { create: vi.fn(async () => ({})) },
}))

const aiRuntimeMock = vi.hoisted(() => ({
  executeAiTextStep: vi.fn(),
}))

const workerMock = vi.hoisted(() => ({
  reportTaskProgress: vi.fn(async () => undefined),
  assertTaskActive: vi.fn(async () => undefined),
}))

const promptI18nMock = vi.hoisted(() => ({
  PROMPT_IDS: {
    NP_AGENT_CHARACTER_PROFILE: 'char',
    NP_SELECT_LOCATION: 'loc',
    NP_SELECT_LOCATION_RECALL: 'loc_recall',
  },
  buildPrompt: vi.fn(({ promptId }: { promptId: string }) => `analysis-prompt:${promptId}`),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ai-runtime', () => ({ executeAiTextStep: aiRuntimeMock.executeAiTextStep }))
vi.mock('@/lib/llm-observe/internal-stream-context', () => ({
  withInternalLLMStreamCallbacks: vi.fn(async (_callbacks: unknown, fn: () => Promise<unknown>) => await fn()),
}))
vi.mock('@/lib/constants', () => ({
  getArtStylePrompt: vi.fn(() => 'cinematic style'),
  removeLocationPromptSuffix: vi.fn((text: string) => text.replace(' [SUFFIX]', '')),
}))
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: workerMock.reportTaskProgress }))
vi.mock('@/lib/workers/utils', () => ({ assertTaskActive: workerMock.assertTaskActive }))
vi.mock('@/lib/workers/handlers/llm-stream', () => ({
  createWorkerLLMStreamContext: vi.fn(() => ({ streamRunId: 'run-1', nextSeqByStepLane: {} })),
  createWorkerLLMStreamCallbacks: vi.fn(() => ({
    onStage: vi.fn(),
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    flush: vi.fn(async () => undefined),
  })),
}))
vi.mock('@/lib/prompt-i18n', () => promptI18nMock)

import { handleAnalyzeNovelTask } from '@/lib/workers/handlers/analyze-novel'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-analyze-novel-1',
      type: TASK_TYPE.ANALYZE_NOVEL,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionProject',
      targetId: 'np-project-1',
      payload: {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker analyze-novel behavior', () => {
  let mockCharacterResponseText = ''
  let mockLocationResponseText = ''
  let mockLocationRecallResponseText = ''

  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.project.findUnique.mockResolvedValue({
      id: 'project-1',
      mode: 'novel-promotion',
    })

    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: 'global setup',
      characters: [{ id: 'char-existing', name: 'existing_character', aliases: '[]' }],
      locations: [{ id: 'loc-existing', name: 'existing_location', summary: 'old' }],
    })

    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValue({
      novelText: 'episode content',
    })

    mockCharacterResponseText = JSON.stringify({
      characters: [
        {
          name: 'new_character',
          aliases: ['alias_a'],
          role_level: 'main',
          personality_tags: ['calm'],
          visual_keywords: ['black_hair'],
        },
      ],
    })

    mockLocationResponseText = JSON.stringify({
      locations: [
        {
          name: 'new_location',
          summary: 'rainy_street',
          descriptions: ['rainy_street [SUFFIX]'],
        },
      ],
    })

    mockLocationRecallResponseText = JSON.stringify({ locations: [] })

    aiRuntimeMock.executeAiTextStep.mockImplementation(async (input: { action?: string }) => {
      if (input.action === 'analyze_characters') return { text: mockCharacterResponseText }
      if (input.action === 'analyze_locations') return { text: mockLocationResponseText }
      if (input.action === 'analyze_locations_recall') return { text: mockLocationRecallResponseText }
      return { text: '{}' }
    })
  })

  it('no global text and no episode text -> explicit error', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: '',
      characters: [],
      locations: [],
    })
    prismaMock.novelPromotionEpisode.findFirst.mockResolvedValueOnce({ novelText: '' })

    await expect(handleAnalyzeNovelTask(buildJob())).rejects.toThrow(/\u8bf7\u5148/)
  })

  it('success path -> creates character/location and persists cleaned location descriptions', async () => {
    const result = await handleAnalyzeNovelTask(buildJob())

    expect(result).toEqual({
      success: true,
      characters: [{ id: 'char-new-1' }],
      locations: [{ id: 'loc-new-1' }],
      characterCount: 1,
      locationCount: 1,
    })

    expect(aiRuntimeMock.executeAiTextStep).toHaveBeenCalledTimes(2)

    expect(prismaMock.novelPromotionCharacter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          novelPromotionProjectId: 'np-project-1',
          name: 'new_character',
          aliases: JSON.stringify(['alias_a']),
        }),
      }),
    )

    expect(prismaMock.novelPromotionLocation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          novelPromotionProjectId: 'np-project-1',
          name: 'new_location',
          summary: 'rainy_street',
        }),
      }),
    )

    expect(prismaMock.locationImage.create).toHaveBeenCalledWith({
      data: {
        locationId: 'loc-new-1',
        imageIndex: 0,
        description: 'rainy_street',
      },
    })

    expect(prismaMock.novelPromotionProject.update).toHaveBeenCalledWith({
      where: { id: 'np-project-1' },
      data: { artStylePrompt: 'cinematic style' },
    })

    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(
      expect.anything(),
      60,
      expect.objectContaining({
        stepId: 'analyze_characters',
        done: true,
        output: expect.stringContaining('"characters"'),
      }),
    )

    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(
      expect.anything(),
      70,
      expect.objectContaining({
        stepId: 'analyze_locations',
        done: true,
        output: expect.stringContaining('"locations"'),
      }),
    )
  })

  it('retries retryable analyze step failures', async () => {
    let characterAttempts = 0
    aiRuntimeMock.executeAiTextStep.mockImplementation(async (input: { action?: string }) => {
      if (input.action === 'analyze_characters') {
        characterAttempts += 1
        if (characterAttempts === 1) {
          const error = Object.assign(new Error('LLM_EMPTY_RESPONSE: temporary upstream error'), {
            retryable: true,
            code: 'EMPTY_RESPONSE',
          })
          throw error
        }
        return { text: mockCharacterResponseText }
      }
      if (input.action === 'analyze_locations') return { text: mockLocationResponseText }
      if (input.action === 'analyze_locations_recall') return { text: mockLocationRecallResponseText }
      return { text: '{}' }
    })

    const result = await handleAnalyzeNovelTask(buildJob())

    expect(result.success).toBe(true)
    expect(characterAttempts).toBe(2)

    const characterCalls = aiRuntimeMock.executeAiTextStep.mock.calls
      .map((call) => call[0] as { action?: string; meta?: { stepAttempt?: number } })
      .filter((input) => input.action === 'analyze_characters')
      .map((input) => input.meta?.stepAttempt)

    expect(characterCalls).toEqual([1, 2])
  })
  it('long narrative with too few locations -> runs recall and merges new spatial layers', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: 'narrative '.repeat(400),
      characters: [],
      locations: [{ id: 'loc-existing', name: 'existing_location', summary: 'old' }],
    })

    prismaMock.novelPromotionLocation.create
      .mockResolvedValueOnce({ id: 'loc-new-1' })
      .mockResolvedValueOnce({ id: 'loc-new-2' })

    mockCharacterResponseText = JSON.stringify({ characters: [] })
    mockLocationResponseText = JSON.stringify({
      locations: [
        {
          name: 'quarantine_hall',
          summary: 'inside_main_area',
          descriptions: ['quarantine_hall [SUFFIX]'],
        },
      ],
    })
    mockLocationRecallResponseText = JSON.stringify({
      locations: [
        {
          name: 'quarantine_outer_buffer',
          summary: 'outside_waiting_area',
          descriptions: ['quarantine_outer_buffer [SUFFIX]'],
        },
        {
          name: 'quarantine_hall/hall',
          summary: 'alias_of_first_round_location',
          descriptions: ['quarantine_hall [SUFFIX]'],
        },
      ],
    })

    const result = await handleAnalyzeNovelTask(buildJob())

    expect(aiRuntimeMock.executeAiTextStep).toHaveBeenCalledTimes(3)
    expect(promptI18nMock.buildPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        promptId: 'loc_recall',
        variables: expect.objectContaining({
          existing_locations_json: expect.any(String),
        }),
      }),
    )

    expect(prismaMock.novelPromotionLocation.create).toHaveBeenCalledTimes(2)
    expect(prismaMock.novelPromotionLocation.create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'quarantine_hall',
        }),
      }),
    )
    expect(prismaMock.novelPromotionLocation.create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'quarantine_outer_buffer',
        }),
      }),
    )

    expect(workerMock.reportTaskProgress).toHaveBeenCalledWith(
      expect.anything(),
      73,
      expect.objectContaining({
        stepId: 'analyze_locations_recall',
        done: true,
      }),
    )

    expect(result.locationCount).toBe(2)
  })

  it('adds layered station locations when text has strong spatial cues', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: 'At the outer perimeter of the quarantine station, the scout observes the inner hall, then checks the back gate and the west fence line.',
      characters: [],
      locations: [],
    })

    mockCharacterResponseText = JSON.stringify({ characters: [] })
    mockLocationResponseText = JSON.stringify({
      locations: [
        {
          name: 'quarantine_station',
          summary: 'core station area',
          descriptions: ['quarantine_station [SUFFIX]'],
        },
      ],
    })
    mockLocationRecallResponseText = JSON.stringify({ locations: [] })

    const result = await handleAnalyzeNovelTask(buildJob())

    const createdNames = prismaMock.novelPromotionLocation.create.mock.calls.map(
      (call) => (call[0] as { data: { name: string } }).data.name,
    )

    expect(createdNames).toEqual(
      expect.arrayContaining([
        'quarantine_station',
        'quarantine_station_outer_perimeter',
        'quarantine_station_inner_core',
        'quarantine_station_gate_zone',
        'quarantine_station_fence_line',
      ]),
    )
    expect(result.characterCount).toBe(0)
    expect(result.locationCount).toBeGreaterThanOrEqual(5)
  })


  it('adds layered station locations for english spatial cues', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: 'The team waits outside the checkpoint station, enters the interior hall, then falls back to the gate and east fence under alarm.',
      characters: [],
      locations: [],
    })

    mockCharacterResponseText = JSON.stringify({ characters: [] })
    mockLocationResponseText = JSON.stringify({
      locations: [
        {
          name: 'checkpoint_station',
          summary: 'core station area',
          descriptions: ['checkpoint_station [SUFFIX]'],
        },
      ],
    })
    mockLocationRecallResponseText = JSON.stringify({ locations: [] })

    await handleAnalyzeNovelTask(buildJob())

    const createdNames = prismaMock.novelPromotionLocation.create.mock.calls.map(
      (call) => (call[0] as { data: { name: string } }).data.name,
    )

    expect(createdNames).toEqual(
      expect.arrayContaining([
        'checkpoint_station_outer_perimeter',
        'checkpoint_station_inner_core',
        'checkpoint_station_gate_zone',
        'checkpoint_station_fence_line',
      ]),
    )
  })

  it('does not add layered supplements for non-hub locations', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: 'She crosses the apartment living room and kitchen before stopping at the balcony window.',
      characters: [],
      locations: [],
    })

    mockCharacterResponseText = JSON.stringify({ characters: [] })
    mockLocationResponseText = JSON.stringify({
      locations: [
        {
          name: 'old_apartment',
          summary: 'small apartment interior',
          descriptions: ['old_apartment [SUFFIX]'],
        },
      ],
    })
    mockLocationRecallResponseText = JSON.stringify({ locations: [] })

    const result = await handleAnalyzeNovelTask(buildJob())

    const createdNames = prismaMock.novelPromotionLocation.create.mock.calls.map(
      (call) => (call[0] as { data: { name: string } }).data.name,
    )

    expect(createdNames).toEqual(['old_apartment'])
    expect(result.locationCount).toBe(1)
  })


  it('does not add station layers when no spatial-layer cues are present', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: 'The quarantine station stands silent under rain, and the team only reports status.',
      characters: [],
      locations: [],
    })

    mockCharacterResponseText = JSON.stringify({ characters: [] })
    mockLocationResponseText = JSON.stringify({
      locations: [
        {
          name: 'quarantine_station',
          summary: 'single station mention',
          descriptions: ['quarantine_station [SUFFIX]'],
        },
      ],
    })
    mockLocationRecallResponseText = JSON.stringify({ locations: [] })

    const result = await handleAnalyzeNovelTask(buildJob())

    const createdNames = prismaMock.novelPromotionLocation.create.mock.calls.map(
      (call) => (call[0] as { data: { name: string } }).data.name,
    )

    expect(createdNames).toEqual(['quarantine_station'])
    expect(result.locationCount).toBe(1)
  })

  it('adds layered zones for dock hub with perimeter and gate cues', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: 'At dock station outer perimeter, the squad checks the gate while movement appears along the west fence.',
      characters: [],
      locations: [],
    })

    mockCharacterResponseText = JSON.stringify({ characters: [] })
    mockLocationResponseText = JSON.stringify({
      locations: [
        {
          name: 'dock_station',
          summary: 'dock command node',
          descriptions: ['dock_station [SUFFIX]'],
        },
      ],
    })
    mockLocationRecallResponseText = JSON.stringify({ locations: [] })

    await handleAnalyzeNovelTask(buildJob())

    const createdNames = prismaMock.novelPromotionLocation.create.mock.calls.map(
      (call) => (call[0] as { data: { name: string } }).data.name,
    )

    expect(createdNames).toEqual(
      expect.arrayContaining([
        'dock_station_outer_perimeter',
        'dock_station_gate_zone',
        'dock_station_fence_line',
      ]),
    )
  })


  it('adds layered station locations for chinese hub naming', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: 'Scout waits outside checkpoint station, then moves into the inner hall, hears noise near back gate, and spots patrol by west fence.',
      characters: [],
      locations: [],
    })

    mockCharacterResponseText = JSON.stringify({ characters: [] })
    mockLocationResponseText = JSON.stringify({
      locations: [
        {
          name: '\u7b2c\u4e03\u7801\u5934\u68c0\u75ab\u7ad9',
          summary: '\u6838\u5fc3\u68c0\u75ab\u8bbe\u65bd',
          descriptions: ['\u7b2c\u4e03\u7801\u5934\u68c0\u75ab\u7ad9 [SUFFIX]'],
        },
      ],
    })
    mockLocationRecallResponseText = JSON.stringify({ locations: [] })

    await handleAnalyzeNovelTask(buildJob())

    const createdNames = prismaMock.novelPromotionLocation.create.mock.calls.map(
      (call) => (call[0] as { data: { name: string } }).data.name,
    )

    expect(createdNames).toEqual(
      expect.arrayContaining([
        '\u7b2c\u4e03\u7801\u5934\u68c0\u75ab\u7ad9_\u5916\u56f4',
        '\u7b2c\u4e03\u7801\u5934\u68c0\u75ab\u7ad9_\u5185\u90e8',
        '\u7b2c\u4e03\u7801\u5934\u68c0\u75ab\u7ad9_\u51fa\u5165\u53e3',
        '\u7b2c\u4e03\u7801\u5934\u68c0\u75ab\u7ad9_\u56f4\u680f\u7ebf',
      ]),
    )
  })

  it('does not add layered supplements for palace and garden narrative', async () => {
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      id: 'np-project-1',
      analysisModel: 'llm::analysis-1',
      artStyle: 'cinematic',
      globalAssetText: '??????????????????????????',
      characters: [],
      locations: [],
    })

    mockCharacterResponseText = JSON.stringify({ characters: [] })
    mockLocationResponseText = JSON.stringify({
      locations: [
        {
          name: '????',
          summary: '????',
          descriptions: ['???? [SUFFIX]'],
        },
        {
          name: '???',
          summary: '???????',
          descriptions: ['??? [SUFFIX]'],
        },
      ],
    })
    mockLocationRecallResponseText = JSON.stringify({ locations: [] })

    const result = await handleAnalyzeNovelTask(buildJob())

    const createdNames = prismaMock.novelPromotionLocation.create.mock.calls.map(
      (call) => (call[0] as { data: { name: string } }).data.name,
    )

    expect(createdNames).toEqual(['????', '???'])
    expect(result.locationCount).toBe(2)
  })

})
