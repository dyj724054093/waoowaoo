import { describe, expect, it } from 'vitest'
import { buildImageEditPrompt } from '@/lib/workers/handlers/image-edit-prompt'

describe('worker image-edit-prompt', () => {
  it('includes user instruction and anti-watermark guard', () => {
    const prompt = buildImageEditPrompt('character', 'keep hairstyle, improve details')
    expect(prompt).toContain('keep hairstyle, improve details')
    expect(prompt).toContain('logo')
    expect(prompt).toContain('UI')
  })

  it('falls back when user instruction is empty', () => {
    const prompt = buildImageEditPrompt('location', '   ')
    expect(prompt).toContain('logo')
    expect(prompt).toContain('UI')
    expect(prompt).not.toContain('keep hairstyle, improve details')
  })
})
