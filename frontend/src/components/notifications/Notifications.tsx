import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { notificationsApi } from '../../services/api'
import type { Notification } from '../../types'

export default function Notifications() {
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [unreadCount, setUnreadCount] = useState(0)
  const [markingReadIds, setMarkingReadIds] = useState<Set<string>>(new Set())
  const [clearingAll, setClearingAll] = useState(false)

  useEffect(() => {
    loadNotifications()
    loadUnreadCount()
    
    // Refresh every 30 seconds
    const interval = setInterval(() => {
      loadNotifications()
      loadUnreadCount()
    }, 30000)
    
    return () => clearInterval(interval)
  }, [filter])

  const loadNotifications = async () => {
    try {
      setLoading(true)
      const data = await notificationsApi.getNotifications(filter === 'unread', 100)
      setNotifications(data)
      console.log(`Loaded ${data.length} notifications (filter: ${filter})`)
    } catch (err: any) {
      console.error('Failed to load notifications:', err)
      const errorMsg = err?.response?.data?.detail || err?.message || 'Unknown error'
      console.error('Error details:', errorMsg)
      // If it's a 404 or table doesn't exist, show helpful message
      if (err?.response?.status === 404 || errorMsg.includes('does not exist')) {
        console.warn('Notifications table may not exist. Please run the database migration.')
      }
    } finally {
      setLoading(false)
    }
  }

  const loadUnreadCount = async () => {
    try {
      const count = await notificationsApi.getUnreadCount()
      setUnreadCount(count)
      console.log(`Unread notifications count: ${count}`)
    } catch (err: any) {
      console.error('Failed to load unread count:', err)
      // Don't set error state for unread count failures, just log
      setUnreadCount(0)
    }
  }

  const handleMarkAsRead = async (notificationId: string) => {
    const target = notifications.find((n) => n.id === notificationId)
    if (!target || target.is_read || markingReadIds.has(notificationId)) {
      return
    }

    setMarkingReadIds((prev) => {
      const next = new Set(prev)
      next.add(notificationId)
      return next
    })

    // Optimistic UI: mark instantly so one click feels responsive.
    setNotifications((prev) => {
      if (filter === 'unread') {
        return prev.filter((n) => n.id !== notificationId)
      }
      return prev.map((n) =>
        n.id === notificationId
          ? { ...n, is_read: true, read_at: new Date().toISOString() }
          : n,
      )
    })
    setUnreadCount((prev) => Math.max(0, prev - 1))

    try {
      await notificationsApi.markAsRead(notificationId)
    } catch (err: any) {
      console.error('Failed to mark notification as read:', err)
      // Roll back optimistic state on failure.
      setNotifications((prev) => {
        const alreadyPresent = prev.some((n) => n.id === notificationId)
        if (alreadyPresent) {
          return prev.map((n) =>
            n.id === notificationId ? { ...n, is_read: false, read_at: undefined } : n,
          )
        }
        if (filter === 'unread') {
          return [{ ...target, is_read: false, read_at: undefined }, ...prev]
        }
        return prev
      })
      setUnreadCount((prev) => prev + 1)
    } finally {
      setMarkingReadIds((prev) => {
        const next = new Set(prev)
        next.delete(notificationId)
        return next
      })
    }
  }

  const handleMarkAllAsRead = async () => {
    try {
      await notificationsApi.markAllAsRead()
      await loadNotifications()
      await loadUnreadCount()
    } catch (err: any) {
      console.error('Failed to mark all as read:', err)
    }
  }

  const handleDelete = async (notificationId: string) => {
    if (!confirm('Are you sure you want to delete this notification?')) {
      return
    }
    try {
      await notificationsApi.deleteNotification(notificationId)
      await loadNotifications()
      await loadUnreadCount()
    } catch (err: any) {
      console.error('Failed to delete notification:', err)
    }
  }

  const handleClearNotifications = async () => {
    if (!notifications.length) return
    if (!confirm('Clear all notifications? This cannot be undone.')) {
      return
    }
    setClearingAll(true)
    const previousNotifications = notifications
    const previousUnreadCount = unreadCount

    // Optimistic UI update for immediate feedback.
    setNotifications([])
    setUnreadCount(0)

    try {
      await notificationsApi.clearNotifications()
    } catch (err: any) {
      console.error('Failed to clear notifications:', err)
      // Roll back optimistic state on failure.
      setNotifications(previousNotifications)
      setUnreadCount(previousUnreadCount)
    } finally {
      setClearingAll(false)
    }
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'run_completed':
        return '✅'
      case 'run_failed':
        return '❌'
      case 'run_missed':
        return '⏰'
      case 'api_quota_low':
        return '⚠️'
      case 'import_missing_file':
      case 'import_completed':
        return '📥'
      case 'recipients_missing':
        return '📧'
      default:
        return '🔔'
    }
  }

  const getPriorityStyles = (priority?: string) => {
    switch (priority) {
      case 'critical':
        return 'bg-red-100 text-red-800'
      case 'warning':
        return 'bg-amber-100 text-amber-800'
      default:
        return 'bg-blue-100 text-blue-800'
    }
  }

  const getNotificationLink = (notification: Notification) => {
    if (notification.related_type === 'task' && notification.related_id) {
      return `/dashboard`
    }
    return null
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'Just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Notifications</h1>
        <div className="flex items-center space-x-3">
          {notifications.length > 0 && (
            <button
              onClick={handleClearNotifications}
              disabled={clearingAll}
              className="px-4 py-2 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50"
            >
              {clearingAll ? 'Clearing...' : 'Clear Notifications'}
            </button>
          )}
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              disabled={clearingAll}
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50"
            >
              Mark all as read
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex space-x-2 border-b border-gray-200">
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            filter === 'all'
              ? 'border-[#0B1020] text-[#0B1020]'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          All ({notifications.length})
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={`px-4 py-2 font-medium text-sm border-b-2 transition-colors ${
            filter === 'unread'
              ? 'border-[#0B1020] text-[#0B1020]'
              : 'border-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          Unread {unreadCount > 0 && `(${unreadCount})`}
        </button>
      </div>

      {/* Notifications List */}
      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading notifications...</div>
      ) : notifications.length === 0 ? (
        <div className="card p-12 text-center">
          <div className="text-gray-500 mb-4">
            {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          </div>
          <div className="text-xs text-gray-400 mt-2">
            Notifications will appear here for run outcomes, schedule issues, import updates, and system alerts.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const link = getNotificationLink(notification)
            return (
              <div
                key={notification.id}
                onClick={() => {
                  if (!notification.is_read) {
                    void handleMarkAsRead(notification.id)
                  }
                  if (link) {
                    navigate(link)
                  }
                }}
                className={`card p-4 hover:shadow-md transition-shadow cursor-pointer ${
                  !notification.is_read ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start space-x-3 flex-1">
                    <div className="text-2xl flex-shrink-0">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <h3 className={`font-semibold ${!notification.is_read ? 'text-gray-900' : 'text-gray-700'}`}>
                          {notification.title}
                        </h3>
                        {notification.priority && (
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wide ${getPriorityStyles(notification.priority)}`}
                          >
                            {notification.priority}
                          </span>
                        )}
                        {!notification.is_read && (
                          <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 mb-2">{notification.message}</p>
                      <div className="flex items-center space-x-4 text-xs text-gray-500">
                        <span>{formatDate(notification.created_at)}</span>
                        {notification.metadata && (
                          <>
                            {notification.metadata.task_title && (
                              <span className="text-gray-400">• Task: {notification.metadata.task_title}</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 ml-4">
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleDelete(notification.id)
                      }}
                      className="px-3 py-1 text-xs text-red-600 hover:text-red-800"
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
