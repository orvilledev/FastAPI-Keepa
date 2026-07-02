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
  off_price_timezone: string
  off_price_hour: number
  off_price_minute: number
  off_price_run_mode: 'daily' | 'every_other_day' | 'custom_days'
  off_price_custom_days: string[]
  off_price_anchor_date: string | null
  off_price_email_recipients: string
  off_price_email_bcc_recipients: string
  off_price_send_after_build: boolean
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

function ScheduleBlock({
  label,
  timezone,
  hour,
  minute,
  runMode,
  customDays,
  anchorDate,
  emailRecipients,
  emailBccRecipients,
  saving,
  onTimezone,
  onHour,
  onMinute,
  onRunMode,
  onToggleDay,
  onAnchorDate,
  onEmailRecipients,
  onEmailBccRecipients,
  recipientsLabel,
}: {
  label: string
  timezone: string
  hour: number
  minute: number
  runMode: SchedulerSettingsFormState['run_mode']
  customDays: string[]
  anchorDate: string | null
  emailRecipients: string
  emailBccRecipients: string
  saving: boolean
  onTimezone: (value: string) => void
  onHour: (value: number) => void
  onMinute: (value: number) => void
  onRunMode: (value: SchedulerSettingsFormState['run_mode']) => void
  onToggleDay: (day: string) => void
  onAnchorDate: (value: string | null) => void
  onEmailRecipients: (value: string) => void
  onEmailBccRecipients: (value: string) => void
  recipientsLabel: string
}) {
  return (
    <div className="space-y-4 rounded-lg border border-gray-200 bg-gray-50/60 p-4">
      <h3 className="text-sm font-semibold text-gray-900">{label}</h3>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Timezone</label>
        <select
          value={timezone}
          onChange={(e) => onTimezone(e.target.value)}
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
            value={hour}
            onChange={(e) => onHour(parseInt(e.target.value, 10) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Minute (0-59)</label>
          <input
            type="number"
            min={0}
            max={59}
            value={minute}
            onChange={(e) => onMinute(parseInt(e.target.value, 10) || 0)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Frequency</label>
        <select
          value={runMode}
          onChange={(e) => onRunMode(e.target.value as SchedulerSettingsFormState['run_mode'])}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
        >
          <option value="daily">Daily</option>
          <option value="every_other_day">Every other day</option>
          <option value="custom_days">Custom days</option>
        </select>
      </div>

      {runMode === 'every_other_day' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Start Date</label>
          <input
            type="date"
            value={anchorDate || ''}
            onChange={(e) => onAnchorDate(e.target.value || null)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#404040] focus:border-transparent"
          />
        </div>
      )}

      {runMode === 'custom_days' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Run Days</label>
          <div className="grid grid-cols-4 gap-2">
            {WEEKDAYS.map((day) => (
              <label key={day.value} className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={customDays.includes(day.value)}
                  onChange={() => onToggleDay(day.value)}
                  className="rounded border-gray-300"
                />
                {day.label}
              </label>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">{recipientsLabel}</label>
        <EmailRecipientsPicker
          value={emailRecipients || ''}
          bccValue={emailBccRecipients || ''}
          onChange={onEmailRecipients}
          onBccChange={onEmailBccRecipients}
          disabled={saving}
          emptyMeansNoRecipients
          allowVendorBcc
        />
      </div>
    </div>
  )
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

  const toggleBuildDay = (day: string) => {
    const next = form.custom_days.includes(day)
      ? form.custom_days.filter((d) => d !== day)
      : [...form.custom_days, day]
    onChange({ ...form, custom_days: next })
  }

  const toggleOffPriceDay = (day: string) => {
    const next = form.off_price_custom_days.includes(day)
      ? form.off_price_custom_days.filter((d) => d !== day)
      : [...form.off_price_custom_days, day]
    onChange({ ...form, off_price_custom_days: next })
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto">
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

        <div className="space-y-6">
          <ScheduleBlock
            label="Keepa file build"
            timezone={form.timezone}
            hour={form.hour}
            minute={form.minute}
            runMode={form.run_mode}
            customDays={form.custom_days}
            anchorDate={form.anchor_date}
            emailRecipients={form.email_recipients}
            emailBccRecipients={form.email_bcc_recipients}
            saving={saving}
            onTimezone={(value) => onChange({ ...form, timezone: value })}
            onHour={(value) => onChange({ ...form, hour: value })}
            onMinute={(value) => onChange({ ...form, minute: value })}
            onRunMode={(value) => onChange({ ...form, run_mode: value })}
            onToggleDay={toggleBuildDay}
            onAnchorDate={(value) => onChange({ ...form, anchor_date: value })}
            onEmailRecipients={(value) => onChange({ ...form, email_recipients: value })}
            onEmailBccRecipients={(value) => onChange({ ...form, email_bcc_recipients: value })}
            recipientsLabel={`Keepa file email recipients (${vendorUpper})`}
          />

          <ScheduleBlock
            label="Off-price MAP report"
            timezone={form.off_price_timezone}
            hour={form.off_price_hour}
            minute={form.off_price_minute}
            runMode={form.off_price_run_mode}
            customDays={form.off_price_custom_days}
            anchorDate={form.off_price_anchor_date}
            emailRecipients={form.off_price_email_recipients}
            emailBccRecipients={form.off_price_email_bcc_recipients}
            saving={saving}
            onTimezone={(value) => onChange({ ...form, off_price_timezone: value })}
            onHour={(value) => onChange({ ...form, off_price_hour: value })}
            onMinute={(value) => onChange({ ...form, off_price_minute: value })}
            onRunMode={(value) => onChange({ ...form, off_price_run_mode: value })}
            onToggleDay={toggleOffPriceDay}
            onAnchorDate={(value) => onChange({ ...form, off_price_anchor_date: value })}
            onEmailRecipients={(value) => onChange({ ...form, off_price_email_recipients: value })}
            onEmailBccRecipients={(value) =>
              onChange({ ...form, off_price_email_bcc_recipients: value })
            }
            recipientsLabel={`Off-price report recipients (${vendorUpper}, separate from Daily Run)`}
          />

          <label className="flex items-start gap-3 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.off_price_send_after_build}
              onChange={(e) => onChange({ ...form, off_price_send_after_build: e.target.checked })}
              className="mt-1 rounded border-gray-300"
            />
            <span>
              Email the off-price MAP report automatically after each successful Keepa file build
              (manual or scheduled).
            </span>
          </label>
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
