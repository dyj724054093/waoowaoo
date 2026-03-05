import { describe, expect, it } from 'vitest'
import { normalizeAnyError } from '@/lib/errors/normalize'

describe('normalizeAnyError network termination mapping', () => {
  it('maps undici terminated TypeError to NETWORK_ERROR', () => {
    const normalized = normalizeAnyError(new TypeError('terminated'))
    expect(normalized.code).toBe('NETWORK_ERROR')
    expect(normalized.retryable).toBe(true)
  })

  it('maps socket hang up TypeError to NETWORK_ERROR', () => {
    const normalized = normalizeAnyError(new TypeError('socket hang up'))
    expect(normalized.code).toBe('NETWORK_ERROR')
    expect(normalized.retryable).toBe(true)
  })

  it('maps wrapped terminated message to NETWORK_ERROR', () => {
    const normalized = normalizeAnyError(new Error('exception TypeError: terminated'))
    expect(normalized.code).toBe('NETWORK_ERROR')
    expect(normalized.retryable).toBe(true)
  })
})

describe('normalizeAnyError upstream 403 classification', () => {
  it('maps cloudflare challenge html to EXTERNAL_ERROR', () => {
    const normalized = normalizeAnyError(
      new Error('500 upload failed: 403 <!DOCTYPE html><html><head><title>Just a moment...</title>')
    )
    expect(normalized.code).toBe('EXTERNAL_ERROR')
    expect(normalized.retryable).toBe(true)
  })

  it('maps provider blocked message to EXTERNAL_ERROR', () => {
    const normalized = normalizeAnyError({
      status: 403,
      message: '403 Your request was blocked.',
      provider: 'openai-compatible:test',
    })
    expect(normalized.code).toBe('EXTERNAL_ERROR')
    expect(normalized.retryable).toBe(true)
  })

  it('keeps normal permission denied as FORBIDDEN', () => {
    const normalized = normalizeAnyError({
      status: 403,
      message: 'permission denied',
    })
    expect(normalized.code).toBe('FORBIDDEN')
    expect(normalized.retryable).toBe(false)
  })
})
