import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { jobsApi, mapApi, upcsApi } from '../../services/api'
import EmailRecipientsPicker from './EmailRecipientsPicker'

const SYSTEM_VENDOR_CODES = ['dnk', 'clk', 'obz', 'ref', 'bor', 'sff', 'tev', 'cha', 'jfs'] as const

export default function CreateJob() {
  const [jobName, setJobName] = useState('')
  const [upcs, setUpcs] = useState('')
  const [upcSource, setUpcSource] = useState<'managed' | 'paste'>('managed')
  const [managedUpcCount, setManagedUpcCount] = useState<number | null>(null)
  const [managedUpcCountLoading, setManagedUpcCountLoading] = useState(false)
  const [emailRecipients, setEmailRecipients] = useState('')
  const [mapVendorType, setMapVendorType] = useState('dnk')
  const [keepaOffersLimit, setKeepaOffersLimit] = useState<number>(100)
  const [offPriceScope, setOffPriceScope] = useState<'buybox_only' | 'buybox_and_non_buybox_below_map'>('buybox_and_non_buybox_below_map')
  const [vendorSuggestions, setVendorSuggestions] = useState<string[]>([...SYSTEM_VENDOR_CODES])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    mapApi
      .listVendors()
      .then((res) => {
        if (!cancelled) {
          const mergedVendors = Array.from(new Set([...(res.vendors || []), ...SYSTEM_VENDOR_CODES])).sort()
          setVendorSuggestions(mergedVendors)
          if (!mergedVendors.includes(mapVendorType)) {
            setMapVendorType(mergedVendors[0] || 'dnk')
          }
        }
      })
      .catch(() => {
        /* keep defaults */
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (upcSource !== 'managed') return
    let cancelled = false
    setManagedUpcCountLoading(true)
    upcsApi
      .getUPCCount(mapVendorType)
      .then((res) => {
        if (!cancelled) setManagedUpcCount(typeof res.count === 'number' ? res.count : 0)
      })
      .catch(() => {
        if (!cancelled) setManagedUpcCount(null)
      })
      .finally(() => {
        if (!cancelled) setManagedUpcCountLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [upcSource, mapVendorType])

  const pastedUpcCount = upcs.split('\n').filter((line) => line.trim().length > 0).length
  const vendorLabel = mapVendorType.toUpperCase()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const jobPayload: {
        job_name: string
        upcs?: string[]
        use_managed_upcs?: boolean
        email_recipients?: string
        map_vendor_type: string
        keepa_offers_limit: number
        off_price_scope: 'buybox_only' | 'buybox_and_non_buybox_below_map'
      } = {
        job_name: jobName || `Job ${new Date().toLocaleString()}`,
        map_vendor_type: mapVendorType.trim().toLowerCase() || 'dnk',
        keepa_offers_limit: Math.max(0, Math.min(500, Number.isFinite(keepaOffersLimit) ? keepaOffersLimit : 100)),
        off_price_scope: offPriceScope,
      }

      if (upcSource === 'managed') {
        if (managedUpcCount === 0) {
          setError(`No Manage UPCs found for ${vendorLabel}. Add them under Manage UPCs, or paste UPCs instead.`)
          setLoading(false)
          return
        }
        jobPayload.use_managed_upcs = true
        jobPayload.upcs = []
      } else {
        const upcList = upcs
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)

        if (upcList.length === 0) {
          setError('Please enter at least one UPC')
          setLoading(false)
          return
        }
        jobPayload.upcs = upcList
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
          Use Manage UPCs for the selected vendor, or paste a custom UPC list
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
          <select
            id="mapVendorType"
            value={mapVendorType}
            onChange={(e) => setMapVendorType(e.target.value)}
            className="w-full max-w-md px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm"
          >
            {vendorSuggestions.map((v) => (
              <option key={v} value={v}>
                {v.toUpperCase()}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-gray-500">
            Off-price uses <span className="font-mono text-gray-700">map_prices</span> rows for this vendor code.
            Use <span className="font-mono">obz</span> for OBZ MAP uploads, <span className="font-mono">dnk</span> or{' '}
            <span className="font-mono">clk</span> for those vendors, <span className="font-mono">ref</span> for REF, and{' '}
            <span className="font-mono">bor</span> for BOR, <span className="font-mono">sff</span> for SFF, and{' '}
            <span className="font-mono">tev</span> for TEV, <span className="font-mono">cha</span> for CHA, and{' '}
            <span className="font-mono">jfs</span> for JFS.
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
                className="mt-0.5 h-4 w-4 text-[#81B81D] border-gray-300 focus:ring-indigo-500"
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
                className="mt-0.5 h-4 w-4 text-[#81B81D] border-gray-300 focus:ring-indigo-500"
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
          <p className="block text-sm font-medium text-gray-700 mb-2">UPC source</p>
          <div className="space-y-2">
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="upcSource"
                value="managed"
                checked={upcSource === 'managed'}
                onChange={() => setUpcSource('managed')}
                className="mt-0.5 h-4 w-4 text-[#81B81D] border-gray-300 focus:ring-indigo-500"
              />
              <span>
                Use Manage UPCs for <span className="font-mono font-semibold">{vendorLabel}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="upcSource"
                value="paste"
                checked={upcSource === 'paste'}
                onChange={() => setUpcSource('paste')}
                className="mt-0.5 h-4 w-4 text-[#81B81D] border-gray-300 focus:ring-indigo-500"
              />
              <span>Paste a custom UPC list</span>
            </label>
          </div>
        </div>

        {upcSource === 'managed' ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <p className="text-sm text-gray-700">
              {managedUpcCountLoading ? (
                <>Loading {vendorLabel} UPCs from Manage UPCs…</>
              ) : managedUpcCount === null ? (
                <>Could not load the {vendorLabel} UPC count. You can still create the job; the server will load the list.</>
              ) : managedUpcCount === 0 ? (
                <>
                  No UPCs are stored for {vendorLabel} yet. Add them under Manage UPCs, or switch to paste.
                </>
              ) : (
                <>
                  This job will process{' '}
                  <span className="font-semibold text-gray-900">{managedUpcCount.toLocaleString()}</span> UPCs
                  already stored for {vendorLabel}.
                </>
              )}
            </p>
          </div>
        ) : (
          <div>
            <label htmlFor="upcs" className="block text-sm font-medium text-gray-700 mb-2">
              UPCs <span className="text-gray-500 font-normal">(one per line)</span>
            </label>
            <textarea
              id="upcs"
              rows={20}
              value={upcs}
              onChange={(e) => setUpcs(e.target.value)}
              required={upcSource === 'paste'}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all font-mono text-sm"
              placeholder="Enter UPCs, one per line..."
            />
            <p className="mt-2 text-sm text-gray-500">
              <span className="font-semibold text-gray-700">{pastedUpcCount}</span> UPCs entered
            </p>
          </div>
        )}

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
            disabled={loading || (upcSource === 'managed' && managedUpcCount === 0)}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating...' : 'Create Job'}
          </button>
        </div>
      </form>
    </div>
  )
}
