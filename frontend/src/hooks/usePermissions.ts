/**
 * usePermissions - Centralized permission checking hook
 * Provides permission utilities for task and content access control
 */

import { useUser } from '../contexts/UserContext'
import type { Task, Note } from '../types'

export interface PermissionContext {
  currentUserId: string
  canAssignTasks: boolean
  canManageTools: boolean
  hasKeepaAccess: boolean
  isSuperadmin: boolean
}

export function usePermissions() {
  const { userInfo, hasKeepaAccess, canManageTools, canAssignTasks, isSuperadmin } = useUser()
  
  const currentUserId = userInfo?.id || ''

  // Task permissions
  const canDeleteTask = (task: Task): boolean => {
    return (
      task.user_id === currentUserId ||
      task.assigned_to === currentUserId ||
      canAssignTasks
    )
  }

  const canEditTask = (task: Task): boolean => {
    return (
      task.user_id === currentUserId ||
      task.assigned_to === currentUserId ||
      canAssignTasks
    )
  }

  const canReviewTask = (task: Task): boolean => {
    return task.user_id === currentUserId || canAssignTasks
  }

  const canUploadValidation = (task: Task): boolean => {
    return task.assigned_to === currentUserId
  }

  const canChangeAssignment = (task: Task): boolean => {
    return task.user_id === currentUserId || canAssignTasks
  }

  // Note permissions
  const canEditNote = (note: Note): boolean => {
    return note.user_id === currentUserId
  }

  const canDeleteNote = (note: Note): boolean => {
    return note.user_id === currentUserId
  }

  return {
    // Context
    currentUserId,
    canAssignTasks,
    canManageTools,
    hasKeepaAccess,
    isSuperadmin,
    
    // Task permissions
    canDeleteTask,
    canEditTask,
    canReviewTask,
    canUploadValidation,
    canChangeAssignment,
    
    // Note permissions
    canEditNote,
    canDeleteNote,
  }
}
