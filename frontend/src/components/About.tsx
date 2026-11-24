import { useEffect, useState } from 'react'
import {
  APP_GIT_COMMIT_SHORT,
  APP_NAME,
  APP_VERSION_LABEL,
} from '../constants/app'
import AppLogo from './common/AppLogo'

export default function About() {
  const isElectron = Boolean(window.desktop?.isElectron)
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [updateMessage, setUpdateMessage] = useState<string>('')

  useEffect(() => {
    if (!isElectron || !window.desktop?.getVersion) return
    window.desktop
      .getVersion()
      .then((version) => setDesktopVersion(version))
      .catch(() => setDesktopVersion(null))
  }, [isElectron])

  const handleCheckUpdates = async () => {
    if (!window.desktop?.checkForUpdates) return
    setIsCheckingUpdates(true)
    setUpdateMessage('')
    try {
      const result = await window.desktop.checkForUpdates()
      setUpdateMessage(result.message)
    } catch {
      setUpdateMessage('Failed to check for updates.')
    } finally {
      setIsCheckingUpdates(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="card p-8">
        <div className="mb-4">
          <AppLogo alt={`${APP_NAME} logo`} className="w-14 h-14" />
        </div>
        <h1 className="text-3xl font-bold text-gray-900">About This Project</h1>
        <p className="mt-2 text-sm font-medium text-[#81B81D]">
          Application Version: {APP_VERSION_LABEL}
        </p>
        <p className="mt-1 text-sm text-gray-600">
          Build:{' '}
          <code className="rounded bg-gray-100 px-2 py-0.5 text-gray-800 font-mono text-xs">
            {APP_GIT_COMMIT_SHORT}
          </code>
        </p>
        <p className="mt-3 text-gray-600 max-w-3xl">
          {APP_NAME} is MetroShoe Warehouse&apos;s workspace for Keepa pricing compliance and
          warehouse tools. The sidebar has <span className="font-semibold">Menu</span>,{' '}
          <span className="font-semibold">Tools</span>, and <span className="font-semibold">General</span>.
          Use top-bar search, notifications, and the theme toggle as needed. What you see depends on
          account type (Keepa, warehouse-only, or superadmin). Most staff use MFA; warehouse stations
          are exempt.
        </p>

        {!isElectron && (
          <p className="mt-2 text-sm text-gray-600 max-w-3xl">
            Use <span className="font-semibold">Download app</span> in the top bar for the Windows
            desktop client (Zebra printing and auto-updates).
          </p>
        )}

        {isElectron && (
          <div className="mt-5 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-sm font-semibold text-gray-800">Desktop App Controls</h3>
            <p className="mt-1 text-sm text-gray-600">
              App version:{' '}
              <code className="rounded bg-white px-2 py-0.5 text-xs text-gray-800">
                {desktopVersion ?? 'loading...'}
              </code>
            </p>
            <button
              type="button"
              onClick={handleCheckUpdates}
              disabled={isCheckingUpdates}
              className="mt-3 inline-flex items-center rounded-md bg-[#F97316] px-3 py-2 text-sm font-medium text-white hover:bg-[#EA580C] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCheckingUpdates ? 'Checking...' : 'Check for Updates'}
            </button>
            {updateMessage && <p className="mt-2 text-sm text-gray-600">{updateMessage}</p>}
          </div>
        )}
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">Menu</h2>
        <p className="mt-3 text-gray-700">Monitoring, compliance data, and report prep.</p>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-gray-700">
          <li>
            <span className="font-semibold">Dashboard:</span> Live vendor daily runs with countdown timers.
          </li>
          <li>
            <span className="font-semibold">Notifications:</span> Completed express and daily runs (bell icon).
          </li>
          <li>
            <span className="font-semibold">Express Jobs:</span> On-demand Keepa checks with email report output.
          </li>
          <li>
            <span className="font-semibold">Daily Runs:</span> Scheduled monitoring per vendor (API or Import Mode).
          </li>
          <li>
            <span className="font-semibold">Manage UPCs:</span> UPC lists by vendor category.
          </li>
          <li>
            <span className="font-semibold">Manage MAP:</span> Minimum advertised prices by UPC and vendor.
          </li>
          <li>
            <span className="font-semibold">Seller List:</span> Amazon seller IDs and display names.
          </li>
          <li>
            <span className="font-semibold">Email List:</span> Named recipients for jobs and daily runs.
          </li>
          <li>
            <span className="font-semibold">Ship To Addresses:</span> Amazon FC codes — download template, then upload.
          </li>
          <li>
            <span className="font-semibold">Analytics:</span> Off-price hit trends with Excel/email export and Hit Alert.
          </li>
        </ul>
        <p className="mt-4 text-sm text-gray-600">Most Menu pages require Keepa access.</p>
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">Tools</h2>
        <p className="mt-3 text-gray-700">Warehouse and operations utilities.</p>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-gray-700">
          <li>
            <span className="font-semibold">Micro Tools:</span> Shared team shortcuts to external links.
          </li>
          <li>
            <span className="font-semibold">Tracking Extractor:</span> Pull tracking numbers from carrier PDFs/ZIPs into Excel.
          </li>
          <li>
            <span className="font-semibold">FNSKU Labels:</span> Build FNSKU label PDFs or workbooks from FBA sheets.
          </li>
          <li>
            <span className="font-semibold">FNSKU Pack Station:</span> Match scan sheets to the catalog; export quantity pivots.
          </li>
          <li>
            <span className="font-semibold">FBA Box Contents:</span> Turn Carton Detail reports into box-contents workbooks.
          </li>
          <li>
            <span className="font-semibold">Manifest Generator:</span> Packing sheet → Amazon STA pack-group ZIPs.
          </li>
          <li>
            <span className="font-semibold">Product Catalog Formatter:</span> Merge shipment-plan or WR SKU files into one catalog.
          </li>
          <li>
            <span className="font-semibold">DNK AllInventory:</span> Split PMSH01 inventory exports by PONumber.
          </li>
          <li>
            <span className="font-semibold">Shipment Manager:</span> Collect FBA uploads and compile a WR SKU Update sheet.
          </li>
          <li>
            <span className="font-semibold">Freight Class Calculator:</span> Estimate NMFC class from density (manual or bulk).
          </li>
          <li>
            <span className="font-semibold">Dimensioner:</span> Live QBOID M2 measurements; download filtered scans as Excel.
          </li>
          <li>
            <span className="font-semibold">Label Station:</span> Scan UPC → catalog lookup → Zebra print (desktop) or PDF (web).
            Auto-print or Queue mode; Print ID Short SKU or UPC (DNK); multiple label sizes and dpi.
          </li>
        </ul>
        <p className="mt-4 text-sm text-gray-600">
          Access varies by account. Warehouse stations see Label Station, FNSKU Pack Station, and Freight Class;
          other tools follow Keepa, BC Tools, or allowlist rules.
        </p>
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">Appearance &amp; sign-in</h2>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-gray-700">
          <li>
            <span className="font-semibold">Dark mode:</span> Moon/sun toggle in the top bar; saved on this device.
          </li>
          <li>
            <span className="font-semibold">Quick search:</span> Jump to any page from the top bar.
          </li>
          <li>
            <span className="font-semibold">Two-factor authentication:</span> Authenticator app after password sign-in.
            Idle sessions re-prompt after 48 hours (warehouse stations exempt).
          </li>
        </ul>
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">General</h2>
        <p className="mt-3 text-gray-700">Shared pages at the bottom of the sidebar.</p>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-gray-700">
          <li>
            <span className="font-semibold">About:</span> Version, overview, and desktop updates.
          </li>
          <li>
            <span className="font-semibold">FAQ:</span> Common questions on Menu, Tools, and access.
          </li>
          <li>
            <span className="font-semibold">Feedback From Users:</span> Submit suggestions or issues.
          </li>
          <li>
            <span className="font-semibold">User Management:</span> Superadmin — accounts, permissions, maintenance.
          </li>
          <li>
            <span className="font-semibold">Live App Sessions:</span> Who is signed in (superadmin / Stephanie / Sunshine).
          </li>
          <li>
            <span className="font-semibold">Audit Log:</span> Sign-in and mutating actions (superadmin / Stephanie / Sunshine).
          </li>
        </ul>
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">Copyright and Ownership</h2>
        <p className="mt-3 text-gray-700">
          &copy; {new Date().getFullYear()} {APP_NAME} {APP_VERSION_LABEL}. All rights reserved.
        </p>
        <p className="mt-2 text-gray-700">
          Owned and managed by <span className="font-semibold">MetroShoe Warehouse</span>.
        </p>
        <p className="mt-2 text-gray-700">
          Senior Developer: <span className="font-semibold">Orville Barba</span>
        </p>
        <p className="mt-2 text-gray-700">
          QA:{' '}
          <span className="font-semibold">Stephanie Roque / Sunshine Gale Ocampo</span>
        </p>
      </div>
    </div>
  )
}
