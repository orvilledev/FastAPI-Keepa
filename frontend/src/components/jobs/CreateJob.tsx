import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { jobsApi, mapApi } from '../../services/api'
import EmailRecipientsPicker from './EmailRecipientsPicker'

export default function CreateJob() {
  const [jobName, setJobName] = useState('')
  const [upcs, setUpcs] = useState('')
  const [emailRecipients, setEmailRecipients] = useState('')
  const [mapVendorType, setMapVendorType] = useState('dnk')
  const [keepaOffersLimit, setKeepaOffersLimit] = useState<number>(10)
  const [offPriceScope, setOffPriceScope] = useState<'buybox_only' | 'buybox_and_non_buybox_below_map'>('buybox_only')
  const [vendorSuggestions, setVendorSuggestions] = useState<string[]>(['dnk', 'clk'])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    mapApi
      .listVendors()
      .then((res) => {
        if (!cancelled && res.vendors?.length) {
          setVendorSuggestions(res.vendors)
        }
      })
      .catch(() => {
        /* keep defaults */
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      // Parse UPCs from textarea (one per line)
      const upcList = upcs
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      if (upcList.length === 0) {
        setError('Please enter at least one UPC')
        setLoading(false)
        return
      }

      const jobPayload: {
        job_name: string
        upcs: string[]
        email_recipients?: string
        map_vendor_type: string
        keepa_offers_limit: number
        off_price_scope: 'buybox_only' | 'buybox_and_non_buybox_below_map'
      } = {
        job_name: jobName || `Job ${new Date().toLocaleString()}`,
        upcs: upcList,
        map_vendor_type: mapVendorType.trim().toLowerCase() || 'dnk',
        keepa_offers_limit: Math.max(0, Math.min(500, Number.isFinite(keepaOffersLimit) ? keepaOffersLimit : 10)),
        off_price_scope: offPriceScope,
      }
      if (emailRecipients.trim()) {
        jobPayload.email_recipients = emailRecipients.trim()
      }

      const job = await jobsApi.createJob(jobPayload)

      navigate(`/jobs/${job.id}`)
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to create job')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Create New Job</h1>
        <p className="mt-1 text-sm text-gray-500">
          Enter UPCs to process (one per line)
        </p>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 lg:p-8 space-y-6">
        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4">
            <div className="text-sm text-red-800 font-medium">{error}</div>
          </div>
        )}

        <div>
          <label htmlFor="mapVendorType" className="block text-sm font-medium text-gray-700 mb-2">
            MAP vendor <span className="text-gray-500 font-normal">(must match MAP data)</span>
          </label>
          <input
            type="text"
            id="mapVendorType"
            list="map-vendor-suggestions"
            value={mapVendorType}
            onChange={(e) => setMapVendorType(e.target.value)}
            className="w-full max-w-md px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm"
            placeholder="dnk, clk, obz, …"
            autoComplete="off"
          />
          <datalist id="map-vendor-suggestions">
            {vendorSuggestions.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <p className="mt-2 text-sm text-gray-500">
            Off-price uses <span className="font-mono text-gray-700">map_prices</span> rows for this vendor code.
            Use <span className="font-mono">obz</span> for OBZ MAP uploads, <span className="font-mono">dnk</span> or{' '}
            <span className="font-mono">clk</span> for those vendors, <span className="font-mono">ref</span> for REF, and{' '}
            <span className="font-mono">bor</span> for BOR, and <span className="font-mono">sff</span> for SFF.
          </p>
        </div>

        <div>
          <label htmlFor="keepaOffersLimit" className="block text-sm font-medium text-gray-700 mb-2">
            Keepa offers limit <span className="text-gray-500 font-normal">(0-500, per job)</span>
          </label>
          <input
            type="number"
            id="keepaOffersLimit"
            min={0}
            max={500}
            value={keepaOffersLimit}
            onChange={(e) => setKeepaOffersLimit(Number(e.target.value))}
            className="w-full max-w-md px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm"
          />
          <p className="mt-2 text-sm text-gray-500">
            Lower is faster/lighter, higher improves seller coverage but may increase rate-limit retries.
          </p>
        </div>

        <div>
          <p className="block text-sm font-medium text-gray-700 mb-2">
            Off-price scope <span className="text-gray-500 font-normal">(per job)</span>
          </p>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="offPriceScope"
                value="buybox_only"
                checked={offPriceScope === 'buybox_only'}
                onChange={() => setOffPriceScope('buybox_only')}
                className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
              />
              <span>Flag only buy box winners below MAP</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="offPriceScope"
                value="buybox_and_non_buybox_below_map"
                checked={offPriceScope === 'buybox_and_non_buybox_below_map'}
                onChange={() => setOffPriceScope('buybox_and_non_buybox_below_map')}
                className="mt-0.5 h-4 w-4 text-indigo-600 border-gray-300 focus:ring-indigo-500"
              />
              <span>Flag buy box and non-buy-box sellers below MAP</span>
            </label>
          </div>
        </div>

        <div>
          <label htmlFor="jobName" className="block text-sm font-medium text-gray-700 mb-2">
            Job Name (optional)
          </label>
          <input
            type="text"
            id="jobName"
            value={jobName}
            onChange={(e) => setJobName(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
            placeholder="Enter job name"
          />
        </div>

        <div>
          <label htmlFor="upcs" className="block text-sm font-medium text-gray-700 mb-2">
            UPCs <span className="text-gray-500 font-normal">(one per line)</span>
          </label>
          <textarea
            id="upcs"
            rows={20}
            value={upcs}
            onChange={(e) => setUpcs(e.target.value)}
            required
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono text-sm"
            placeholder="Enter UPCs, one per line..."
          />
          <p className="mt-2 text-sm text-gray-500">
            <span className="font-semibold text-gray-700">{upcs.split('\n').filter((line) => line.trim().length > 0).length}</span> UPCs entered
          </p>
        </div>

        <div>
          <label htmlFor="emailRecipients" className="block text-sm font-medium text-gray-700 mb-2">
            Email recipients <span className="text-gray-500 font-normal">(optional)</span>
          </label>
          <EmailRecipientsPicker
            id="emailRecipients"
            value={emailRecipients}
            onChange={setEmailRecipients}
            persistDismissed
          />
        </div>

        <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={() => navigate('/jobs')}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create Job'}
          </button>
        </div>
      </form>
    </div>
  )
}

