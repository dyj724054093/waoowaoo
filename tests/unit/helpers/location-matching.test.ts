import { describe, expect, it } from 'vitest'
import { findLocationByReferenceName, normalizeLocationAnchorName } from '@/lib/location-matching'

const anchor = '\u9632\u75ab\u7ad9'
const alias = '\u68c0\u75ab\u7ad9'

describe('helpers location-matching', () => {
  it('normalize: stable anchor keeps unchanged', () => {
    expect(normalizeLocationAnchorName(anchor)).toBe(anchor)
  })

  it('normalize: strips bracket + camera suffix from chinese variant', () => {
    const variant = '\u9632\u75ab\u7ad9\uFF08\u591c\u666f\uFF09\u4fa7\u9762'
    expect(normalizeLocationAnchorName(variant)).toBe(anchor)
  })

  it('normalize: strips camera suffix from english variant', () => {
    expect(normalizeLocationAnchorName('Old Town (night) side')).toBe('old town')
  })

  it('find: matches by alias overlap', () => {
    const locations = [{ name: `${anchor}/${alias}` }]
    expect(findLocationByReferenceName(locations, alias)).toEqual({ name: `${anchor}/${alias}` })
  })

  it('find: matches by normalized anchor', () => {
    const locations = [{ name: anchor }]
    expect(findLocationByReferenceName(locations, '\u9632\u75ab\u7ad9\u6b63\u9762')).toEqual({ name: anchor })
  })

  it('find: returns undefined when no match', () => {
    const locations = [{ name: anchor }]
    expect(findLocationByReferenceName(locations, '\u7801\u5934')).toBeUndefined()
  })
})