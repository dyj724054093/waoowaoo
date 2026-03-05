// ── Seedance 扩展类型定义 ──

export type Pace = 'slow' | 'normal' | 'fast' | 'intense'
export type ShotRelation = 'continuity' | 'jump' | 'contrast' | 'cause'
export type Emotion = 'calm' | 'tense' | 'angry' | 'sad' | 'joyful'

export const VALID_PACE: readonly Pace[] = ['slow', 'normal', 'fast', 'intense'] as const
export const VALID_RELATION: readonly ShotRelation[] = ['continuity', 'jump', 'contrast', 'cause'] as const
export const VALID_EMOTION: readonly Emotion[] = ['calm', 'tense', 'angry', 'sad', 'joyful'] as const

export interface CharacterLabel {
  name: string
  distinctive_tag: string
  emotion: Emotion
}

export interface SeedancePanelExtension {
  expected_duration?: number
  shot_relation?: ShotRelation | null
  pace?: Pace
  character_labels?: CharacterLabel[]
}

export interface TailFrameHint {
  lastFrameDescription: string
  motionDirection: string
  dominantMood: string
}

/** 镜头关系 → 转场类型映射 */
export const RELATION_TO_TRANSITION: Record<ShotRelation, string> = {
  continuity: 'cut',
  jump: 'dissolve',
  contrast: 'fade',
  cause: 'cut',
}
