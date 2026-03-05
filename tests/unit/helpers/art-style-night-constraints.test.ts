import { describe, expect, it } from 'vitest'
import {
  applyNightVisualHardConstraints,
  getEffectiveArtStylePrompt,
} from '@/lib/constants'

describe('art style and night visual constraints', () => {
  it('adds hard negative constraints for realistic style', () => {
    const zh = getEffectiveArtStylePrompt('realistic', 'zh')
    const en = getEffectiveArtStylePrompt('realistic', 'en')

    expect(zh).toContain('严禁动漫')
    expect(en.toLowerCase()).toContain('forbid anime')
  })

  it('keeps non-realistic style unchanged', () => {
    const zh = getEffectiveArtStylePrompt('american-comic', 'zh')
    expect(zh).not.toContain('严禁动漫')
  })

  it('injects night hard constraints when night prompt contains sunlight cues', () => {
    const input = '深夜街道，角色在月光下行走，远处有太阳光照'
    const output = applyNightVisualHardConstraints(input, 'zh')
    expect(output).toContain('夜景硬约束')
    expect(output).toContain('禁止元素：太阳')
  })

  it('does not inject night constraints for daytime prompt', () => {
    const input = '白天办公室，人物正在开会'
    const output = applyNightVisualHardConstraints(input, 'zh')
    expect(output).toBe(input)
  })
})
