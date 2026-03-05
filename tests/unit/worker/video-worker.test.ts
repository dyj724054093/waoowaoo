import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type WorkerProcessor = (job: Job<TaskJobData>) => Promise<unknown>

type PanelRow = {
  id: string
  storyboardId: string
  panelIndex: number
  videoUrl: string | null
  imageUrl: string | null
  videoPrompt: string | null
  description: string | null
  firstLastFramePrompt: string | null
  shotType: string | null
  cameraMove: string | null
  location: string | null
  sceneType: string | null
  characters: string | null
  srtSegment: string | null
}

const workerState = vi.hoisted(() => ({
  processor: null as WorkerProcessor | null,
}))

const reportTaskProgressMock = vi.hoisted(() => vi.fn(async () => undefined))
const withTaskLifecycleMock = vi.hoisted(() =>
  vi.fn(async (job: Job<TaskJobData>, handler: WorkerProcessor) => await handler(job)),
)

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ videoRatio: '16:9' })),
  resolveLipSyncVideoSource: vi.fn(async () => 'https://provider.example/lipsync.mp4'),
  resolveVideoSourceFromGeneration: vi.fn(async () => ({ url: 'https://provider.example/video.mp4' })),
  toSignedUrlIfCos: vi.fn((url: string | null) => (url ? `https://signed.example/${url}` : null)),
  uploadVideoSourceToCos: vi.fn(async () => 'cos/lip-sync/video.mp4'),
}))

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(async () => undefined),
  },
  novelPromotionProject: {
    findUnique: vi.fn(),
  },
  novelPromotionStoryboard: {
    findUnique: vi.fn(),
  },
  novelPromotionVoiceLine: {
    findUnique: vi.fn(),
  },
}))

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string) {
      void name
    }

    async add() {
      return { id: 'job-1' }
    }

    async getJob() {
      return null
    }
  },
  Worker: class {
    constructor(name: string, processor: WorkerProcessor) {
      void name
      workerState.processor = processor
    }
  },
}))

vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: reportTaskProgressMock,
  withTaskLifecycle: withTaskLifecycleMock,
}))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/media/outbound-image', () => ({
  normalizeToBase64ForGeneration: vi.fn(async (input: string) => input),
}))
vi.mock('@/lib/model-capabilities/lookup', () => ({
  resolveBuiltinCapabilitiesByModelKey: vi.fn(() => ({ video: { firstlastframe: true } })),
}))
vi.mock('@/lib/model-config-contract', () => ({
  parseModelKeyStrict: vi.fn(() => ({ provider: 'fal' })),
}))
vi.mock('@/lib/api-config', () => ({
  getProviderConfig: vi.fn(async () => ({ apiKey: 'api-key' })),
}))

function buildPanel(overrides?: Partial<PanelRow>): PanelRow {
  return {
    id: 'panel-1',
    storyboardId: 'storyboard-1',
    panelIndex: 0,
    videoUrl: 'cos/base-video.mp4',
    imageUrl: 'cos/panel-image.png',
    videoPrompt: 'panel prompt',
    description: 'panel description',
    firstLastFramePrompt: null,
    shotType: 'medium shot',
    cameraMove: 'static',
    location: 'subway platform',
    sceneType: 'interior',
    characters: '[]',
    srtSegment: 'same scene continuity baseline text',
    ...(overrides || {}),
  }
}

