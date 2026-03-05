'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../keys'
import { requestJsonWithError } from './mutation-shared'

export function useDismissFailedTasks(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (taskIds: string[]) => {
            return await requestJsonWithError<{ success: boolean; dismissed: number }>(
                '/api/tasks/dismiss',
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ taskIds }),
                },
                '关闭错误失败',
            )
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false })
        },
    })
}

export function useCancelTask(projectId: string) {
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async (taskId: string) => {
            return await requestJsonWithError<{ success: boolean; cancelled: boolean }>(
                /api/tasks/,
                {
                    method: 'DELETE',
                },
                '取消任务失败',
            )
        },
        onSettled: async () => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.tasks.all(projectId), exact: false }),
                queryClient.invalidateQueries({ queryKey: queryKeys.tasks.targetStatesAll(projectId), exact: false }),
                queryClient.invalidateQueries({ queryKey: queryKeys.projectAssets.all(projectId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.projectData(projectId) }),
            ])
        },
    })
}
