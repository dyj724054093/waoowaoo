'use client'

import { logError as _ulogError } from '@/lib/logging/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  VideoToolbar,
  type VideoGenerationOptionValue,
  type VideoGenerationOptions,
  type VideoModelOption,
} from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video'
import { AppIcon } from '@/components/ui/icons'
import {
  useDownloadRemoteBlob,
  useListProjectEpisodeVideoUrls,
  useMatchedVoiceLines,
  useUpdateProjectPanelLink,
} from '@/lib/query/hooks'
import { useLipSync } from '@/lib/query/hooks/useStoryboards'
import ImagePreviewModal from '@/components/ui/ImagePreviewModal'
import { ModelCapabilityDropdown } from '@/components/ui/config-modals/ModelCapabilityDropdown'
import VideoTimelinePanel from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/VideoTimelinePanel'
import VideoRenderPanel from '@/app/[locale]/workspace/[projectId]/modes/novel-promotion/components/video-stage/VideoRenderPanel'
import type { VideoStageShellProps } from './video-stage-runtime/types'
import {
  type EffectiveVideoCapabilityDefinition,
  normalizeVideoGenerationSelections,
  resolveEffectiveVideoCapabilityDefinitions,
  resolveEffectiveVideoCapabilityFields,
} from '@/lib/model-capabilities/video-effective'
import { projectVideoPricingTiersByFixedSelections } from '@/lib/model-pricing/video-tier'
import { useVideoTaskStates } from './video-stage-runtime/useVideoTaskStates'
import { useVideoPanelsProjection } from './video-stage-runtime/useVideoPanelsProjection'
import { useVideoPromptState } from './video-stage-runtime/useVideoPromptState'
import { useVideoPanelLinking } from './video-stage-runtime/useVideoPanelLinking'
import { useVideoVoiceLines } from './video-stage-runtime/useVideoVoiceLines'
import { useVideoDownloadAll } from './video-stage-runtime/useVideoDownloadAll'
import { useVideoStageUiState } from './video-stage-runtime/useVideoStageUiState'
import { useVideoPanelViewport } from './video-stage-runtime/useVideoPanelViewport'
import { useVideoFirstLastFrameFlow } from './video-stage-runtime/useVideoFirstLastFrameFlow'

export type { VideoStageShellProps } from './video-stage-runtime/types'

type BatchCapabilityDefinition = EffectiveVideoCapabilityDefinition

interface BatchCapabilityField {
  field: string
  label: string
  labelKey?: string
  unitKey?: string
  options: VideoGenerationOptionValue[]
  disabledOptions?: VideoGenerationOptionValue[]
}

function toFieldLabel(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase())
}

type FinalRenderStatus = 'idle' | 'rendering' | 'completed' | 'failed'

function normalizeFinalRenderStatus(value: unknown): FinalRenderStatus {
  if (value === 'rendering') return 'rendering'
  if (value === 'completed') return 'completed'
  if (value === 'failed') return 'failed'
  return 'idle'
}

