import {
  type CharacterLabel,
  type Emotion,
  type Pace,
  type SeedancePanelExtension,
  type ShotRelation,
  VALID_EMOTION,
  VALID_PACE,
  VALID_RELATION,
} from './types'

/**
 * 截断 duration 到 [2, 15] 范围。
 * 非法值返回 undefined（不阻塞生成）。
 */
export function clampDuration(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(15, Math.max(2, value))
}

function parseEnum<T extends string>(value: unknown, valid: readonly T[]): T | undefined {
  return typeof value === 'string' && (valid as readonly string[]).includes(value)
    ? (value as T)
    : undefined
}

export function isValidCharacterLabel(item: unknown): item is CharacterLabel {
  if (!item || typeof item !== 'object') return false
  const obj = item as Record<string, unknown>
  return (
    typeof obj.name === 'string' && obj.name.trim().length > 0
    && typeof obj.distinctive_tag === 'string' && obj.distinctive_tag.trim().length > 0
    && typeof obj.emotion === 'string' && (VALID_EMOTION as readonly string[]).includes(obj.emotion)
  )
}

/**
 * 从 LLM 原始输出解析 seedance 扩展字段。
 * 所有字段容错：解析失败返回 undefined，不触发重试，不阻塞生成。
 */
export function parseSeedanceExtension(
  raw: Record<string, unknown>,
  isLastPanel: boolean,
): SeedancePanelExtension {
  return {
    expected_duration: clampDuration(raw.expected_duration),
    shot_relation: isLastPanel
      ? null
      : (parseEnum<ShotRelation>(raw.shot_relation, VALID_RELATION) ?? undefined),
    pace: parseEnum<Pace>(raw.pace, VALID_PACE),
    character_labels: Array.isArray(raw.character_labels)
      ? (raw.character_labels as unknown[]).filter(isValidCharacterLabel)
      : undefined,
  }
}

/**
 * 批量解析一组 panel 的 seedance 扩展字段。
 */
export function parseSeedancePanels(
  panels: Record<string, unknown>[],
): SeedancePanelExtension[] {
  return panels.map((panel, index) =>
    parseSeedanceExtension(panel, index === panels.length - 1),
  )
}
