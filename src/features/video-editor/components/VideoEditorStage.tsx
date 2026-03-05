'use client'
import { logError as _ulogError } from '@/lib/logging/core'
import { useTranslations } from 'next-intl'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import { useEditorState } from '../hooks/useEditorState'
import { useEditorActions } from '../hooks/useEditorActions'
import { VideoEditorProject } from '../types/editor.types'
import { calculateTimelineDuration, framesToTime } from '../utils/time-utils'
import { RemotionPreview } from './Preview'
import { Timeline } from './Timeline'
import { TransitionPicker, TransitionType } from './TransitionPicker'

interface VideoEditorStageProps {
    projectId: string
    episodeId: string
    initialProject?: VideoEditorProject
    onBack?: () => void
}

type ExportRenderStatus = 'idle' | 'pending' | 'rendering' | 'completed' | 'failed'

function normalizeRenderStatus(value: unknown): ExportRenderStatus {
    if (value === 'pending') return 'pending'
    if (value === 'rendering') return 'rendering'
    if (value === 'completed') return 'completed'
    if (value === 'failed') return 'failed'
    return 'idle'
}

function getRenderStatusLabel(status: ExportRenderStatus): string {
    if (status === 'pending') return 'Queued'
    if (status === 'rendering') return 'Rendering'
    if (status === 'completed') return 'Completed'
    if (status === 'failed') return 'Failed'
    return 'Not started'
}

/**
 * Video editor main page
 */