export function useVideoStageRuntime({
  projectId,
  episodeId,
  storyboards,
  clips,
  defaultVideoModel,
  capabilityOverrides,
  videoRatio = '16:9',
  userVideoModels,
  onGenerateVideo,
  onGenerateAllVideos,
  onBack,
  onUpdateVideoPrompt,
  onUpdatePanelVideoModel,
  onOpenAssetLibraryForCharacter,
  onEnterEditor,
}: VideoStageShellProps) {
  const t = useTranslations('video')

  const {
    panelVideoPreference,
    voiceLinesExpanded,
    previewImage,
    setPreviewImage,
    toggleVoiceLinesExpanded,
    toggleLipSyncVideo,
    closePreviewImage,
  } = useVideoStageUiState()

  const {
    panelRefs,
    highlightedPanelKey,
    locateVoiceLinePanel,
  } = useVideoPanelViewport()

  const lipSyncMutation = useLipSync(projectId, episodeId)
  const listEpisodeVideoUrlsMutation = useListProjectEpisodeVideoUrls(projectId)
  const updatePanelLinkMutation = useUpdateProjectPanelLink(projectId)
  const downloadRemoteBlobMutation = useDownloadRemoteBlob()
  const matchedVoiceLinesQuery = useMatchedVoiceLines(projectId, episodeId)

  const { panelVideoStates, panelLipStates } = useVideoTaskStates({
    projectId,
    storyboards,
  })
  const { allPanels } = useVideoPanelsProjection({
    storyboards,
    clips,
    panelVideoStates,
    panelLipStates,
  })

  const {
    savingPrompts,
    getLocalPrompt,
    updateLocalPrompt,
    savePrompt,
  } = useVideoPromptState({
    allPanels,
    onUpdateVideoPrompt,
  })

  const { linkedPanels, handleToggleLink } = useVideoPanelLinking({
    allPanels,
    updatePanelLinkMutation,
  })

  const {
    panelVoiceLines,
    allVoiceLines,
    runningVoiceLineIds,
    reloadVoiceLines,
  } = useVideoVoiceLines({
    projectId,
    matchedVoiceLinesQuery,
  })

  const {
    isDownloading,
    videosWithUrl,
    handleDownloadAllVideos,
  } = useVideoDownloadAll({
    episodeId,
    t: (key) => t(key as never),
    allPanels,
    panelVideoPreference,
    listEpisodeVideoUrlsMutation,
    downloadRemoteBlobMutation,
  })

  const {
    flModel,
    flModelOptions,
    flGenerationOptions,
    flCapabilityFields,
    flMissingCapabilityFields,
    flCustomPrompts,
    setFlModel,
    setFlCapabilityValue,
    setFlCustomPrompt,
    resetFlCustomPrompt,
    handleGenerateFirstLastFrame,
    getDefaultFlPrompt,
    getNextPanel,
    isLinkedAsLastFrame,
  } = useVideoFirstLastFrameFlow({
    allPanels,
    linkedPanels,
    videoModelOptions: userVideoModels || [],
    onGenerateVideo,
    t: (key) => t(key as never),
  })

  const safeTranslate = useCallback((key: string | undefined, fallback = ''): string => {
    if (!key) return fallback
    try {
      return t(key as never)
    } catch {
      return fallback
    }
  }, [t])

  const renderCapabilityLabel = useCallback((field: {
    field: string
    label: string
    labelKey?: string
    unitKey?: string
  }): string => {
    const labelText = safeTranslate(field.labelKey, safeTranslate(`capability.${field.field}`, field.label))
    const unitText = safeTranslate(field.unitKey)
    return unitText ? `${labelText} (${unitText})` : labelText
  }, [safeTranslate])

  const allVideoModelOptions = useMemo(
    () => userVideoModels || [],
    [userVideoModels],
  )
  const [isBatchConfigOpen, setIsBatchConfigOpen] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)
  const [batchSelectedModel, setBatchSelectedModel] = useState('')
  const [batchGenerationOptions, setBatchGenerationOptions] = useState<VideoGenerationOptions>({})
  const [finalRenderStatus, setFinalRenderStatus] = useState<FinalRenderStatus>('idle')
  const [finalRenderTaskId, setFinalRenderTaskId] = useState<string | null>(null)
  const [finalRenderOutputUrl, setFinalRenderOutputUrl] = useState<string | null>(null)
  const [isFinalRendering, setIsFinalRendering] = useState(false)
  const finalRenderPollTimerRef = useRef<number | null>(null)

  const stopFinalRenderPolling = useCallback(() => {
    if (finalRenderPollTimerRef.current) {
      clearTimeout(finalRenderPollTimerRef.current)
      finalRenderPollTimerRef.current = null
    }
    setIsFinalRendering(false)
  }, [])

  useEffect(() => {
    return () => {
      if (finalRenderPollTimerRef.current) {
        clearTimeout(finalRenderPollTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (allVideoModelOptions.length === 0) {
      if (batchSelectedModel) setBatchSelectedModel('')
      return
    }
    if (allVideoModelOptions.some((model) => model.value === batchSelectedModel)) return

    const nextDefault = allVideoModelOptions.some((model) => model.value === defaultVideoModel)
      ? defaultVideoModel
      : ''
    setBatchSelectedModel(nextDefault)
  }, [allVideoModelOptions, batchSelectedModel, defaultVideoModel])

  const selectedBatchModelOption = useMemo<VideoModelOption | undefined>(
    () => allVideoModelOptions.find((option) => option.value === batchSelectedModel),
    [allVideoModelOptions, batchSelectedModel],
  )
  const batchPricingTiers = useMemo(
    () => projectVideoPricingTiersByFixedSelections({
      tiers: selectedBatchModelOption?.videoPricingTiers ?? [],
      fixedSelections: {
        generationMode: 'normal',
      },
    }),
    [selectedBatchModelOption?.videoPricingTiers],
  )

  const batchCapabilityDefinitions = useMemo<BatchCapabilityDefinition[]>(() => {
    return resolveEffectiveVideoCapabilityDefinitions({
      videoCapabilities: selectedBatchModelOption?.capabilities?.video,
      pricingTiers: batchPricingTiers,
    })
  }, [batchPricingTiers, selectedBatchModelOption?.capabilities?.video])

  useEffect(() => {
    setBatchGenerationOptions((previous) => {
      return normalizeVideoGenerationSelections({
        definitions: batchCapabilityDefinitions,
        pricingTiers: batchPricingTiers,
        selection: previous,
      })
    })
  }, [batchCapabilityDefinitions, batchPricingTiers])

  const batchEffectiveCapabilityFields = useMemo(
    () => resolveEffectiveVideoCapabilityFields({
      definitions: batchCapabilityDefinitions,
      pricingTiers: batchPricingTiers,
      selection: batchGenerationOptions,
    }),
    [batchCapabilityDefinitions, batchGenerationOptions, batchPricingTiers],
  )

  const batchEffectiveFieldMap = useMemo(
    () => new Map(batchEffectiveCapabilityFields.map((field) => [field.field, field])),
    [batchEffectiveCapabilityFields],
  )
  const batchDefinitionFieldMap = useMemo(
    () => new Map(batchCapabilityDefinitions.map((definition) => [definition.field, definition])),
    [batchCapabilityDefinitions],
  )

  const batchCapabilityFields = useMemo<BatchCapabilityField[]>(() => {
    return batchCapabilityDefinitions.map((definition) => {
      const effectiveField = batchEffectiveFieldMap.get(definition.field)
      const enabledOptions = effectiveField?.options ?? []
      return {
        field: definition.field,
        label: toFieldLabel(definition.field),
        labelKey: definition.fieldI18n?.labelKey,
        unitKey: definition.fieldI18n?.unitKey,
        options: definition.options as VideoGenerationOptionValue[],
        disabledOptions: (definition.options as VideoGenerationOptionValue[])
          .filter((option) => !enabledOptions.includes(option)),
      }
    })
  }, [batchCapabilityDefinitions, batchEffectiveFieldMap])

  const batchMissingCapabilityFields = useMemo(
    () => batchEffectiveCapabilityFields
      .filter((field) => field.options.length === 0 || field.value === undefined)
      .map((field) => field.field),
    [batchEffectiveCapabilityFields],
  )

  const setBatchCapabilityValue = useCallback((field: string, rawValue: string) => {
    const capabilityDefinition = batchDefinitionFieldMap.get(field)
    if (!capabilityDefinition || capabilityDefinition.options.length === 0) return
    const sample = capabilityDefinition.options[0]
    const parsedValue =
      typeof sample === 'number'
        ? Number(rawValue)
        : typeof sample === 'boolean'
          ? rawValue === 'true'
          : rawValue
    if (!capabilityDefinition.options.includes(parsedValue)) return
    setBatchGenerationOptions((previous) => ({
      ...normalizeVideoGenerationSelections({
        definitions: batchCapabilityDefinitions,
        pricingTiers: batchPricingTiers,
        selection: {
          ...previous,
          [field]: parsedValue,
        },
        pinnedFields: [field],
      }),
    }))
  }, [batchCapabilityDefinitions, batchDefinitionFieldMap, batchPricingTiers])

  const handleLipSync = useCallback(async (
    storyboardId: string,
    panelIndex: number,
    voiceLineId: string,
    panelId?: string,
  ) => {
    try {
      await lipSyncMutation.mutateAsync({
        storyboardId,
        panelIndex,
        voiceLineId,
        panelId,
      })
    } catch (error: unknown) {
      _ulogError('Lip sync error:', error)
      throw error
    }
  }, [lipSyncMutation])

  const runningCount = allPanels.filter((panel) => panel.videoTaskRunning || panel.lipSyncTaskRunning).length
  const failedCount = allPanels.filter((panel) => !!panel.videoErrorMessage || !!panel.lipSyncErrorMessage).length
  const isAnyTaskRunning = runningCount > 0
  const canSubmitBatchGenerate = !!batchSelectedModel && batchMissingCapabilityFields.length === 0

  const finalRenderTimeline = useMemo(() => {
    return allPanels
      .map((panel, index) => {
        // If previous panel is linked to current panel as a first-last-frame pair,
        // skip current panel to avoid duplicate/unnatural concatenation.
        if (index > 0) {
          const prev = allPanels[index - 1]
          const prevKey = `${prev.storyboardId}-${prev.panelIndex}`
          if (linkedPanels.get(prevKey)) {
            return null
          }
        }

        const panelKey = `${panel.storyboardId}-${panel.panelIndex}`
        const preferLipSync = panelVideoPreference.get(panelKey) ?? true
        const src = (preferLipSync ? panel.lipSyncVideoUrl : null) || panel.videoUrl || panel.lipSyncVideoUrl
        if (!src) return null

        const durationSeconds =
          typeof panel.textPanel?.duration === 'number' && panel.textPanel.duration > 0
            ? panel.textPanel.duration
            : 3

        return {
          id: panel.panelId || `clip_${index + 1}`,
          src,
          durationInFrames: Math.max(1, Math.round(durationSeconds * 30)),
        }
      })
      .filter((clip): clip is { id: string; src: string; durationInFrames: number } => !!clip)
  }, [allPanels, linkedPanels, panelVideoPreference])

  const pollFinalRenderStatus = useCallback(async (editorProjectId: string) => {
    try {
      const response = await fetch(
        `/api/novel-promotion/${projectId}/editor/render?id=${editorProjectId}&episodeId=${episodeId}`,
      )
      if (!response.ok) {
        throw new Error(`POLL_FINAL_RENDER_FAILED:${response.status}`)
      }

      const data = await response.json()
      const status = normalizeFinalRenderStatus(data?.status)
      const nextTaskId = typeof data?.renderTaskId === 'string' ? data.renderTaskId : null
      const nextOutputUrl = typeof data?.outputUrl === 'string' ? data.outputUrl : null

      setFinalRenderStatus(status)
      setFinalRenderTaskId(nextTaskId)
      setFinalRenderOutputUrl(nextOutputUrl)

      if (status === 'completed' || status === 'failed') {
        stopFinalRenderPolling()
        return
      }

      finalRenderPollTimerRef.current = window.setTimeout(() => {
        void pollFinalRenderStatus(editorProjectId)
      }, 2500)
    } catch (error) {
      _ulogError('Poll final render status failed:', error)
      setFinalRenderStatus('failed')
      stopFinalRenderPolling()
    }
  }, [episodeId, projectId, stopFinalRenderPolling])

  const handleRenderFinalVideo = useCallback(async () => {
    if (finalRenderTimeline.length === 0) {
      alert(t('toolbar.noVideos'))
      return
    }

    setFinalRenderOutputUrl(null)
    setFinalRenderTaskId(null)
    setFinalRenderStatus('rendering')
    setIsFinalRendering(true)

    try {
      const response = await fetch(`/api/novel-promotion/${projectId}/editor/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId,
          quality: 'high',
          projectData: {
            episodeId,
            config: {
              fps: 30,
              width: 1920,
              height: 1080,
            },
            timeline: finalRenderTimeline,
          },
        }),
      })

      if (!response.ok) {
        throw new Error(`START_FINAL_RENDER_FAILED:${response.status}`)
      }

      const data = await response.json()
      const editorProjectId = typeof data?.editorProjectId === 'string' ? data.editorProjectId : ''
      const taskId = typeof data?.renderTaskId === 'string' ? data.renderTaskId : null

      if (!editorProjectId) {
        throw new Error('EDITOR_PROJECT_ID_MISSING')
      }

      setFinalRenderStatus(normalizeFinalRenderStatus(data?.status || 'rendering'))
      setFinalRenderTaskId(taskId)
      void pollFinalRenderStatus(editorProjectId)
    } catch (error) {
      _ulogError('Render final video failed:', error)
      setFinalRenderStatus('failed')
      stopFinalRenderPolling()
    }
  }, [episodeId, finalRenderTimeline, pollFinalRenderStatus, projectId, stopFinalRenderPolling, t])

  const handleOpenBatchGenerateModal = useCallback(() => {
    if (isAnyTaskRunning) return
    setIsBatchConfigOpen(true)
  }, [isAnyTaskRunning])

  const handleCloseBatchGenerateModal = useCallback(() => {
    setIsBatchConfigOpen(false)
  }, [])

  const handleConfirmBatchGenerate = useCallback(async () => {
    if (!canSubmitBatchGenerate || isConfirming) return

    setIsConfirming(true)
    try {
      await onGenerateAllVideos({
        videoModel: batchSelectedModel,
        generationOptions: batchGenerationOptions,
      })
      setIsBatchConfigOpen(false)
    } finally {
      setIsConfirming(false)
    }
  }, [
    batchGenerationOptions,
    batchSelectedModel,
    canSubmitBatchGenerate,
    isConfirming,
    onGenerateAllVideos,
  ])

  return (
    <div className="space-y-6 pb-20">
      <VideoToolbar
        totalPanels={allPanels.length}
        runningCount={runningCount}
        videosWithUrl={videosWithUrl}
        failedCount={failedCount}
        isAnyTaskRunning={isAnyTaskRunning}
        isDownloading={isDownloading}
        onGenerateAll={handleOpenBatchGenerateModal}
        onDownloadAll={handleDownloadAllVideos}
        onRenderFinal={handleRenderFinalVideo}
        finalRenderStatus={finalRenderStatus}
        isFinalRendering={isFinalRendering}
        finalRenderOutputUrl={finalRenderOutputUrl}
        finalRenderTaskId={finalRenderTaskId}
        finalRenderDisabled={isAnyTaskRunning || finalRenderTimeline.length === 0}
        onBack={onBack}
        onEnterEditor={onEnterEditor}
        videosReady={videosWithUrl > 0}
      />

      <VideoTimelinePanel
        projectId={projectId}
        episodeId={episodeId}
        allVoiceLines={allVoiceLines}
        expanded={voiceLinesExpanded}
        onToggleExpanded={toggleVoiceLinesExpanded}
        onReloadVoiceLines={reloadVoiceLines}
        onLocateVoiceLine={locateVoiceLinePanel}
        onOpenAssetLibraryForCharacter={onOpenAssetLibraryForCharacter}
      />

      <VideoRenderPanel
        allPanels={allPanels}
        linkedPanels={linkedPanels}
        highlightedPanelKey={highlightedPanelKey}
        panelRefs={panelRefs}
        videoRatio={videoRatio}
        defaultVideoModel={defaultVideoModel}
        capabilityOverrides={capabilityOverrides}
        userVideoModels={userVideoModels}
        projectId={projectId}
        episodeId={episodeId}
        runningVoiceLineIds={runningVoiceLineIds}
        panelVoiceLines={panelVoiceLines}
        panelVideoPreference={panelVideoPreference}
        savingPrompts={savingPrompts}
        flModel={flModel}
        flModelOptions={flModelOptions}
        flGenerationOptions={flGenerationOptions}
        flCapabilityFields={flCapabilityFields}
        flMissingCapabilityFields={flMissingCapabilityFields}
        flCustomPrompts={flCustomPrompts}
        onGenerateVideo={onGenerateVideo}
        onUpdatePanelVideoModel={onUpdatePanelVideoModel}
        onLipSync={handleLipSync}
        onToggleLink={handleToggleLink}
        onFlModelChange={setFlModel}
        onFlCapabilityChange={setFlCapabilityValue}
        onFlCustomPromptChange={setFlCustomPrompt}
        onResetFlPrompt={resetFlCustomPrompt}
        onGenerateFirstLastFrame={handleGenerateFirstLastFrame}
        onPreviewImage={setPreviewImage}
        onToggleLipSyncVideo={toggleLipSyncVideo}
        getNextPanel={getNextPanel}
        isLinkedAsLastFrame={isLinkedAsLastFrame}
        getDefaultFlPrompt={getDefaultFlPrompt}
        getLocalPrompt={getLocalPrompt}
        updateLocalPrompt={updateLocalPrompt}
        savePrompt={savePrompt}
      />

      {isBatchConfigOpen && (
        <div
          className="fixed inset-0 z-[120] glass-overlay flex items-center justify-center p-4"
          onClick={handleCloseBatchGenerateModal}
        >
          <div
            className="glass-surface-modal w-full max-w-2xl p-5 space-y-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="space-y-1">
              <h3 className="text-lg font-semibold text-[var(--glass-text-primary)]">
                {t('toolbar.batchConfigTitle')}
              </h3>
              <p className="text-sm text-[var(--glass-text-tertiary)]">
                {t('toolbar.batchConfigDesc')}
              </p>
            </div>

            <ModelCapabilityDropdown
              models={allVideoModelOptions}
              value={batchSelectedModel || undefined}
              onModelChange={setBatchSelectedModel}
              capabilityFields={batchCapabilityFields.map((field) => ({
                field: field.field,
                label: renderCapabilityLabel(field),
                options: field.options,
                disabledOptions: field.disabledOptions,
              }))}
              capabilityOverrides={batchGenerationOptions}
              onCapabilityChange={(field, rawValue) => setBatchCapabilityValue(field, rawValue)}
              placeholder={t('panelCard.selectModel')}
            />

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={handleCloseBatchGenerateModal}
                className="glass-btn-base glass-btn-secondary px-4 py-2 text-sm font-medium"
              >
                {t('panelCard.cancel')}
              </button>
              <button
                type="button"
                onClick={() => { void handleConfirmBatchGenerate() }}
                disabled={!canSubmitBatchGenerate || isConfirming}
                className="glass-btn-base glass-btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isConfirming ? (
                  <>
                    <AppIcon name="loader" className="animate-spin h-4 w-4" />
                    <span>{t('toolbar.confirming')}</span>
                  </>
                ) : (
                  <span>{t('toolbar.confirmGenerateAll')}</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {previewImage && <ImagePreviewModal imageUrl={previewImage} onClose={closePreviewImage} />}
    </div>
  )
}
