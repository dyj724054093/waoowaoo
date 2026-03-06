import { describe, expect, it, vi } from 'vitest'

const logWarnMock = vi.hoisted(() => vi.fn())

vi.mock('@/lib/logging/core', () => ({
  logWarn: logWarnMock,
}))

import { BaseImageGenerator } from '@/lib/generators/base'

class TestImageGenerator extends BaseImageGenerator {
  constructor(private readonly impl: () => Promise<any>) {
    super()
  }

  protected async doGenerate() {
    return await this.impl()
  }
}

describe('BaseImageGenerator', () => {
  it('preserves rate-limit metadata when generation fails', async () => {
    const generator = new TestImageGenerator(async () => {
      throw {
        message: 'Too many requests',
        status: 429,
        provider: 'fal',
        details: { retryAfterMs: 30000 },
      }
    })

    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'draw a castle',
    })

    expect(result).toMatchObject({
      success: false,
      error: 'Too many requests',
      status: 429,
      provider: 'fal',
      details: { retryAfterMs: 30000 },
    })
  })
})
