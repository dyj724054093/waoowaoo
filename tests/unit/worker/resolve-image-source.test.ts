import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAnyError } from '@/lib/errors/normalize'
import type { TaskJobData } from '@/lib/task/types'

const generateImageMock = vi.hoisted(() => vi.fn())
const resolveProjectModelCapabilityGenerationOptionsMock = vi.hoisted(() => vi.fn(async () => ({})))
const findTaskMock = vi.hoisted(() => vi.fn(async () => null))

vi.mock('sharp', () => ({ default: {} }))
vi.mock('@/lib/logging/core', () => ({
  createScopedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
    child: vi.fn(),
  })),
}))
vi.mock('@/lib/logging/context', () => ({
  withLogContext: vi.fn(async (_ctx: unknown, fn: () => Promise<unknown>) => await fn()),
}))
vi.mock('@/lib/generator-api', () => ({
  generateImage: generateImageMock,
  generateVideo: vi.fn(),
}))
vi.mock('@/lib/kling', () => ({ generateLipSync: vi.fn() }))
vi.mock('@/lib/async-poll', () => ({ pollAsyncTask: vi.fn() }))
vi.mock('@/lib/cos', () => ({ getSignedUrl: vi.fn(), toFetchableUrl: vi.fn((url: string) => url) }))
vi.mock('@/lib/fonts', () => ({ initializeFonts: vi.fn(), createLabelSVG: vi.fn() }))
vi.mock('@/lib/media-process', () => ({ processMediaResult: vi.fn() }))
vi.mock('@/lib/config-service', () => ({
  getProjectModelConfig: vi.fn(),
  getUserModelConfig: vi.fn(),
  resolveProjectModelCapabilityGenerationOptions: resolveProjectModelCapabilityGenerationOptionsMock,
}))
vi.mock('@/lib/task/errors', () => ({
  TaskTerminatedError: class TaskTerminatedError extends Error {},
}))
vi.mock('@/lib/task/service', () => ({
  isTaskActive: vi.fn(async () => true),
  trySetTaskExternalId: vi.fn(async () => undefined),
}))
vi.mock('./shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    task: {
      findUnique: findTaskMock,
    },
  },
}))

import { resolveImageSourceFromGeneration } from '@/lib/workers/utils'

function buildJob(): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-1',
      type: 'IMAGE_PANEL',
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId: 'panel-1',
      payload: {},
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('resolveImageSourceFromGeneration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findTaskMock.mockResolvedValue(null)
    resolveProjectModelCapabilityGenerationOptionsMock.mockResolvedValue({})
  })

  it('preserves provider rate-limit metadata when image generation fails', async () => {
    generateImageMock.mockResolvedValueOnce({
      success: false,
      error: 'Too many requests',
      status: 429,
      provider: 'fal',
      details: { retryAfterMs: 30000 },
    })

    const job = buildJob()

    try {
      await resolveImageSourceFromGeneration(job, {
        userId: 'user-1',
        modelId: 'fal::nano-banana',
        prompt: 'draw a castle',
        options: { aspectRatio: '16:9' },
      })
      throw new Error('expected resolveImageSourceFromGeneration to throw')
    } catch (error) {
      const normalized = normalizeAnyError(error)
      expect(normalized).toMatchObject({
        code: 'RATE_LIMIT',
        provider: 'fal',
        details: { retryAfterMs: 30000 },
      })
    }
  })
})
