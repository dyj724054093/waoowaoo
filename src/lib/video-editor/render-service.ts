import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createScopedLogger } from '@/lib/logging/core'
import { extractCOSKey, generateUniqueKey, getSignedUrl, toFetchableUrl, uploadToCOS } from '@/lib/cos'
import { resolveStorageKeyFromMediaValue } from '@/lib/media/service'

type EditorClip = {
  id: string
  src: string
  durationInFrames: number
}

type EditorProjectConfig = {
  fps: number
  width: number
  height: number
}

type EditorProjectData = {
  id: string
  episodeId: string
  config: EditorProjectConfig
  timeline: EditorClip[]
}

type RenderQuality = 'draft' | 'high'

export type RenderEditorProjectInput = {
  project: EditorProjectData
  renderId: string
  quality?: RenderQuality
}

export type RenderEditorProjectResult = {
  outputKey: string
  clipCount: number
}

const renderLogger = createScopedLogger({
  module: 'video.editor.render',
})

function mapQualityToCrf(quality: RenderQuality): string {
  return quality === 'draft' ? '27' : '22'
}

function ensurePositiveInt(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

async function runCommand(bin: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      const message = stderr.trim() || `${bin} exited with code ${code}`
      reject(new Error(message))
    })
  })
}

async function ensureFfmpegExists() {
  try {
    await runCommand('ffmpeg', ['-version'])
  } catch {
    throw new Error('FFMPEG_NOT_FOUND: ffmpeg command is required for editor render')
  }
}

function getLocalMediaPathFromStorageKey(storageKey: string): string {
  const uploadDir = process.env.UPLOAD_DIR || './data/uploads'
  return path.resolve(uploadDir, storageKey)
}

async function downloadToFile(url: string, outputPath: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to download media: ${response.status} ${response.statusText}`)
  }
  const buffer = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(outputPath, buffer)
}

async function prepareClipSourceFile(source: string, outputPath: string): Promise<void> {
  const storageKeyFromMediaRef = await resolveStorageKeyFromMediaValue(source)
  const storageKey = storageKeyFromMediaRef || extractCOSKey(source)
  const isLocalStorage = (process.env.STORAGE_TYPE || 'cos') === 'local'

  if (isLocalStorage && storageKey) {
    const localPath = getLocalMediaPathFromStorageKey(storageKey)
    await fs.copyFile(localPath, outputPath)
    return
  }

  let fetchUrl = toFetchableUrl(source)
  if (storageKey) {
    fetchUrl = toFetchableUrl(getSignedUrl(storageKey, 2 * 60 * 60))
  }
  await downloadToFile(fetchUrl, outputPath)
}

function buildScaleFilter(width: number, height: number, fps: number): string {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
    `fps=${fps}`,
  ].join(',')
}

async function transcodeClip(params: {
  inputPath: string
  outputPath: string
  width: number
  height: number
  fps: number
  crf: string
  durationSeconds?: number
}) {
  const args = [
    '-y',
    '-i',
    params.inputPath,
    '-vf',
    buildScaleFilter(params.width, params.height, params.fps),
    '-r',
    String(params.fps),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    params.crf,
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
  ]

  if (typeof params.durationSeconds === 'number' && params.durationSeconds > 0) {
    args.push('-t', params.durationSeconds.toFixed(3))
  }

  args.push(params.outputPath)
  await runCommand('ffmpeg', args)
}

async function concatClips(params: {
  clipPaths: string[]
  outputPath: string
  crf: string
}): Promise<void> {
  const listFile = `${params.outputPath}.txt`
  const content = params.clipPaths
    .map((clipPath) => `file '${clipPath.replace(/'/g, `'\\''`)}'`)
    .join('\n')
  await fs.writeFile(listFile, content, 'utf8')

  await runCommand('ffmpeg', [
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFile,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    params.crf,
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    params.outputPath,
  ])
}

export async function renderEditorProjectToCos(input: RenderEditorProjectInput): Promise<RenderEditorProjectResult> {
  await ensureFfmpegExists()

  const quality: RenderQuality = input.quality === 'draft' ? 'draft' : 'high'
  const crf = mapQualityToCrf(quality)
  const fps = ensurePositiveInt(input.project.config?.fps || 30, 30)
  const width = ensurePositiveInt(input.project.config?.width || 1920, 1920)
  const height = ensurePositiveInt(input.project.config?.height || 1080, 1080)

  const clips = (input.project.timeline || []).filter((clip) => typeof clip?.src === 'string' && clip.src.trim().length > 0)
  if (clips.length === 0) {
    throw new Error('EDITOR_RENDER_EMPTY_TIMELINE: no video clips in timeline')
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `waoo-editor-render-${input.renderId}-`))

  try {
    const normalizedClipPaths: string[] = []

    for (let i = 0; i < clips.length; i += 1) {
      const clip = clips[i]
      const sourcePath = path.join(tempDir, `source-${String(i).padStart(4, '0')}.mp4`)
      const normalizedPath = path.join(tempDir, `normalized-${String(i).padStart(4, '0')}.mp4`)

      renderLogger.info({
        message: 'render clip process start',
        details: { renderId: input.renderId, clipIndex: i, clipId: clip.id },
      })
      await prepareClipSourceFile(clip.src, sourcePath)

      const durationSeconds = Number.isFinite(clip.durationInFrames) && clip.durationInFrames > 0
        ? clip.durationInFrames / fps
        : undefined

      await transcodeClip({
        inputPath: sourcePath,
        outputPath: normalizedPath,
        width,
        height,
        fps,
        crf,
        durationSeconds,
      })

      normalizedClipPaths.push(normalizedPath)
    }

    const outputPath = path.join(tempDir, 'editor-output.mp4')
    await concatClips({
      clipPaths: normalizedClipPaths,
      outputPath,
      crf,
    })

    const outputBuffer = await fs.readFile(outputPath)
    const outputKey = generateUniqueKey(`editor-render-${input.project.episodeId}`, 'mp4')
    const uploadedKey = await uploadToCOS(outputBuffer, outputKey)

    renderLogger.info({
      message: 'editor render completed',
      details: {
        renderId: input.renderId,
        outputKey: uploadedKey,
        clipCount: clips.length,
      },
    })

    return {
      outputKey: uploadedKey,
      clipCount: clips.length,
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}
