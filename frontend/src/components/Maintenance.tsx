export default function Maintenance() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-white border border-gray-200 rounded-xl shadow-sm p-8 text-center">
        <div className="text-4xl mb-4">🛠️</div>
        <h1 className="text-2xl font-bold text-gray-900">App Under Maintenance</h1>
        <p className="mt-3 text-gray-600">
          Sorry for the inconvenience. We are currently performing maintenance.
        </p>
        <p className="mt-2 text-sm text-gray-500">
          Please try again later.
        </p>
      </div>
    </div>
  )
}
