import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

type WorkerProcessor = (job: Job<TaskJobData>) => Promise<unknown>

const workerState = vi.hoisted(() => ({
  processor: null as WorkerProcessor | null,
  options: null as Record<string, unknown> | null,
}))

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(_name: string) {}

    async add() {
      return { id: 'job-1' }
    }

    async getJob() {
      return null
    }
  },
  Worker: class {
    constructor(_name: string, processor: WorkerProcessor, options: Record<string, unknown>) {
      workerState.processor = processor
      workerState.options = options
    }
  },
}))

vi.mock('@/lib/redis', () => ({ queueRedis: {} }))
vi.mock('@/lib/workers/shared', () => ({
  reportTaskProgress: vi.fn(async () => undefined),
  withTaskLifecycle: vi.fn(async (job: Job<TaskJobData>, handler: WorkerProcessor) => await handler(job)),
}))
vi.mock('@/lib/workers/handlers/image-task-handlers', () => ({
  handleAssetHubImageTask: vi.fn(),
  handleAssetHubModifyTask: vi.fn(),
  handleCharacterImageTask: vi.fn(),
  handleLocationImageTask: vi.fn(),
  handleModifyAssetImageTask: vi.fn(),
  handlePanelImageTask: vi.fn(),
  handlePanelVariantTask: vi.fn(),
}))

describe('worker image concurrency defaults', () => {
  beforeEach(() => {
    vi.resetModules()
    workerState.processor = null
    workerState.options = null
    delete process.env.QUEUE_CONCURRENCY_IMAGE
  })

  it('defaults image worker concurrency to 1 when env is missing', async () => {
    const mod = await import('@/lib/workers/image.worker')
    mod.createImageWorker()

    expect(workerState.options).toMatchObject({
      concurrency: 1,
    })
  })

  it('uses configured image worker concurrency from env', async () => {
    process.env.QUEUE_CONCURRENCY_IMAGE = '2'

    const mod = await import('@/lib/workers/image.worker')
    mod.createImageWorker()

    expect(workerState.options).toMatchObject({
      concurrency: 2,
    })
  })

  it('still routes IMAGE_PANEL jobs through lifecycle processor', async () => {
    const handlePanelImageTask = vi.fn(async () => ({ ok: true }))
    vi.doMock('@/lib/workers/handlers/image-task-handlers', () => ({
      handleAssetHubImageTask: vi.fn(),
      handleAssetHubModifyTask: vi.fn(),
      handleCharacterImageTask: vi.fn(),
      handleLocationImageTask: vi.fn(),
      handleModifyAssetImageTask: vi.fn(),
      handlePanelImageTask,
      handlePanelVariantTask: vi.fn(),
    }))

    const mod = await import('@/lib/workers/image.worker')
    mod.createImageWorker()

    const processor = workerState.processor
    expect(processor).toBeTruthy()

    await processor!({
      data: {
        taskId: 'task-1',
        type: TASK_TYPE.IMAGE_PANEL,
        locale: 'zh',
        projectId: 'project-1',
        episodeId: 'episode-1',
        targetType: 'NovelPromotionPanel',
        targetId: 'panel-1',
        payload: {},
        userId: 'user-1',
      },
    } as Job<TaskJobData>)

    expect(handlePanelImageTask).toHaveBeenCalled()
  })
})
