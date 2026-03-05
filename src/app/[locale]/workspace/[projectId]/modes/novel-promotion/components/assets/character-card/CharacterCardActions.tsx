'use client'

import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import TaskStatusInline from '@/components/task/TaskStatusInline'
import type { TaskPresentationState } from '@/lib/task/presentation'
import { AppIcon } from '@/components/ui/icons'

type CharacterCardActionsProps =
  | {
    mode: 'selection'
    selectedIndex: number | null
    isConfirmingSelection: boolean
    confirmSelectionState: TaskPresentationState | null
    onConfirmSelection?: () => void
    isPrimaryAppearance: boolean
    voiceSettings: ReactNode
  }
  | {
    mode: 'compact'
    isPrimaryAppearance: boolean
    primaryAppearanceSelected: boolean
    currentImageUrl: string | null | undefined
    isAppearanceTaskRunning: boolean
    isAnyTaskRunning: boolean
    hasDescription: boolean
    canPauseTask: boolean
    isPausingTask: boolean
    canRetryTask: boolean
    onGenerate: () => void
    onPauseTask?: () => void
    onRetryTask?: () => void
    voiceSettings: ReactNode
  }

export default function CharacterCardActions(props: CharacterCardActionsProps) {
  const t = useTranslations('assets')

  if (props.mode === 'selection') {
    return (
      <>
        <div className="mt-3 text-xs text-[var(--glass-text-tertiary)] text-center">
          {t('image.selectTip')}
        </div>

        {props.selectedIndex !== null && (
          <div className="mt-4 flex justify-end">
            <button
              onClick={props.onConfirmSelection}
              disabled={props.isConfirmingSelection}
              className="px-4 py-2 bg-[var(--glass-tone-success-fg)] text-white rounded-lg hover:bg-[var(--glass-tone-success-fg)] transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-medium"
            >
              {props.isConfirmingSelection ? (
                <TaskStatusInline state={props.confirmSelectionState} className="text-white [&>span]:text-white [&_svg]:text-white" />
              ) : (
                <>
                  <AppIcon name="check" className="w-4 h-4" />
                  {t('image.confirmOption', { number: props.selectedIndex + 1 })}
                </>
              )}
            </button>
          </div>
        )}

        {props.isPrimaryAppearance && props.voiceSettings}
      </>
    )
  }

  return (
    <>
      {props.isPrimaryAppearance && props.voiceSettings}

      {props.canPauseTask && (
        <button
          type="button"
          onClick={props.onPauseTask}
          disabled={props.isPausingTask}
          className="glass-btn-base w-full py-1 text-xs glass-btn-tone-warning flex items-center justify-center gap-1 disabled:opacity-50"
        >
          {props.isPausingTask ? (
            <AppIcon name="loader" className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <AppIcon name="pause" className="w-3.5 h-3.5" />
          )}
          {props.isPausingTask ? t('common.loading') : t('tts.pause')}
        </button>
      )}

      {!props.canPauseTask && props.canRetryTask && (
        <button
          type="button"
          onClick={props.onRetryTask}
          className="glass-btn-base w-full py-1 text-xs glass-btn-tone-info flex items-center justify-center gap-1"
        >
          <AppIcon name="refresh" className="w-3.5 h-3.5" />
          {t('common.regenerate')}
        </button>
      )}

      {!props.canPauseTask && !props.canRetryTask && (
        !props.isPrimaryAppearance && !props.primaryAppearanceSelected ? (
          <div className="w-full py-2 text-xs text-center text-[var(--glass-text-tertiary)] bg-[var(--glass-bg-muted)] rounded border border-dashed border-[var(--glass-stroke-strong)]">
            <div className="flex items-center justify-center gap-1">
              <AppIcon name="lock" className="w-3 h-3" />
              {t('character.selectPrimaryFirst')}
            </div>
          </div>
        ) : (
          !props.currentImageUrl && !props.isAppearanceTaskRunning && !props.isAnyTaskRunning && (
            <button
              type="button"
              onClick={props.onGenerate}
              disabled={!props.hasDescription}
              className={`glass-btn-base w-full py-1 text-xs disabled:opacity-50 ${props.isPrimaryAppearance ? 'glass-btn-primary' : 'glass-btn-tone-info'}`}
            >
              {props.isPrimaryAppearance ? t('common.generate') : t('character.generateFromPrimary')}
            </button>
          )
        )
      )}
    </>
  )
}
