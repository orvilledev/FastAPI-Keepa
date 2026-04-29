interface MaintenanceProps {
  title?: string
  message?: string
}

export default function Maintenance({ title = 'Quick Tune-Up in Progress', message }: MaintenanceProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center">
        <div className="text-4xl mb-4">🛠️</div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="mt-3 text-gray-600">
          {message || 'We are currently performing maintenance. Please check back shortly.'}
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Thank you for your patience.
        </p>
      </div>
    </div>
  )
}
