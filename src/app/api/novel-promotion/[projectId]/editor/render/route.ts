import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { createScopedLogger } from '@/lib/logging/core'
import { renderEditorProjectToCos } from '@/lib/video-editor/render-service'
import { getSignedUrl } from '@/lib/cos'

const editorRenderLogger = createScopedLogger({
  module: 'api.editor.render',
})

type RenderQuality = 'draft' | 'high'

type EditorProjectPayload = {
  id?: string
  episodeId: string
  config: {
    fps: number
    width: number
    height: number
  }
  timeline: Array<{
    id: string
    src: string
    durationInFrames: number
  }>
}

function buildRenderId(): string {
  return `render_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function normalizeQuality(input: unknown): RenderQuality {
  return input === 'draft' ? 'draft' : 'high'
}

function isValidEditorProjectPayload(input: unknown): input is EditorProjectPayload {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const value = input as Record<string, unknown>
  return typeof value.episodeId === 'string' && value.episodeId.trim().length > 0
}

async function findEditorProjectByScope(params: {
  projectId: string
  editorProjectId?: string
  episodeId?: string
}) {
  const whereByProject = {
    episode: {
      novelPromotionProject: {
        projectId: params.projectId,
      },
    },
  }

  if (params.episodeId && params.episodeId.trim().length > 0) {
    return await prisma.videoEditorProject.findFirst({
      where: {
        ...whereByProject,
        episodeId: params.episodeId,
      },
    })
  }

  if (params.editorProjectId && params.editorProjectId.trim().length > 0) {
    return await prisma.videoEditorProject.findFirst({
      where: {
        ...whereByProject,
        id: params.editorProjectId,
      },
    })
  }

  return null
}

function resolveOutputAccessUrl(rawOutputUrl: string | null | undefined): string | null {
  if (!rawOutputUrl) return null
  if (rawOutputUrl.startsWith('http://') || rawOutputUrl.startsWith('https://') || rawOutputUrl.startsWith('/')) {
    return rawOutputUrl
  }
  return getSignedUrl(rawOutputUrl, 2 * 60 * 60)
}

function normalizeProjectData(raw: unknown): EditorProjectPayload {
  if (!isValidEditorProjectPayload(raw)) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDITOR_PROJECT_DATA_INVALID',
      field: 'projectData',
    })
  }

  const timelineRaw = Array.isArray(raw.timeline) ? raw.timeline : []
  const timeline = timelineRaw
    .filter((item) => !!item && typeof item === 'object' && !Array.isArray(item))
    .map((item, index) => {
      const clip = item as Record<string, unknown>
      return {
        id: typeof clip.id === 'string' && clip.id.trim().length > 0 ? clip.id.trim() : `clip_${index + 1}`,
        src: typeof clip.src === 'string' ? clip.src : '',
        durationInFrames: typeof clip.durationInFrames === 'number' ? clip.durationInFrames : 0,
      }
    })

  const configRaw = raw.config && typeof raw.config === 'object' && !Array.isArray(raw.config)
    ? raw.config as Record<string, unknown>
    : {}

  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    episodeId: raw.episodeId,
    config: {
      fps: typeof configRaw.fps === 'number' ? configRaw.fps : 30,
      width: typeof configRaw.width === 'number' ? configRaw.width : 1920,
      height: typeof configRaw.height === 'number' ? configRaw.height : 1080,
    },
    timeline,
  }
}

async function runRender(editorProjectId: string, quality: RenderQuality, renderId: string) {
  editorRenderLogger.info({
    message: 'editor render job started',
    details: { editorProjectId, renderId, quality },
  })

  try {
    const current = await prisma.videoEditorProject.findUnique({ where: { id: editorProjectId } })
    if (!current) {
      throw new Error('EDITOR_PROJECT_NOT_FOUND')
    }

    const parsed = normalizeProjectData(JSON.parse(current.projectData))
    const result = await renderEditorProjectToCos({
      project: { ...parsed, id: parsed.id || editorProjectId },
      renderId,
      quality,
    })

    await prisma.videoEditorProject.update({
      where: { id: editorProjectId },
      data: {
        renderStatus: 'completed',
        outputUrl: result.outputKey,
      },
    })

    editorRenderLogger.info({
      message: 'editor render job completed',
      details: {
        editorProjectId,
        renderId,
        outputKey: result.outputKey,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    editorRenderLogger.error({
      message: 'editor render job failed',
      errorCode: 'INTERNAL_ERROR',
      retryable: false,
      details: { editorProjectId, renderId, error: message },
    })

    await prisma.videoEditorProject.update({
      where: { id: editorProjectId },
      data: {
        renderStatus: 'failed',
        outputUrl: null,
      },
    })
  }
}

export const POST = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const body = await request.json().catch(() => ({})) as Record<string, unknown>
  const editorProjectId = typeof body.editorProjectId === 'string' ? body.editorProjectId.trim() : ''
  const episodeId = typeof body.episodeId === 'string' ? body.episodeId.trim() : ''
  const quality = normalizeQuality(body.quality)

  if (!editorProjectId && !episodeId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDITOR_PROJECT_ID_REQUIRED',
      field: 'editorProjectId',
    })
  }

  const projectDataRaw = body.projectData
  if (projectDataRaw !== undefined) {
    const normalizedProjectData = normalizeProjectData(projectDataRaw)
    if (!episodeId && !normalizedProjectData.episodeId) {
      throw new ApiError('INVALID_PARAMS', {
        code: 'EPISODE_ID_REQUIRED',
        field: 'episodeId',
      })
    }

    await prisma.videoEditorProject.upsert({
      where: { episodeId: episodeId || normalizedProjectData.episodeId },
      create: {
        episodeId: episodeId || normalizedProjectData.episodeId,
        projectData: JSON.stringify(normalizedProjectData),
        renderStatus: 'pending',
      },
      update: {
        projectData: JSON.stringify(normalizedProjectData),
      },
    })
  }

  const editorProject = await findEditorProjectByScope({
    projectId,
    editorProjectId,
    episodeId,
  })

  if (!editorProject) {
    throw new ApiError('NOT_FOUND')
  }

  const renderId = buildRenderId()

  await prisma.videoEditorProject.update({
    where: { id: editorProject.id },
    data: {
      renderStatus: 'rendering',
      renderTaskId: renderId,
      outputUrl: null,
    },
  })

  void runRender(editorProject.id, quality, renderId)

  return NextResponse.json({
    editorProjectId: editorProject.id,
    renderTaskId: renderId,
    status: 'rendering',
  })
})

export const GET = apiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) => {
  const { projectId } = await params

  const authResult = await requireProjectAuthLight(projectId)
  if (isErrorResponse(authResult)) return authResult

  const editorProjectId = request.nextUrl.searchParams.get('id') || ''
  const episodeId = request.nextUrl.searchParams.get('episodeId') || ''

  if (!editorProjectId && !episodeId) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'EDITOR_PROJECT_ID_REQUIRED',
      field: 'id',
    })
  }

  const editorProject = await findEditorProjectByScope({
    projectId,
    editorProjectId,
    episodeId,
  })

  if (!editorProject) {
    throw new ApiError('NOT_FOUND')
  }

  return NextResponse.json({
    editorProjectId: editorProject.id,
    renderTaskId: editorProject.renderTaskId,
    status: editorProject.renderStatus || 'pending',
    outputUrl: resolveOutputAccessUrl(editorProject.outputUrl),
    outputKey: editorProject.outputUrl,
  })
})
