import OpenAI, { toFile } from 'openai'
import { BaseVideoGenerator, type GenerateResult, type VideoGenerateParams } from '../base'
import { getProviderConfig } from '@/lib/api-config'
import { imageUrlToBase64 } from '@/lib/cos'

type OpenAIVideoSize = '720x1280' | '1280x720' | '1024x1792' | '1792x1024'
type OpenAIVideoSeconds = '4' | '8' | '12'
type OpenAIVideoAspectRatio =
  | '16:9'
  | '9:16'
  | '4:3'
  | '3:4'
  | '3:2'
  | '2:3'
  | '21:9'
  | '9:21'
  | '1:1'
  | 'auto'

type GrokVideoAspectRatio = '16:9' | '9:16' | '3:2' | '2:3' | '1:1'
type GrokVideoLength = 6 | 10 | 15
type GrokVideoResolution = '480p' | '720p'

const GROK_IMAGINE_VIDEO_MODEL = 'grok-imagine-1.0-video'
const BROWSER_LIKE_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseDataUrl(value: string): { mimeType: string; base64: string } | null {
  const marker = ';base64,'
  const markerIndex = value.indexOf(marker)
  if (!value.startsWith('data:') || markerIndex === -1) return null
  const mimeType = value.slice(5, markerIndex)
  const base64 = value.slice(markerIndex + marker.length)
  if (!mimeType || !base64) return null
  return { mimeType, base64 }
}

function normalizeDuration(value: unknown): OpenAIVideoSeconds | undefined {
  if (value === 4 || value === '4') return '4'
  if (value === 8 || value === '8') return '8'
  if (value === 12 || value === '12') return '12'
  if (value === undefined) return undefined
  throw new Error(`OPENAI_VIDEO_DURATION_UNSUPPORTED: ${String(value)}`)
}

function normalizeAspectRatio(value: unknown): OpenAIVideoAspectRatio | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') {
    throw new Error(`OPENAI_VIDEO_ASPECT_RATIO_UNSUPPORTED: ${String(value)}`)
  }
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (
    trimmed === '16:9'
    || trimmed === '9:16'
    || trimmed === '4:3'
    || trimmed === '3:4'
    || trimmed === '3:2'
    || trimmed === '2:3'
    || trimmed === '21:9'
    || trimmed === '9:21'
    || trimmed === '1:1'
    || trimmed === 'auto'
  ) {
    return trimmed
  }
  throw new Error(`OPENAI_VIDEO_ASPECT_RATIO_UNSUPPORTED: ${trimmed}`)
}

function normalizeModel(value: unknown): string {
  if (value === undefined || value === null || value === '') return 'sora-2'
  if (typeof value !== 'string') {
    throw new Error(`OPENAI_VIDEO_MODEL_INVALID: ${String(value)}`)
  }
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('OPENAI_VIDEO_MODEL_INVALID: empty model id')
  }
  return trimmed
}

function resolveSizeOrientation(aspectRatio: OpenAIVideoAspectRatio | undefined): 'portrait' | 'landscape' {
  if (
    aspectRatio === '9:16'
    || aspectRatio === '3:4'
    || aspectRatio === '2:3'
    || aspectRatio === '9:21'
  ) {
    return 'portrait'
  }
  return 'landscape'
}

function normalizeSize(value: unknown, aspectRatio: OpenAIVideoAspectRatio | undefined): OpenAIVideoSize | undefined {
  if (value === '720x1280' || value === '1280x720' || value === '1024x1792' || value === '1792x1024') {
    return value
  }

  const orientation = resolveSizeOrientation(aspectRatio)

  if (value === '720p') {
    return orientation === 'portrait' ? '720x1280' : '1280x720'
  }
  if (value === '1080p') {
    return orientation === 'portrait' ? '1024x1792' : '1792x1024'
  }

  if (value === undefined) return undefined
  throw new Error(`OPENAI_VIDEO_SIZE_UNSUPPORTED: ${String(value)}`)
}

