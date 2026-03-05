import type { SeedancePanelExtension, Pace } from './types'

// ── 时间轴段落 ──

export interface TimelineSegment {
  startTime: number
  endTime: number
  prompt: string
}

/**
 * 将 seedance panel 扩展数据编译为时间轴段落列表。
 * 每个 panel 产生一个 segment，时间按 expected_duration 累加。
 */
export function compileSeedanceTimeline(
  panels: Array<{
    description?: string
    character_labels?: SeedancePanelExtension['character_labels']
    expected_duration?: number
    shot_type?: string
    camera_move?: string
  }>,
): TimelineSegment[] {
  let currentTime = 0

  return panels.map(panel => {
    const duration = panel.expected_duration || 4
    const segment: TimelineSegment = {
      startTime: currentTime,
      endTime: currentTime + duration,
      prompt: buildSegmentPrompt(panel),
    }
    currentTime += duration
    return segment
  })
}

function buildSegmentPrompt(panel: {
  description?: string
  character_labels?: SeedancePanelExtension['character_labels']
  shot_type?: string
  camera_move?: string
}): string {
  const parts: string[] = []

  if (panel.description) {
    parts.push(panel.description)
  }

  if (panel.character_labels?.length) {
    const labels = panel.character_labels
      .map(c => `${c.distinctive_tag}(${c.emotion})`)
      .join(', ')
    parts.push(`角色: ${labels}`)
  }

  const techParts: string[] = []
  if (panel.shot_type) techParts.push(panel.shot_type)
  if (panel.camera_move && panel.camera_move !== '固定') techParts.push(panel.camera_move)
  if (techParts.length > 0) {
    parts.push(techParts.join(', '))
  }

  return parts.join('. ')
}

/**
 * 将时间轴段落列表编译为可送入视频模型的 prompt 字符串。
 * 文本标注格式（兼容所有模型）。
 */
export function compileTimelineToPrompt(segments: TimelineSegment[]): string {
  if (segments.length === 0) return ''
  if (segments.length === 1) return segments[0].prompt

  return segments
    .map(s => `[${s.startTime}s-${s.endTime}s] ${s.prompt}`)
    .join('\n')
}
