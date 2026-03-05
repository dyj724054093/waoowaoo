import type { Job } from 'bullmq'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TASK_TYPE, type TaskJobData } from '@/lib/task/types'

const prismaMock = vi.hoisted(() => ({
  novelPromotionPanel: {
    findUnique: vi.fn(),
    update: vi.fn(async () => ({})),
  },
}))

const utilsMock = vi.hoisted(() => ({
  assertTaskActive: vi.fn(async () => undefined),
  getProjectModels: vi.fn(async () => ({ storyboardModel: 'storyboard-model-1', artStyle: 'cinematic' })),
  resolveImageSourceFromGeneration: vi.fn(async () => 'generated-source-1'),
  uploadImageSourceToCos: vi.fn(async () => 'cos/panel-candidate-1.png'),
}))

const sharedMock = vi.hoisted(() => ({
  collectPanelReferenceImages: vi.fn(async () => []),
  resolveNovelData: vi.fn(async () => ({
    videoRatio: '16:9',
    characters: [],
    locations: [
      {
        name: '\u9632\u75ab\u7ad9',
        images: [{ isSelected: true, description: '\u84dd\u8c03\u591c\u666f' }],
      },
    ],
  })),
}))

const outboundMock = vi.hoisted(() => ({
  normalizeReferenceImagesForGeneration: vi.fn(async () => []),
}))

const promptI18nMock = vi.hoisted(() => ({
  buildPrompt: vi.fn(() => 'panel-image-prompt'),
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/workers/utils', () => utilsMock)
vi.mock('@/lib/media/outbound-image', () => outboundMock)
vi.mock('@/lib/workers/shared', () => ({ reportTaskProgress: vi.fn(async () => undefined) }))
vi.mock('@/lib/logging/core', () => ({
  logInfo: vi.fn(),
  createScopedLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    event: vi.fn(),
    child: vi.fn(),
  })),
}))
vi.mock('@/lib/workers/handlers/image-task-handler-shared', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workers/handlers/image-task-handler-shared')>(
    '@/lib/workers/handlers/image-task-handler-shared',
  )
  return {
    ...actual,
    collectPanelReferenceImages: sharedMock.collectPanelReferenceImages,
    resolveNovelData: sharedMock.resolveNovelData,
  }
})
vi.mock('@/lib/prompt-i18n', () => ({
  PROMPT_IDS: { NP_SINGLE_PANEL_IMAGE: 'np_single_panel_image' },
  buildPrompt: promptI18nMock.buildPrompt,
}))

import { handlePanelImageTask } from '@/lib/workers/handlers/panel-image-task-handler'

function buildJob(payload: Record<string, unknown>, targetId = 'panel-1'): Job<TaskJobData> {
  return {
    data: {
      taskId: 'task-panel-image-1',
      type: TASK_TYPE.IMAGE_PANEL,
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
      targetType: 'NovelPromotionPanel',
      targetId,
      payload,
      userId: 'user-1',
    },
  } as unknown as Job<TaskJobData>
}

describe('worker panel-image-task-handler location_reference match', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    prismaMock.novelPromotionPanel.findUnique.mockResolvedValue({
      id: 'panel-1',
      storyboardId: 'storyboard-1',
      panelIndex: 0,
      shotType: 'close-up',
      cameraMove: 'static',
      description: 'hero close-up',
      videoPrompt: 'dramatic',
      location: '\u9632\u75ab\u7ad9\uFF08\u591c\u666f\uFF09\u4fa7\u9762',
      characters: '[]',
      srtSegment: '\u53f0\u8bcd\u7247\u6bb5',
      photographyRules: null,
      actingNotes: null,
      sketchImageUrl: null,
      imageUrl: null,
    })
  })

  it('builds prompt context location_reference using canonical location', async () => {
    await handlePanelImageTask(buildJob({ candidateCount: 1 }))

    const buildPromptArg = (promptI18nMock.buildPrompt.mock.calls[0] as unknown[] | undefined)?.[0] as {
      variables?: { storyboard_text_json_input?: string }
    } | undefined

    const rawContext = buildPromptArg?.variables?.storyboard_text_json_input
    expect(typeof rawContext).toBe('string')

    const parsed = JSON.parse(rawContext || '{}') as {
      context?: { location_reference?: { name?: string; description?: string | null } | null }
    }

    expect(parsed.context?.location_reference).toEqual({
      name: '\u9632\u75ab\u7ad9',
      description: '\u84dd\u8c03\u591c\u666f',
    })
  })
})