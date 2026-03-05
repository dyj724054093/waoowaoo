import type { Pace, SeedancePanelExtension } from './types'
import { VALID_PACE } from './types'

export interface ValidationWarning {
  panelNumber: number
  type: 'density' | 'pace_jump' | 'duration_sum' | 'missing_field'
  message: string
  severity: 'info' | 'warning'
}

/**
 * 密度合理性检查。
 * 字/镜头 < 5 或 > 50 时生成 warning。
 */
export function validateDensity(
  panelCount: number,
  clipContentLength: number,
): ValidationWarning[] {
  if (panelCount === 0 || clipContentLength === 0) return []
  const ratio = clipContentLength / panelCount
  const warnings: ValidationWarning[] = []

  if (ratio < 5) {
    warnings.push({
      panelNumber: 0,
      type: 'density',
      message: `镜头密度过高：${panelCount}个镜头/${clipContentLength}字 (${ratio.toFixed(1)}字/镜头)`,
      severity: 'warning',
    })
  }
  if (ratio > 50) {
    warnings.push({
      panelNumber: 0,
      type: 'density',
      message: `镜头密度过低：${panelCount}个镜头/${clipContentLength}字 (${ratio.toFixed(1)}字/镜头)`,
      severity: 'warning',
    })
  }
  return warnings
}

/**
 * 节奏跳变检测。
 * pace 跨越 2 级以上（如 slow → intense）时生成 warning。
 */
export function validatePaceTransitions(
  panels: Array<{ panel_number: number; pace?: Pace }>,
): ValidationWarning[] {
  const PACE_ORDER: Record<Pace, number> = { slow: 0, normal: 1, fast: 2, intense: 3 }
  const warnings: ValidationWarning[] = []

  for (let i = 1; i < panels.length; i++) {
    const prev = panels[i - 1].pace
    const curr = panels[i].pace
    if (!prev || !curr) continue

    const diff = Math.abs(PACE_ORDER[curr] - PACE_ORDER[prev])
    if (diff > 2) {
      warnings.push({
        panelNumber: panels[i].panel_number,
        type: 'pace_jump',
        message: `节奏跳变：第${panels[i - 1].panel_number}镜(${prev}) → 第${panels[i].panel_number}镜(${curr})`,
        severity: 'warning',
      })
    }
  }
  return warnings
}

/**
 * expected_duration 总和校验。
 * 总时长超过 300 秒视为异常。
 */
export function validateDurationSum(
  panels: Array<{ expected_duration?: number }>,
): ValidationWarning[] {
  const withDuration = panels.filter(p => p.expected_duration != null)
  if (withDuration.length === 0) return []

  const totalSeconds = withDuration.reduce((sum, p) => sum + (p.expected_duration || 0), 0)
  if (totalSeconds > 300) {
    return [{
      panelNumber: 0,
      type: 'duration_sum',
      message: `预期总时长过长：${totalSeconds}秒 (${(totalSeconds / 60).toFixed(1)}分钟)`,
      severity: 'warning',
    }]
  }
  return []
}

/**
 * seedance 扩展字段填充率检查。
 * 填充率 < 50% 时生成 info。
 */
export function validateFieldPopulation(
  extensions: SeedancePanelExtension[],
): ValidationWarning[] {
  if (extensions.length === 0) return []

  const fields = ['expected_duration', 'pace', 'shot_relation'] as const
  const populated = extensions.filter(ext =>
    fields.some(f => ext[f] != null),
  ).length
  const rate = populated / extensions.length

  if (rate < 0.5) {
    return [{
      panelNumber: 0,
      type: 'missing_field',
      message: `seedance 扩展字段填充率低：${(rate * 100).toFixed(0)}% (${populated}/${extensions.length})`,
      severity: 'info',
    }]
  }
  return []
}

/**
 * 对一组 panel 执行全部 seedance 校验。
 * 返回 warning 列表，不阻塞生成。
 */
export function validateSeedanceOutput(
  panels: Array<{
    panel_number: number
    pace?: Pace
    expected_duration?: number
  }>,
  extensions: SeedancePanelExtension[],
  clipContentLength: number,
): ValidationWarning[] {
  return [
    ...validateDensity(panels.length, clipContentLength),
    ...validatePaceTransitions(panels),
    ...validateDurationSum(panels),
    ...validateFieldPopulation(extensions),
  ]
}
