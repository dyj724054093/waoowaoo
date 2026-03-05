import { describe, expect, it } from 'vitest'
import { getFilteredLocationsDescription } from '@/lib/storyboard-phases'

const anchor = '\u9632\u75ab\u7ad9'

describe('helpers storyboard-phases location matching', () => {
  it('returns selected description when clip location is camera-variant', () => {
    const locations = [
      {
        name: anchor,
        images: [
          { isSelected: false, description: 'fallback' },
          { isSelected: true, description: 'selected-desc' },
        ],
      },
    ]

    const result = getFilteredLocationsDescription(locations, '\u9632\u75ab\u7ad9\uFF08\u591c\u666f\uFF09\u4fa7\u9762')
    expect(result).toBe('selected-desc')
  })

  it('returns no when no matched location exists', () => {
    const locations = [{ name: anchor, images: [{ isSelected: true, description: 'selected-desc' }] }]
    const result = getFilteredLocationsDescription(locations, '\u7801\u5934')
    expect(result).toBe('\u65e0')
  })
})