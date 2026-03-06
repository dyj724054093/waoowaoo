import { beforeEach, describe, expect, it, vi } from 'vitest'

const openAIState = vi.hoisted(() => ({
  generate: vi.fn(),
  edit: vi.fn(),
  toFile: vi.fn(async () => ({ name: 'mock-file' })),
}))

const getProviderConfigMock = vi.hoisted(() => vi.fn(async () => ({
  id: 'openai-compatible:oa-1',
  apiKey: 'oa-key',
  baseUrl: 'https://oa.test/v1',
})))

const getImageBase64CachedMock = vi.hoisted(() => vi.fn(async () => 'data:image/png;base64,QQ=='))

vi.mock('openai', () => ({
  default: class OpenAI {
    images = {
      generate: openAIState.generate,
      edit: openAIState.edit,
    }
  },
  toFile: openAIState.toFile,
}))

vi.mock('@/lib/api-config', () => ({
  getProviderConfig: getProviderConfigMock,
}))

vi.mock('@/lib/image-cache', () => ({
  getImageBase64Cached: getImageBase64CachedMock,
}))

import { OpenAICompatibleImageGenerator } from '@/lib/generators/image/openai-compatible'

describe('OpenAICompatibleImageGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProviderConfigMock.mockResolvedValue({
      id: 'openai-compatible:oa-1',
      apiKey: 'oa-key',
      baseUrl: 'https://oa.test/v1',
    })
  })

  it('uses official images.generate payload parameters', async () => {
    openAIState.generate.mockResolvedValueOnce({
      data: [{ b64_json: 'YmFzZTY0' }],
    })

    const generator = new OpenAICompatibleImageGenerator('gpt-image-1', 'openai-compatible:oa-1')
    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'draw a lighthouse',
      options: {
        size: '1024x1024',
        quality: 'high',
        outputFormat: 'png',
        responseFormat: 'b64_json',
      },
    })

    expect(result.success).toBe(true)
    expect(result.imageBase64).toBe('YmFzZTY0')
    expect(result.imageUrl).toBe('data:image/png;base64,YmFzZTY0')
    expect(openAIState.generate).toHaveBeenCalledWith({
      model: 'gpt-image-1',
      prompt: 'draw a lighthouse',
      response_format: 'b64_json',
      output_format: 'png',
      quality: 'high',
      size: '1024x1024',
    })
  })

  it('uses official images.edit payload when reference images are provided', async () => {
    openAIState.edit.mockResolvedValueOnce({
      data: [{ b64_json: 'ZWRpdA==' }],
    })

    const generator = new OpenAICompatibleImageGenerator('gpt-image-1', 'openai-compatible:oa-1')
    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'edit this image',
      referenceImages: ['data:image/png;base64,QQ=='],
      options: {
        quality: 'medium',
      },
    })

    expect(result.success).toBe(true)
    expect(openAIState.toFile).toHaveBeenCalledTimes(1)

    const call = openAIState.edit.mock.calls[0]
    expect(call).toBeTruthy()
    if (!call) {
      throw new Error('images.edit should be called')
    }
    expect(call[0]).toMatchObject({
      model: 'gpt-image-1',
      prompt: 'edit this image',
      response_format: 'b64_json',
      quality: 'medium',
    })
    expect(Array.isArray((call[0] as { image?: unknown }).image)).toBe(true)
  })

  it('preserves provider error context for images.edit failures', async () => {
    openAIState.edit.mockRejectedValueOnce({
      message: '500 Upstream 429: {"error":{"message":"Too many requests"}}',
      status: 429,
      headers: {
        'x-request-id': 'req-edit-1',
      },
      error: {
        code: 'rate_limit_exceeded',
      },
    })

    const generator = new OpenAICompatibleImageGenerator('gpt-image-1', 'openai-compatible:oa-1')
    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'edit this image',
      referenceImages: ['data:image/png;base64,QQ=='],
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('Too many requests')
    expect(result.status).toBe(429)
    expect(result.provider).toBe('openai-compatible:oa-1')
    expect(result.details).toMatchObject({
      operation: 'images.edit',
      model: 'gpt-image-1',
      providerId: 'openai-compatible:oa-1',
      requestId: 'req-edit-1',
      upstreamError: {
        code: 'rate_limit_exceeded',
      },
    })
    expect(openAIState.edit).toHaveBeenCalledTimes(1)
  })

  it('does not retry images.edit when provider returns rate limit', async () => {
    openAIState.edit.mockRejectedValueOnce(new Error('500 Upstream 429: {"error":{"code":8,"message":"Too many requests","details":[]}}'))

    const generator = new OpenAICompatibleImageGenerator('gpt-image-1', 'openai-compatible:oa-1')
    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'edit this image',
      referenceImages: ['data:image/png;base64,QQ=='],
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('429')
    expect(openAIState.edit).toHaveBeenCalledTimes(1)
  })

  it('does not retry images.generate when provider returns rate limit', async () => {
    openAIState.generate.mockRejectedValueOnce(new Error('429 Too many requests'))

    const generator = new OpenAICompatibleImageGenerator('gpt-image-1', 'openai-compatible:oa-1')
    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'draw a lighthouse',
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('429')
    expect(openAIState.generate).toHaveBeenCalledTimes(1)
  })

  it('retries transient edit errors once before succeeding', async () => {
    openAIState.edit
      .mockRejectedValueOnce(new Error('socket hang up'))
      .mockResolvedValueOnce({
        data: [{ b64_json: 'ZWRpdA==' }],
      })

    const generator = new OpenAICompatibleImageGenerator('gpt-image-1', 'openai-compatible:oa-1')
    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'edit this image',
      referenceImages: ['data:image/png;base64,QQ=='],
    })

    expect(result.success).toBe(true)
    expect(result.imageBase64).toBe('ZWRpdA==')
    expect(openAIState.edit).toHaveBeenCalledTimes(2)
  })

  it('fails explicitly on unsupported option values', async () => {
    const generator = new OpenAICompatibleImageGenerator('gpt-image-1', 'openai-compatible:oa-1')
    const result = await generator.generate({
      userId: 'user-1',
      prompt: 'draw',
      options: {
        quality: 'ultra',
      },
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('OPENAI_COMPATIBLE_IMAGE_OPTION_UNSUPPORTED')
  })
})
