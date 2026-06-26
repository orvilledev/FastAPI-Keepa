import { useEffect, useState } from 'react'
import {
  APP_GIT_COMMIT_SHORT,
  APP_ICON_URL,
  APP_NAME,
  APP_VERSION_LABEL,
} from '../constants/app'

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
          <img src={APP_ICON_URL} alt={`${APP_NAME} logo`} className="w-14 h-14" />
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
        <p className="mt-3 text-gray-600 max-w-4xl">
          {APP_NAME} is MetroShoe Warehouse&apos;s workspace for Keepa-based pricing compliance and
          day-to-day operational tools. The sidebar is organized into{' '}
          <span className="font-semibold">Menu</span> (monitoring and shared data),{' '}
          <span className="font-semibold">Tools</span> (document and label utilities), and{' '}
          <span className="font-semibold">General</span> (about, FAQ, and feedback). Warehouse station
          accounts open <span className="font-semibold">Label Station</span> only, plus General pages.
        </p>
        <p className="mt-2 text-sm text-gray-600 max-w-4xl">
          <span className="font-semibold">Keepa access</span> unlocks the full Menu and Label Station in
          Tools. <span className="font-semibold">Warehouse-only</span> accounts see Label Station and
          General. <span className="font-semibold">Superadmins</span> also get User Management and
          maintenance controls.
        </p>

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
        <p className="mt-3 text-gray-700">
          Core pages for monitoring vendor runs, managing compliance data, and preparing report output.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-gray-700">
          <li>
            <span className="font-semibold">Dashboard:</span> Live overview of vendor daily runs with countdown timers,
            grouped into active and inactive runs.
          </li>
          <li>
            <span className="font-semibold">Express Jobs:</span> On-demand Keepa checks against managed UPCs, with
            recipient selection and report output in API Mode or Import Mode.
          </li>
          <li>
            <span className="font-semibold">Daily Runs:</span> Scheduled monitoring per vendor category (DNK, CLK, OBZ,
            REF, BOR, SFF, TEV, CHA). Each vendor can run in API Mode (live Keepa data) or Import Mode (uploaded Keepa
            report files).
          </li>
          <li>
            <span className="font-semibold">Manage UPCs:</span> Add, search, and maintain UPC lists by vendor category
            used in scheduled and on-demand processing.
          </li>
          <li>
            <span className="font-semibold">Manage MAP:</span> Maintain minimum advertised price (MAP) values by UPC and
            vendor for pricing compliance checks.
          </li>
          <li>
            <span className="font-semibold">Seller List:</span> Maintain Amazon seller IDs and display names referenced in
            report output.
          </li>
          <li>
            <span className="font-semibold">Email List:</span> Shared directory of named email recipients for express jobs
            and daily runs.
          </li>
        </ul>
        <p className="mt-4 text-sm text-gray-600">
          Express Jobs, Daily Runs, Manage UPCs, Manage MAP, Seller List, and Email List require Keepa access on your
          account.
        </p>
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">Tools</h2>
        <p className="mt-3 text-gray-700">
          Standalone utilities for common warehouse and operations tasks.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-gray-700">
          <li>
            <span className="font-semibold">Micro Tools:</span> Team shortcuts to external utilities and links. Signed-in
            users can browse shared entries and add or edit tools they created.
          </li>
          <li>
            <span className="font-semibold">Tracking Extractor:</span> Upload carrier PDFs or ZIP archives to extract
            tracking numbers into an Excel file, with scan history for past uploads.
          </li>
          <li>
            <span className="font-semibold">FNSKU Labels:</span> Parse FBA shipment spreadsheets and generate FNSKU label
            PDFs or workbooks for warehouse labeling.
          </li>
          <li>
            <span className="font-semibold">Label Station:</span> Scan a product UPC, look up the warehouse catalog, and
            print a Zebra label (desktop app) or download a PDF (web). Catalog managers can import products from Excel.
            Staff always scan the UPC barcode. Products with a short catalog SKU (7 numeric digits or fewer) print that
            SKU under the barcode; longer SKUs print the UPC. Choose label size (small, medium, or large) and printer
            resolution (203 or 300 dpi). On-screen preview matches the physical label.
          </li>
        </ul>
        <p className="mt-4 text-sm text-gray-600">
          Label Station in Tools requires Keepa access or a warehouse-only account.
        </p>
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">General</h2>
        <p className="mt-3 text-gray-700">
          Shared pages available from the bottom of the sidebar.
        </p>
        <ul className="mt-4 list-disc space-y-2 pl-6 text-gray-700">
          <li>
            <span className="font-semibold">About:</span> This page — app version, feature overview, and desktop update
            controls.
          </li>
          <li>
            <span className="font-semibold">FAQ:</span> Job aids, how-to guides, and quick reference links for common
            tasks.
          </li>
          <li>
            <span className="font-semibold">Feedback From Users:</span> Submit suggestions or issues. Admins can review
            all feedback; everyone else sees their own submissions.
          </li>
          <li>
            <span className="font-semibold">User Management:</span> Superadmin only — manage accounts, permissions, and
            maintenance mode (when enabled, only superadmins and allowlisted emails can use the API).
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
          QA (Quality Assurance) Testers:{' '}
          <span className="font-semibold">Stephanie Roque / Sunshine Gale Ocampo</span>
        </p>
      </div>
    </div>
  )
}

