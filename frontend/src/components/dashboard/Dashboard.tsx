import { useEffect, useState, useMemo } from 'react'
import SchedulerCountdown from './SchedulerCountdown'
import QuickAccess from './QuickAccess'
import UPCMAPStats from './UPCMAPStats'
import { authApi, dashboardApi } from '../../services/api'

interface WidgetItem {
  id: string
  component: React.ReactNode
}

export default function Dashboard() {
  const [greeting, setGreeting] = useState('')
  const [loading, setLoading] = useState(true)
  const [widgets, setWidgets] = useState<WidgetItem[]>([])
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  // Define available widgets - use useMemo to prevent recreation on each render
  const availableWidgets = useMemo(() => ({
    quickAccess: <QuickAccess />,
    schedulerCountdown: <SchedulerCountdown />,
    upcMapStats: <UPCMAPStats />,
  }), [])

  useEffect(() => {
    const loadData = async () => {
      try {
        // Load user greeting
        const user = await authApi.getCurrentUser()
        const name = user.display_name || user.email?.split('@')[0] || 'there'
        const capitalizedName = name.charAt(0).toUpperCase() + name.slice(1)
        setGreeting(`Welcome, ${capitalizedName}!`)

        // Load widget order
        try {
          console.log('Loading widget order...')
          const savedWidgets = await dashboardApi.getWidgets()
          console.log('Loaded widgets from API:', savedWidgets)
          const widgetOrder = savedWidgets
            .filter(w => w.is_visible)
            .sort((a, b) => a.display_order - b.display_order)
            .map(w => ({
              id: w.widget_id,
              component: availableWidgets[w.widget_id],
            }))
            .filter(w => w.component !== undefined)
          console.log('Processed widget order:', widgetOrder)

          // If no saved order, use default and save it
          if (widgetOrder.length === 0) {
            const defaultWidgets = [
              { id: 'quickAccess', component: availableWidgets.quickAccess },
              { id: 'schedulerCountdown', component: availableWidgets.schedulerCountdown },
              { id: 'upcMapStats', component: availableWidgets.upcMapStats },
            ]
            setWidgets(defaultWidgets)
            
            // Save default order to database
            try {
              await dashboardApi.updateWidgetOrder(
                defaultWidgets.map((widget, index) => ({
                  widget_id: widget.id,
                  display_order: index,
                }))
              )
            } catch (saveErr) {
              console.error('Failed to save default widget order:', saveErr)
            }
          } else {
            // Ensure all available widgets are included
            const savedWidgetIds = new Set(widgetOrder.map(w => w.id))
            const missingWidgets = Object.keys(availableWidgets)
              .filter(id => !savedWidgetIds.has(id))
              .map(id => ({
                id,
                component: availableWidgets[id],
              }))
            
            if (missingWidgets.length > 0) {
              // Add missing widgets at the end
              const allWidgets = [...widgetOrder, ...missingWidgets]
              setWidgets(allWidgets)
              
              // Save updated order including missing widgets
              try {
                await dashboardApi.updateWidgetOrder(
                  allWidgets.map((widget, index) => ({
                    widget_id: widget.id,
                    display_order: index,
                  }))
                )
              } catch (saveErr) {
                console.error('Failed to save widget order with missing widgets:', saveErr)
              }
            } else {
              setWidgets(widgetOrder)
            }
          }
        } catch (err: any) {
          console.error('Failed to load widget order:', err)
          console.error('Error details:', err.response?.data || err.message)
          
          // Check if table doesn't exist
          const errorData = err.response?.data
          const isTableMissing = err.response?.status === 404 || 
                                errorData?.code === 'PGRST205' ||
                                (typeof errorData === 'string' && errorData.includes('Could not find the table'))
          
          if (isTableMissing) {
            console.warn('⚠️ Dashboard widgets table does not exist!')
            console.warn('Please run the migration: backend/database/dashboard_widgets_schema.sql in Supabase SQL Editor')
          }
          
          // Use default order if loading fails
          const defaultWidgets = [
            { id: 'quickAccess', component: availableWidgets.quickAccess },
            { id: 'schedulerCountdown', component: availableWidgets.schedulerCountdown },
            { id: 'upcMapStats', component: availableWidgets.upcMapStats },
          ]
          setWidgets(defaultWidgets)
          
          // Try to save default order (might fail if table doesn't exist, that's okay)
          if (!isTableMissing) {
            try {
              await dashboardApi.updateWidgetOrder(
                defaultWidgets.map((widget, index) => ({
                  widget_id: widget.id,
                  display_order: index,
                }))
              )
            } catch (saveErr: any) {
              console.error('Could not save default order:', saveErr)
              if (saveErr.response?.data?.code === 'PGRST205') {
                console.warn('⚠️ Table does not exist. Widget order will not persist until migration is run.')
              }
            }
          }
        }
      } catch (err) {
        console.error('Failed to load user info:', err)
        setGreeting('Welcome!')
        // Use default widget order
        setWidgets([
          { id: 'quickAccess', component: availableWidgets.quickAccess },
          { id: 'schedulerCountdown', component: availableWidgets.schedulerCountdown },
          { id: 'upcMapStats', component: availableWidgets.upcMapStats },
        ])
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [])

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (dropIndex: number) => {
    if (draggedIndex === null) return

    const newWidgets = [...widgets]
    const draggedWidget = newWidgets[draggedIndex]
    newWidgets.splice(draggedIndex, 1)
    newWidgets.splice(dropIndex, 0, draggedWidget)

    setWidgets(newWidgets)
    setDraggedIndex(null)

    // Save new order
    try {
      setSaving(true)
      const orderData = newWidgets.map((widget, index) => ({
        widget_id: widget.id,
        display_order: index,
      }))
      console.log('Saving widget order:', orderData)
      const result = await dashboardApi.updateWidgetOrder(orderData)
      console.log('Widget order saved successfully:', result)
      
      // Verify the save worked by checking the returned order
      if (result && result.length > 0) {
        const savedOrder = result
          .filter(w => w.is_visible)
          .sort((a, b) => a.display_order - b.display_order)
          .map(w => w.widget_id)
        console.log('Verified saved order:', savedOrder)
      }
    } catch (err: any) {
      console.error('Failed to save widget order:', err)
      console.error('Error details:', err.response?.data || err.message)
      console.error('Full error:', err)
      
      // Show error to user
      alert(`Failed to save widget order: ${err.response?.data?.detail || err.message || 'Unknown error'}. Please check if the dashboard_widgets table exists in your database.`)
    } finally {
      setSaving(false)
    }
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  return (
    <div className="space-y-6">
      {/* Greeting */}
      {!loading && greeting && (
        <div>
          <h1 className="text-5xl font-bold text-gray-900">{greeting}</h1>
          <p className="mt-3 text-lg text-gray-600">Let's get started and make today productive!</p>
        </div>
      )}

      {/* Draggable Widgets */}
      <div className="space-y-6">
        {widgets.map((widget, index) => (
          <div
            key={widget.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(index)}
            onDragEnd={handleDragEnd}
            className={`relative transition-all ${
              draggedIndex === index ? 'opacity-50 scale-95' : 'opacity-100'
            } ${draggedIndex !== null && draggedIndex !== index ? 'hover:border-indigo-300' : ''}`}
          >
            <div className="relative group border-2 border-transparent hover:border-indigo-200 rounded-lg p-1 -m-1 transition-colors">
              {/* Drag handle indicator */}
              <div className="absolute -left-10 top-1/2 -translate-y-1/2 flex items-center opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                <div className="flex flex-col space-y-1 text-gray-400 hover:text-indigo-500">
                  <div className="w-1.5 h-1.5 bg-current rounded-full"></div>
                  <div className="w-1.5 h-1.5 bg-current rounded-full"></div>
                  <div className="w-1.5 h-1.5 bg-current rounded-full"></div>
                </div>
              </div>
              {/* Widget content */}
              <div className="cursor-move">
                {widget.component}
              </div>
            </div>
          </div>
        ))}
      </div>

      {saving && (
        <div className="fixed bottom-4 right-4 bg-indigo-600 text-white px-4 py-2 rounded-lg shadow-lg">
          Saving widget order...
        </div>
      )}
    </div>
  )
}