export function VideoEditorStage({
    projectId,
    episodeId,
    initialProject,
    onBack
}: VideoEditorStageProps) {
    const t = useTranslations('video')
    const {
        project,
        timelineState,
        isDirty,
        removeClip,
        updateClip,
        reorderClips,
        play,
        pause,
        seek,
        selectClip,
        setZoom,
        markSaved
    } = useEditorState({ episodeId, initialProject })

    const { saveProject, startRender, getRenderStatus } = useEditorActions({ projectId, episodeId })
    const [renderStatus, setRenderStatus] = useState<ExportRenderStatus>('idle')
    const [renderTaskId, setRenderTaskId] = useState<string | null>(null)
    const [renderOutputUrl, setRenderOutputUrl] = useState<string | null>(null)
    const [isPollingRender, setIsPollingRender] = useState(false)
    const pollingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const totalDuration = calculateTimelineDuration(project.timeline)
    const totalTime = framesToTime(totalDuration, project.config.fps)
    const currentTime = framesToTime(timelineState.currentFrame, project.config.fps)

    const stopRenderPolling = useCallback(() => {
        if (pollingTimerRef.current) {
            clearTimeout(pollingTimerRef.current)
            pollingTimerRef.current = null
        }
    }, [])

    const startRenderPolling = useCallback((editorProjectId: string) => {
        stopRenderPolling()
        setIsPollingRender(true)

        const pollOnce = async () => {
            try {
                const statusData = await getRenderStatus(editorProjectId)
                const nextStatus = normalizeRenderStatus(statusData?.status)
                const nextTaskId = typeof statusData?.renderTaskId === 'string' ? statusData.renderTaskId : null
                const nextOutputUrl = typeof statusData?.outputUrl === 'string' ? statusData.outputUrl : null

                setRenderStatus(nextStatus)
                setRenderTaskId(nextTaskId)
                setRenderOutputUrl(nextOutputUrl)

                if (nextStatus === 'completed' || nextStatus === 'failed') {
                    setIsPollingRender(false)
                    stopRenderPolling()
                    return
                }

                pollingTimerRef.current = setTimeout(() => {
                    void pollOnce()
                }, 2500)
            } catch (error) {
                _ulogError('Get render status failed:', error)
                setRenderStatus('failed')
                setIsPollingRender(false)
                stopRenderPolling()
            }
        }

        void pollOnce()
    }, [getRenderStatus, stopRenderPolling])

    useEffect(() => () => {
        stopRenderPolling()
    }, [stopRenderPolling])

    const handleSave = async () => {
        try {
            await saveProject(project)
            markSaved()
            alert(t('editor.alert.saveSuccess'))
        } catch (error) {
            _ulogError('Save failed:', error)
            alert(t('editor.alert.saveFailed'))
        }
    }

    const handleExport = async () => {
        try {
            setRenderOutputUrl(null)
            setRenderTaskId(null)
            setRenderStatus('pending')

            const renderResult = await startRender(project)
            const nextStatus = normalizeRenderStatus(renderResult?.status)
            const nextTaskId = typeof renderResult?.renderTaskId === 'string' ? renderResult.renderTaskId : null
            const editorProjectId = typeof renderResult?.editorProjectId === 'string' && renderResult.editorProjectId.length > 0
                ? renderResult.editorProjectId
                : project.id

            setRenderStatus(nextStatus)
            setRenderTaskId(nextTaskId)
            startRenderPolling(editorProjectId)
            alert(t('editor.alert.exportStarted'))
        } catch (error) {
            _ulogError('Export failed:', error)
            setRenderStatus('failed')
            setIsPollingRender(false)
            stopRenderPolling()
            alert(t('editor.alert.exportFailed'))
        }
    }

    const selectedClip = project.timeline.find(c => c.id === timelineState.selectedClipId)

    return (
        <div className="video-editor-stage" style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            background: 'var(--glass-bg-canvas)',
            color: 'var(--glass-text-primary)'
        }}>
            {/* Toolbar */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px 16px',
                borderBottom: '1px solid var(--glass-stroke-base)',
                background: 'var(--glass-bg-surface)'
            }}>
                <button
                    onClick={onBack}
                    className="glass-btn-base glass-btn-secondary px-4 py-2"
                >
                    {t('editor.toolbar.back')}
                </button>

                <div style={{ flex: 1 }} />

                <span style={{ color: 'var(--glass-text-secondary)', fontSize: '14px' }}>
                    {currentTime} / {totalTime}
                </span>

                <span style={{ color: 'var(--glass-text-secondary)', fontSize: '13px' }}>
                    {getRenderStatusLabel(renderStatus)}{isPollingRender ? '...' : ''}
                </span>

                {renderTaskId ? (
                    <span style={{
                        color: 'var(--glass-text-tertiary)',
                        fontSize: '12px',
                        maxWidth: '220px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                    }}>
                        Task: {renderTaskId}
                    </span>
                ) : null}

                {renderOutputUrl ? (
                    <a
                        href={renderOutputUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="glass-btn-base glass-btn-tone-success px-4 py-2"
                    >
                        Open output
                    </a>
                ) : null}

                <button
                    onClick={handleSave}
                    className={`glass-btn-base px-4 py-2 ${isDirty ? 'glass-btn-primary text-white' : 'glass-btn-secondary'}`}
                >
                    {isDirty ? t('editor.toolbar.saveDirty') : t('editor.toolbar.saved')}
                </button>

                <button
                    onClick={handleExport}
                    disabled={isPollingRender}
                    className="glass-btn-base glass-btn-tone-success px-4 py-2"
                >
                    {isPollingRender ? 'Rendering...' : t('editor.toolbar.export')}
                </button>
            </div>

            {/* Main Content */}
            <div style={{
                display: 'flex',
                flex: 1,
                overflow: 'hidden'
            }}>
                {/* Left Panel - Media Library */}
                <div style={{
                    width: '200px',
                    borderRight: '1px solid var(--glass-stroke-base)',
                    padding: '12px',
                    background: 'var(--glass-bg-surface-strong)'
                }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--glass-text-secondary)' }}>
                        {t('editor.left.title')}
                    </h3>
                    <p style={{ fontSize: '12px', color: 'var(--glass-text-tertiary)' }}>
                        {t('editor.left.description')}
                    </p>
                </div>

                {/* Center - Preview + Properties */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {/* Preview */}
                    <div style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'var(--glass-bg-muted)',
                        padding: '20px'
                    }}>
                        <RemotionPreview
                            project={project}
                            currentFrame={timelineState.currentFrame}
                            playing={timelineState.playing}
                            onFrameChange={seek}
                            onPlayingChange={(playing) => playing ? play() : pause()}
                        />
                    </div>

                    {/* Playback Controls */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '16px',
                        padding: '12px',
                        background: 'var(--glass-bg-surface-strong)',
                        borderTop: '1px solid var(--glass-stroke-base)'
                    }}>
                        <button
                            onClick={() => seek(0)}
                            className="glass-btn-base glass-btn-ghost px-3 py-1.5"
                        >
                            <AppIcon name="chevronLeft" className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => timelineState.playing ? pause() : play()}
                            style={{
                                background: 'var(--glass-accent-from)',
                                border: 'none',
                                color: 'var(--glass-text-on-accent)',
                                cursor: 'pointer',
                                width: '40px',
                                height: '40px',
                                borderRadius: '50%',
                                fontSize: '18px'
                            }}
                        >
                            {timelineState.playing
                                ? <AppIcon name="pause" className="w-4 h-4" />
                                : <AppIcon name="play" className="w-4 h-4" />}
                        </button>
                        <button
                            onClick={() => seek(totalDuration)}
                            className="glass-btn-base glass-btn-ghost px-3 py-1.5"
                        >
                            <AppIcon name="chevronRight" className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                {/* Right Panel - Properties */}
                <div style={{
                    width: '280px',
                    borderLeft: '1px solid var(--glass-stroke-base)',
                    padding: '12px',
                    background: 'var(--glass-bg-surface-strong)',
                    overflowY: 'auto'
                }}>
                    <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', color: 'var(--glass-text-secondary)' }}>
                        {t('editor.right.title')}
                    </h3>
                    {selectedClip ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* Basic info */}
                            <div style={{ fontSize: '12px' }}>
                                <p style={{ margin: '0 0 8px 0' }}>
                                    <span style={{ color: 'var(--glass-text-secondary)' }}>{t('editor.right.clipLabel')}</span> {selectedClip.metadata?.description || t('editor.right.clipFallback', { index: project.timeline.findIndex(c => c.id === selectedClip.id) + 1 })}
                                </p>
                                <p style={{ margin: '0 0 8px 0' }}>
                                    <span style={{ color: 'var(--glass-text-secondary)' }}>{t('editor.right.durationLabel')}</span> {framesToTime(selectedClip.durationInFrames, project.config.fps)}
                                </p>
                            </div>

                            {/* Transition settings */}
                            <div>
                                <h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: 'var(--glass-text-secondary)' }}>
                                    {t('editor.right.transitionLabel')}
                                </h4>
                                <TransitionPicker
                                    value={(selectedClip.transition?.type as TransitionType) || 'none'}
                                    duration={selectedClip.transition?.durationInFrames || 15}
                                    onChange={(type, duration) => {
                                        updateClip(selectedClip.id, {
                                            transition: type === 'none' ? undefined : { type, durationInFrames: duration }
                                        })
                                    }}
                                />
                            </div>

                            {/* Delete button */}
                            <button
                                onClick={() => {
                                    if (confirm(t('editor.right.deleteConfirm'))) {
                                        removeClip(selectedClip.id)
                                        selectClip(null)
                                    }
                                }}
                                className="glass-btn-base glass-btn-tone-danger mt-2 px-3 py-2 text-xs"
                            >
                                {t('editor.right.deleteClip')}
                            </button>
                        </div>
                    ) : (
                        <p style={{ fontSize: '12px', color: 'var(--glass-text-tertiary)' }}>
                            {t('editor.right.selectClipHint')}
                        </p>
                    )}
                </div>
            </div>

            {/* Timeline */}
            <div style={{
                height: '220px',
                borderTop: '1px solid var(--glass-stroke-base)'
            }}>
                <Timeline
                    clips={project.timeline}
                    timelineState={timelineState}
                    config={project.config}
                    onReorder={reorderClips}
                    onSelectClip={selectClip}
                    onZoomChange={setZoom}
                    onSeek={seek}
                />
            </div>
        </div>
    )
}

export default VideoEditorStage