function buildJob(params: {
  type: TaskJobData['type']
  payload?: Record<string, unknown>
  targetType?: string
  targetId?: string
  locale?: TaskJobData['locale']
}): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: params.type,
      locale: params.locale ?? 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: params.targetType ?? 'NovelPromotionPanel',
      targetId: params.targetId ?? 'panel-1',
      payload: params.payload ?? {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker video processor behavior', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    workerState.processor = null

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue(buildPanel())
    prismaMock.novelPromotionPanel.findFirst.mockResolvedValue(buildPanel())
    prismaMock.novelPromotionPanel.findMany.mockResolvedValue([
      buildPanel({ panelIndex: 0 }),
      buildPanel({ panelIndex: 1, description: 'character turns and looks far away', shotType: 'close-up' }),
    ])
    prismaMock.novelPromotionStoryboard.findUnique.mockResolvedValue({
      clip: {
        summary: 'main character infiltrates station and observes patrol',
        content: 'main character infiltrates station and observes patrol',
      },
    })
    prismaMock.novelPromotionProject.findUnique.mockResolvedValue({
      characters: [],
    })
    prismaMock.novelPromotionVoiceLine.findUnique.mockResolvedValue({
      id: 'line-1',
      audioUrl: 'cos/line-1.mp3',
    })

    const mod = await import('@/lib/workers/video.worker')
    mod.createVideoWorker()
  })

  it('VIDEO_PANEL: throws explicit error when payload.videoModel is missing', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {},
    })

    await expect(processor!(job)).rejects.toThrow('VIDEO_MODEL_REQUIRED: payload.videoModel is required')
  })

  it('VIDEO_PANEL: forwards async download headers to COS upload', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    utilsMock.resolveVideoSourceFromGeneration.mockResolvedValueOnce({
      url: 'https://provider.example/video.mp4',
      downloadHeaders: {
        Authorization: 'Bearer oa-key',
      },
    } as never)

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'openai-compatible:oa-1::sora-2',
        generationOptions: {
          duration: 8,
          resolution: '720p',
        },
      },
    })

    await processor!(job)

    expect(utilsMock.uploadVideoSourceToCos).toHaveBeenCalledWith(
      'https://provider.example/video.mp4',
      'panel-video',
      'panel-1',
      {
        Authorization: 'Bearer oa-key',
      },
    )
  })

  it('VIDEO_PANEL: appends continuity context into prompt', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'openai-compatible:oa-1::sora-2',
      },
    })

    await processor!(job)
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)

    const call = utilsMock.resolveVideoSourceFromGeneration.mock.calls[0] as unknown[] | undefined
    const options = (call?.[1] as Record<string, unknown> | undefined)?.options as { prompt?: string } | undefined
    expect(options?.prompt).toContain('panel prompt')
    expect(options?.prompt).toContain('same scene continuity baseline text')
    expect(options?.prompt).not.toBe('panel prompt')
  })

  it('VIDEO_PANEL: uses matching appearance from panel character reference', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(
      buildPanel({
        characters: JSON.stringify([{ name: 'Hero', appearance: 'battle' }]),
      }),
    )
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      characters: [
        {
          name: 'Hero',
          aliases: '[]',
          appearances: [
            {
              changeReason: 'default',
              description: 'clean face and neat armor',
              descriptions: null,
              selectedIndex: 0,
            },
            {
              changeReason: 'battle',
              description: 'scarred face and torn armor',
              descriptions: null,
              selectedIndex: 0,
            },
          ],
        },
      ],
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'openai-compatible:oa-1::sora-2',
      },
    })

    await processor!(job)
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)

    const call = utilsMock.resolveVideoSourceFromGeneration.mock.calls[0] as unknown[] | undefined
    const options = (call?.[1] as Record<string, unknown> | undefined)?.options as { prompt?: string } | undefined
    expect(options?.prompt).toContain('scarred face and torn armor')
  })

  it('VIDEO_PANEL: supports aliases field when resolving character visuals', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(
      buildPanel({
        characters: JSON.stringify([{ name: 'Old Fox' }]),
      }),
    )
    prismaMock.novelPromotionProject.findUnique.mockResolvedValueOnce({
      characters: [
        {
          name: 'Commander Liang',
          aliases: JSON.stringify(['Old Fox', 'Old Master']),
          appearances: [
            {
              changeReason: 'default',
              description: 'grey beard and black robe',
              descriptions: null,
              selectedIndex: 0,
            },
          ],
        },
      ],
    })

    const job = buildJob({
      type: TASK_TYPE.VIDEO_PANEL,
      payload: {
        videoModel: 'openai-compatible:oa-1::sora-2',
      },
    })

    await processor!(job)
    expect(utilsMock.resolveVideoSourceFromGeneration).toHaveBeenCalledTimes(1)

    const call = utilsMock.resolveVideoSourceFromGeneration.mock.calls[0] as unknown[] | undefined
    const options = (call?.[1] as Record<string, unknown> | undefined)?.options as { prompt?: string } | undefined
    expect(options?.prompt).toContain('grey beard and black robe')
  })

  it('LIP_SYNC: throws explicit error when panel is missing', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValueOnce(null)
    const job = buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: { voiceLineId: 'line-1' },
      targetId: 'panel-missing',
    })

    await expect(processor!(job)).rejects.toThrow('Lip-sync panel not found')
  })

  it('LIP_SYNC: writes lipSyncVideoUrl and clears lipSyncTaskId', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const job = buildJob({
      type: TASK_TYPE.LIP_SYNC,
      payload: {
        voiceLineId: 'line-1',
        lipSyncModel: 'fal::lipsync-model',
      },
      targetId: 'panel-1',
    })

    const result = await processor!(job) as { panelId: string; voiceLineId: string; lipSyncVideoUrl: string }
    expect(result).toEqual({
      panelId: 'panel-1',
      voiceLineId: 'line-1',
      lipSyncVideoUrl: 'cos/lip-sync/video.mp4',
    })

    expect(utilsMock.resolveLipSyncVideoSource).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: 'user-1',
        modelKey: 'fal::lipsync-model',
      }),
    )

    expect(prismaMock.novelPromotionPanel.update).toHaveBeenCalledWith({
      where: { id: 'panel-1' },
      data: {
        lipSyncVideoUrl: 'cos/lip-sync/video.mp4',
        lipSyncTaskId: null,
      },
    })
  })

  it('unknown task type: throws explicit error', async () => {
    const processor = workerState.processor
    expect(processor).toBeTruthy()

    const unsupportedJob = buildJob({
      type: TASK_TYPE.AI_CREATE_CHARACTER,
    })

    await expect(processor!(unsupportedJob)).rejects.toThrow('Unsupported video task type')
  })
})
