import { describe, expect, it, vi } from 'vitest'

const queueState = vi.hoisted(() => ({
  instances: new Map<string, { name: string; options: Record<string, unknown> }>(),
}))

vi.mock('bullmq', () => ({
  Queue: class {
    constructor(name: string, options: Record<string, unknown>) {
      queueState.instances.set(name, { name, options })
    }

    async add() {
      return { id: 'job-1' }
    }

    async getJob() {
      return null
    }
  },
}))

vi.mock('@/lib/redis', () => ({ queueRedis: {} }))

import { QUEUE_NAME } from '@/lib/task/queues'
import '@/lib/task/queues'

describe('task queue defaults', () => {
  it('uses conservative backoff for image queue only', () => {
    const imageQueue = queueState.instances.get(QUEUE_NAME.IMAGE)
    const videoQueue = queueState.instances.get(QUEUE_NAME.VIDEO)

    expect(imageQueue?.options).toMatchObject({
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 15_000,
        },
      },
    })

    expect(videoQueue?.options).toMatchObject({
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2_000,
        },
      },
    })
  })
})