function resolveFinalSize(options: Record<string, unknown>): OpenAIVideoSize | undefined {
  const aspectRatioRaw = options.aspectRatio ?? options.aspect_ratio
  const aspectRatio = normalizeAspectRatio(aspectRatioRaw)
  const rawSize = options.size
  const rawResolution = options.resolution
  const normalizedSize = rawSize === undefined ? undefined : normalizeSize(rawSize, aspectRatio)
  const normalizedResolution = rawResolution === undefined ? undefined : normalizeSize(rawResolution, aspectRatio)
  if (normalizedSize && normalizedResolution && normalizedSize !== normalizedResolution) {
    throw new Error('OPENAI_VIDEO_SIZE_CONFLICT: size and resolution must match')
  }
  return normalizedSize || normalizedResolution
}

function normalizeModelForProvider(model: string): string {
  const trimmed = model.trim()
  const [providerModel = trimmed] = trimmed.split('::').slice(-1)
  return providerModel || trimmed
}

function shouldUseGrokChatVideoProtocol(model: string): boolean {
  return normalizeModelForProvider(model) === GROK_IMAGINE_VIDEO_MODEL
}

function resolveGrokVideoAspectRatio(value: unknown): GrokVideoAspectRatio {
  if (value === undefined || value === null || value === '') return '3:2'
  if (typeof value !== 'string') {
    throw new Error(`GROK_VIDEO_ASPECT_RATIO_UNSUPPORTED: ${String(value)}`)
  }
  const trimmed = value.trim()
  const mapped: Record<string, GrokVideoAspectRatio> = {
    '16:9': '16:9',
    '9:16': '9:16',
    '3:2': '3:2',
    '2:3': '2:3',
    '1:1': '1:1',
    '1280x720': '16:9',
    '720x1280': '9:16',
    '1792x1024': '3:2',
    '1024x1792': '2:3',
    '1024x1024': '1:1',
  }
  const next = mapped[trimmed]
  if (!next) {
    throw new Error(`GROK_VIDEO_ASPECT_RATIO_UNSUPPORTED: ${trimmed}`)
  }
  return next
}

function resolveGrokVideoLength(value: unknown): GrokVideoLength {
  if (value === undefined || value === null || value === '') return 6

  const normalized = typeof value === 'string' ? Number.parseInt(value, 10) : value
  if (normalized === 6 || normalized === 10 || normalized === 15) {
    return normalized
  }
  throw new Error(`GROK_VIDEO_LENGTH_UNSUPPORTED: ${String(value)}`)
}

function resolveGrokVideoResolution(value: unknown): GrokVideoResolution {
  if (value === undefined || value === null || value === '') return '480p'
  if (value === 'SD' || value === 'sd') return '480p'
  if (value === 'HD' || value === 'hd') return '720p'
  if (value === '480p' || value === '720p') return value
  throw new Error(`GROK_VIDEO_RESOLUTION_UNSUPPORTED: ${String(value)}`)
}

function toLegacyGrokResolution(value: GrokVideoResolution): 'SD' | 'HD' {
  return value === '720p' ? 'HD' : 'SD'
}

function normalizeMessageContentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const item of content) {
    if (!isRecord(item)) continue
    const text = typeof item.text === 'string' ? item.text : ''
    if (text) parts.push(text)

    const url = isRecord(item.image_url) && typeof item.image_url.url === 'string'
      ? item.image_url.url
      : ''
    if (url) parts.push(url)
  }

  return parts.join('\n')
}

