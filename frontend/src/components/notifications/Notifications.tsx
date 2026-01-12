import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { notificationsApi } from '../../services/api'
import type { Notification } from '../../types'

export default function Notifications() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [unreadCount, setUnreadCount] = useState(0)

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
    try {
      await notificationsApi.markAsRead(notificationId)
      await loadNotifications()
      await loadUnreadCount()
    } catch (err: any) {
      console.error('Failed to mark notification as read:', err)
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

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'task_completed':
        return '✅'
      case 'task_assigned':
        return '📋'
      case 'task_mentioned':
        return '💬'
      case 'validation_reviewed':
        return '✓'
      case 'subtask_completed':
        return '☑️'
      default:
        return '🔔'
    }
  }

  const getNotificationLink = (notification: Notification) => {
    if (notification.related_type === 'task' && notification.related_id) {
      return `/team-tasks`
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
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllAsRead}
              className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
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
            Notifications will appear here when tasks are assigned to you, completed, or other activities occur.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((notification) => {
            const link = getNotificationLink(notification)
            const NotificationContent = (
              <div
                className={`card p-4 hover:shadow-md transition-shadow ${
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
                    {!notification.is_read && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleMarkAsRead(notification.id)
                        }}
                        className="px-3 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
                        title="Mark as read"
                      >
                        Mark read
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(notification.id)
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

            if (link) {
              return (
                <Link key={notification.id} to={link} onClick={() => {
                  if (!notification.is_read) {
                    handleMarkAsRead(notification.id)
                  }
                }}>
                  {NotificationContent}
                </Link>
              )
            }

            return <div key={notification.id}>{NotificationContent}</div>
          })}
        </div>
      )}
    </div>
  )
}
