import type { Pace, ShotRelation } from './types'

// ── 镜头关系 → 转场映射 ──

export interface CompositionTransition {
  type: 'none' | 'dissolve' | 'fade' | 'slide'
  durationInFrames: number
}

const RELATION_TO_COMPOSITION: Record<ShotRelation, CompositionTransition> = {
  continuity: { type: 'none', durationInFrames: 0 },
  jump:       { type: 'dissolve', durationInFrames: 15 },
  contrast:   { type: 'fade', durationInFrames: 24 },
  cause:      { type: 'none', durationInFrames: 0 },
}

const DEFAULT_TRANSITION: CompositionTransition = {
  type: 'dissolve',
  durationInFrames: 15,
}

const PACE_MULTIPLIER: Record<Pace, number> = {
  slow: 1.5,
  normal: 1.0,
  fast: 0.7,
  intense: 0.4,
}

/**
 * 根据 pace 修正转场时长。
 * 快节奏场景压缩转场时间，慢节奏加长。
 */
function adjustByPace(
  base: CompositionTransition,
  pace: Pace | undefined,
): CompositionTransition {
  if (!pace || base.durationInFrames === 0) return base

  return {
    ...base,
    durationInFrames: Math.max(1, Math.round(base.durationInFrames * PACE_MULTIPLIER[pace])),
  }
}

/**
 * 根据 shotRelation 和 pace 计算单个转场参数。
 * 最后一个 panel 无转场（返回 undefined）。
 */
export function resolveTransition(
  shotRelation: ShotRelation | null | undefined,
  pace: Pace | undefined,
  isLastPanel: boolean,
): CompositionTransition | undefined {
  if (isLastPanel) return undefined

  const base = shotRelation
    ? RELATION_TO_COMPOSITION[shotRelation]
    : DEFAULT_TRANSITION

  const adjusted = adjustByPace(base, pace)

  if (adjusted.type === 'none' || adjusted.durationInFrames === 0) {
    return undefined
  }

  return {
    type: adjusted.type,
    durationInFrames: adjusted.durationInFrames,
  }
}

/**
 * 批量为 panel 列表生成转场参数。
 * 返回与 panels 等长的数组，每个元素为对应 panel 的出场转场（最后一个为 undefined）。
 */
export function resolveTransitions(
  panels: Array<{
    shotRelation?: ShotRelation | null
    pace?: Pace
  }>,
): Array<CompositionTransition | undefined> {
  return panels.map((panel, index) =>
    resolveTransition(
      panel.shotRelation as ShotRelation | null | undefined,
      panel.pace as Pace | undefined,
      index === panels.length - 1,
    ),
  )
}
