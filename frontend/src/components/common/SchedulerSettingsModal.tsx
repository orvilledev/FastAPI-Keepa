import EmailRecipientsPicker from '../jobs/EmailRecipientsPicker'

const WEEKDAYS = [
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
  { value: 'sat', label: 'Sat' },
  { value: 'sun', label: 'Sun' },
] as const

export type SchedulerSettingsFormState = {
  timezone: string
  hour: number
  minute: number
  run_mode: 'daily' | 'every_other_day' | 'custom_days'
  custom_days: string[]
  anchor_date: string | null
  email_recipients: string
  email_bcc_recipients: string
}

type SchedulerSettingsModalProps = {
  open: boolean
  title?: string
  vendorUpper: string
  form: SchedulerSettingsFormState
  onChange: (form: SchedulerSettingsFormState) => void
  onClose: () => void
  onSave: () => void
  saving: boolean
}

export default function SchedulerSettingsModal({
  open,
  title = 'Scheduler Settings',
  vendorUpper,
  form,
  onChange,
  onClose,
  onSave,
  saving,
}: SchedulerSettingsModalProps) {
  if (!open) return null

  const toggleCustomDay = (day: string) => {
    const next = form.custom_days.includes(day)
      ? form.custom_days.filter((d) => d !== day)
      : [...form.custom_days, day]
    onChange({ ...form, custom_days: next })
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
        <div className="flex justify-between items-start mb-6">
          <h2 className="text-2xl font-bold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
            <select
              value={form.timezone}
              onChange={(e) => onChange({ ...form, timezone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
            >
              <option value="America/Chicago">America/Chicago (CST/CDT)</option>
              <option value="America/New_York">America/New_York (EST/EDT)</option>
              <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT)</option>
              <option value="America/Denver">America/Denver (MST/MDT)</option>
              <option value="Asia/Taipei">Asia/Taipei</option>
              <option value="UTC">UTC</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Hour (0-23)</label>
              <input
                type="number"
                min={0}
                max={23}
                value={form.hour}
                onChange={(e) => onChange({ ...form, hour: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Minute (0-59)</label>
              <input
                type="number"
                min={0}
                max={59}
                value={form.minute}
                onChange={(e) => onChange({ ...form, minute: parseInt(e.target.value, 10) || 0 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Frequency</label>
            <select
              value={form.run_mode}
              onChange={(e) =>
                onChange({
                  ...form,
                  run_mode: e.target.value as SchedulerSettingsFormState['run_mode'],
                })
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
            >
              <option value="daily">Daily</option>
              <option value="every_other_day">Every other day</option>
              <option value="custom_days">Custom days</option>
            </select>
          </div>

          {form.run_mode === 'every_other_day' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
              <input
                type="date"
                value={form.anchor_date || ''}
                onChange={(e) => onChange({ ...form, anchor_date: e.target.value || null })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
              />
            </div>
          )}

          {form.run_mode === 'custom_days' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Run Days</label>
              <div className="grid grid-cols-4 gap-2">
                {WEEKDAYS.map((day) => (
                  <label key={day.value} className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={form.custom_days.includes(day.value)}
                      onChange={() => toggleCustomDay(day.value)}
                      className="rounded border-gray-300"
                    />
                    {day.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Email recipients ({vendorUpper} only)
            </label>
            <EmailRecipientsPicker
              value={form.email_recipients || ''}
              bccValue={form.email_bcc_recipients || ''}
              onChange={(value) => onChange({ ...form, email_recipients: value })}
              onBccChange={(value) => onChange({ ...form, email_bcc_recipients: value })}
              disabled={saving}
              emptyMeansNoRecipients
              allowVendorBcc
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="px-4 py-2 bg-[#404040] text-white rounded-lg hover:bg-[#3B3B3B] transition-colors disabled:bg-gray-400"
          >
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  )
}
