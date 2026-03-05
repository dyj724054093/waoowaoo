import { describe, expect, it, vi } from 'vitest'

const utilsMock = vi.hoisted(() => ({
  resolveImageSourceFromGeneration: vi.fn(),
  toSignedUrlIfCos: vi.fn((url: string | null | undefined) => (url ? `signed:${url}` : null)),
  uploadImageSourceToCos: vi.fn(),
  withLabelBar: vi.fn(),
}))

vi.mock('@/lib/workers/utils', () => utilsMock)

import { collectPanelReferenceImages } from '@/lib/workers/handlers/image-task-handler-shared'

const anchor = '\u9632\u75ab\u7ad9'
const alias = '\u68c0\u75ab\u7ad9'

describe('worker image-task-handler-shared location match', () => {
  it('collects selected location image for normalized camera-variant location', async () => {
    const refs = await collectPanelReferenceImages(
      {
        locations: [
          {
            name: anchor,
            images: [
              { isSelected: false, imageUrl: 'cos/loc-fallback.png' },
              { isSelected: true, imageUrl: 'cos/loc-selected.png' },
            ],
          },
        ],
      },
      {
        location: '\u9632\u75ab\u7ad9\uFF08\u591c\u666f\uFF09\u4fa7\u9762',
      },
    )

    expect(refs).toEqual(['signed:cos/loc-selected.png'])
  })

  it('collects location image when matched by alias', async () => {
    const refs = await collectPanelReferenceImages(
      {
        locations: [
          {
            name: `${anchor}/${alias}`,
            images: [{ isSelected: true, imageUrl: 'cos/loc-alias.png' }],
          },
        ],
      },
      {
        location: alias,
      },
    )

    expect(refs).toEqual(['signed:cos/loc-alias.png'])
  })
})