function extractVideoUrlFromContent(content: string): string | null {
  const videoTag = content.match(/<video[^>]*\ssrc=[\"']([^\"']+)[\"']/i)
  if (videoTag?.[1]) return videoTag[1]

  const mediaUrl = content.match(/https?:\/\/[^\s\"'<>]+\.(mp4|webm|mov)(\?[^\s\"'<>]*)?/i)
  if (mediaUrl?.[0]) return mediaUrl[0]

  const anyUrl = content.match(/https?:\/\/[^\s\"'<>]+/i)
  if (anyUrl?.[0]) return anyUrl[0]

  return null
}

async function createVideoViaGrokChatCompletions(params: {
  baseUrl: string
  apiKey: string
  model: string
  prompt: string
  imageUrl?: string
  aspectRatio: GrokVideoAspectRatio
  videoLength: GrokVideoLength
  resolutionName: GrokVideoResolution
  preset: 'custom' | 'fun' | 'normal' | 'spicy'
}): Promise<{ videoUrl: string }> {
  const endpoint = `${params.baseUrl.replace(/\/+$/, '')}/chat/completions`
  const normalizedImageUrl = params.imageUrl
    ? (params.imageUrl.startsWith('data:') ? params.imageUrl : await imageUrlToBase64(params.imageUrl))
    : undefined
  const content = normalizedImageUrl
    ? [
      { type: 'text', text: params.prompt },
      { type: 'image_url', image_url: { url: normalizedImageUrl } },
    ]
    : params.prompt

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${params.apiKey}`,
      'User-Agent': BROWSER_LIKE_USER_AGENT,
    },
    body: JSON.stringify({
      model: params.model,
      messages: [{ role: 'user', content }],
      stream: false,
      video_config: {
        aspect_ratio: params.aspectRatio,
        video_length: params.videoLength,
        resolution: toLegacyGrokResolution(params.resolutionName),
        resolution_name: params.resolutionName,
        preset: params.preset,
      },
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OPENAI_VIDEO_CHAT_COMPLETIONS_FAILED: ${response.status} ${text.slice(0, 300)}`)
  }

  const payload = await response.json().catch(() => null) as unknown
  if (!isRecord(payload)) {
    throw new Error('OPENAI_VIDEO_CHAT_COMPLETIONS_INVALID_RESPONSE: response is not an object')
  }

  let rawContent = ''
  const choices = payload.choices
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0]
    if (isRecord(first)) {
      const message = first.message
      if (isRecord(message)) {
        rawContent = normalizeMessageContentToText(message.content)
      }
    }
  }

  if (!rawContent && typeof payload.video_url === 'string') {
    rawContent = payload.video_url
  }

  const videoUrl = extractVideoUrlFromContent(rawContent)
  if (!videoUrl) {
    throw new Error(`OPENAI_VIDEO_CHAT_COMPLETIONS_INVALID_RESPONSE: ${rawContent.slice(0, 300)}`)
  }

  return { videoUrl }
}

export function encodeProviderId(providerId: string): string {
  return Buffer.from(providerId, 'utf8').toString('base64url')
}

async function toUploadFileFromImageUrl(imageUrl: string): Promise<File> {
  const base64DataUrl = imageUrl.startsWith('data:') ? imageUrl : await imageUrlToBase64(imageUrl)
  const parsed = parseDataUrl(base64DataUrl)
  if (!parsed) {
    throw new Error('OPENAI_VIDEO_INPUT_REFERENCE_INVALID')
  }
  const bytes = Buffer.from(parsed.base64, 'base64')
  return await toFile(bytes, 'input-reference.png', { type: parsed.mimeType })
}

/**
 * Fallback: POST /video/create (non-standard OpenAI-compatible endpoint)
 */
async function createVideoViaFetchFallback(
  baseUrl: string,
  apiKey: string,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const url = `${baseUrl.replace(/\/+$/, '')}/video/create`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`OPENAI_VIDEO_CREATE_FALLBACK_FAILED: ${response.status} ${text.slice(0, 200)}`)
  }

  const data = await response.json() as Record<string, unknown>
  const id = typeof data.id === 'string' ? data.id.trim() : ''
  if (!id) {
    throw new Error('OPENAI_VIDEO_CREATE_FALLBACK_INVALID_RESPONSE: missing id')
  }
  return { id }
}

/**
 * Detect endpoint unsupported errors (404/405/500 no body)
 */
function isEndpointUnsupportedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message || ''
  if (/\b(404|405)\b/.test(message)) return true
  if (/500\s*status\s*code\s*\(no\s*body\)/i.test(message)) return true
  if (/get_channel_failed/i.test(message)) return true
  const statusCode = (error as { status?: number }).status
  if (statusCode === 404 || statusCode === 405) return true
  return false
}

export class OpenAICompatibleVideoGenerator extends BaseVideoGenerator {
  private readonly providerId?: string

  constructor(providerId?: string) {
    super()
    this.providerId = providerId
  }

  protected async doGenerate(params: VideoGenerateParams): Promise<GenerateResult> {
    const { userId, imageUrl, prompt = '', options = {} } = params
    const providerId = this.providerId || 'openai-compatible'
    const config = await getProviderConfig(userId, providerId)
    if (!config.baseUrl) {
      throw new Error(`PROVIDER_BASE_URL_MISSING: ${config.id}`)
    }

    const allowedOptionKeys = new Set([
      'provider',
      'modelId',
      'modelKey',
      'duration',
      'resolution',
      'aspectRatio',
      'aspect_ratio',
      'size',
      'generateAudio',
      'generationMode',
      'preset',
    ])
    for (const [key, value] of Object.entries(options)) {
      if (value === undefined) continue
      if (!allowedOptionKeys.has(key)) {
        // Silently skip unknown options for custom model compatibility
      }
    }

    const model = normalizeModel(options.modelId)
    const trimmedPrompt = prompt.trim()
    if (!trimmedPrompt) {
      throw new Error('OPENAI_VIDEO_PROMPT_REQUIRED')
    }

    // Some Grok-compatible gateways expose video generation through
    // chat/completions + video_config, not OpenAI /videos endpoints.
    if (shouldUseGrokChatVideoProtocol(model)) {
      const grokResult = await createVideoViaGrokChatCompletions({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: normalizeModelForProvider(model),
        prompt: trimmedPrompt,
        imageUrl: imageUrl || undefined,
        aspectRatio: resolveGrokVideoAspectRatio(options.aspectRatio ?? options.aspect_ratio),
        videoLength: resolveGrokVideoLength(options.duration),
        resolutionName: resolveGrokVideoResolution(options.resolution),
        preset: options.preset === 'fun' || options.preset === 'normal' || options.preset === 'spicy'
          ? options.preset
          : 'custom',
      })
      return {
        success: true,
        videoUrl: grokResult.videoUrl,
      }
    }

    const seconds = normalizeDuration(options.duration)
    const size = resolveFinalSize(options)
    const requestPayload: Record<string, unknown> = {
      prompt: trimmedPrompt,
      model,
      ...(seconds ? { seconds } : {}),
      ...(size ? { size } : {}),
    }

    let inputReference: File | undefined
    if (imageUrl) {
      inputReference = await toUploadFileFromImageUrl(imageUrl)
    }

    // Strategy: try OpenAI SDK first (/v1/videos), fallback to /video/create.
    let videoId: string

    try {
      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      })
      const sdkPayload = {
        ...requestPayload,
        ...(inputReference ? { input_reference: inputReference } : {}),
      }
      const response = await client.videos.create(
        sdkPayload as Parameters<typeof client.videos.create>[0],
      )
      if (!response.id || typeof response.id !== 'string') {
        throw new Error('OPENAI_VIDEO_CREATE_INVALID_RESPONSE: missing video id')
      }
      videoId = response.id
    } catch (sdkError) {
      if (!isEndpointUnsupportedError(sdkError)) {
        throw sdkError
      }

      const fallbackPayload: Record<string, unknown> = { ...requestPayload }
      if (imageUrl) {
        fallbackPayload.image_url = imageUrl
      }
      const fallbackResult = await createVideoViaFetchFallback(
        config.baseUrl,
        config.apiKey,
        fallbackPayload,
      )
      videoId = fallbackResult.id
    }

    const providerToken = encodeProviderId(config.id)
    return {
      success: true,
      async: true,
      requestId: videoId,
      externalId: `OPENAI:VIDEO:${providerToken}:${videoId}`,
    }
  }
}
