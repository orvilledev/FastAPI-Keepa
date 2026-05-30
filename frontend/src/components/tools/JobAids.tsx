import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { APP_NAME } from '../../constants/app'

const FAQ_ITEMS: { q: string; a: ReactNode }[] = [
  {
    q: `What is ${APP_NAME}?`,
    a: (
      <>
        {APP_NAME} is MetroShoe Warehouse&apos;s workspace for Keepa-based pricing compliance and day-to-day
        operational tools. The sidebar is organized into <strong>Menu</strong> (monitoring and shared data) and{' '}
        <strong>Tools</strong> (document and label utilities). See the{' '}
        <Link to="/about" className="text-[#404040] font-medium underline">
          About
        </Link>{' '}
        page for a full feature overview.
      </>
    ),
  },
  {
    q: 'What is in the Menu section?',
    a: (
      <>
        Menu includes <strong>Dashboard</strong>, <strong>Express Jobs</strong>, <strong>Daily Runs</strong>,{' '}
        <strong>Manage UPCs</strong>, <strong>Manage MAP</strong>, <strong>Seller List</strong>, and{' '}
        <strong>Email List</strong>. Express Jobs through Email List require Keepa access on your account; Dashboard is
        available to all signed-in users.
      </>
    ),
  },
  {
    q: 'What does the Dashboard show?',
    a: (
      <>
        The Dashboard groups vendor daily runs into <strong>Active Runs</strong> (vendors with an upcoming scheduled
        countdown) and <strong>Inactive Runs</strong> (quick links to each vendor&apos;s daily-run page). It is the
        fastest way to see what is running now and what is idle.
      </>
    ),
  },
  {
    q: 'What are Express Jobs?',
    a: (
      <>
        Express Jobs are on-demand Keepa checks against managed UPCs. You create a job, choose recipients, and run in{' '}
        <strong>API Mode</strong> (live Keepa data) or <strong>Import Mode</strong> (uploaded Keepa report file). Job
        status, results, and cleanup live under Express Jobs in the sidebar.
      </>
    ),
  },
  {
    q: 'What are Daily Runs?',
    a: (
      <>
        Daily Runs are scheduled monitoring per vendor category (DNK, CLK, OBZ, REF, BOR, SFF, TEV, CHA). Open{' '}
        <strong>Daily Runs</strong> in the sidebar to pick a vendor hub, then configure schedule, mode, recipients, and
        reporting for that vendor.
      </>
    ),
  },
  {
    q: 'What is the difference between API Mode and Import Mode?',
    a: (
      <>
        <strong>API Mode</strong> pulls live Keepa data at run time. <strong>Import Mode</strong> compares the latest
        uploaded Keepa report file against MAP using Manage UPCs as run scope. Both modes use the same schedule time; the
        selected mode determines which data source is used.
      </>
    ),
  },
  {
    q: 'Can I switch modes and keep the same scheduled time?',
    a: (
      <>
        Yes. Use the mode toggle on a vendor Daily Run page (<strong>API Mode</strong> / <strong>Import Mode</strong>).
        The next scheduled run uses whichever mode is currently selected for that vendor.
      </>
    ),
  },
  {
    q: 'What is Manage UPCs?',
    a: (
      <>
        Manage UPCs opens a vendor hub (DNK, CLK, OBZ, and the other categories). From there you add, search, bulk-import,
        and delete UPCs for that vendor. Those lists define which products are included in scheduled and on-demand Keepa
        processing.
      </>
    ),
  },
  {
    q: 'What is Manage MAP?',
    a: (
      <>
        Manage MAP stores minimum advertised price (MAP) values by UPC and vendor. Daily Runs and Express Jobs compare
        Keepa pricing against these MAP entries to flag off-price listings.
      </>
    ),
  },
  {
    q: 'What is Seller List?',
    a: (
      <>
        Seller List maintains Amazon seller IDs and display names (for example{' '}
        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">A1HQOHOLTUK58E, Buy DBDeals</code>). Report output
        uses this directory to label sellers consistently.
      </>
    ),
  },
  {
    q: 'What is Email List?',
    a: (
      <>
        Email List is the shared directory of named email recipients used when configuring Express Jobs and Daily Runs.
        Add contacts individually or upload a list so report emails go to the right people.
      </>
    ),
  },
  {
    q: 'What gets flagged in Daily API runs: buy-box only or also non-buy-box sellers?',
    a: (
      <>
        Daily API runs flag both buy-box and non-buy-box sellers that are below MAP (the run scope is
        <code> buybox_and_non_buybox_below_map </code> for scheduled daily processing).
      </>
    ),
  },
  {
    q: 'Do Import Daily Run and Trigger Import Run Now (Express) send emails?',
    a: (
      <>
        Yes. Both paths run through the same uploaded-mode scheduler flow and include report generation and email sending
        when recipients and SMTP settings are configured correctly.
      </>
    ),
  },
  {
    q: 'Why can Import Mode produce no results even when my file has off-MAP rows?',
    a: (
      <>
        Common causes are: uploaded file parse not completed yet, no overlap between uploaded UPCs and Manage UPCs, missing
        MAP entries for those UPCs, or seller exclusion filters. Check uploaded report status first, then confirm overlap
        and MAP coverage.
      </>
    ),
  },
  {
    q: 'Are Amazon URLs in reports the same for API, Express Jobs, and Upload?',
    a: (
      <>
        They are built by one shared URL formatter, but output depends on seller id quality:
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>
            API/Express rows with real seller ids use seller-filtered URLs:
            <code> https://www.amazon.com/dp/ASIN?smid=SELLER_ID&amp;th=1&amp;psc=1</code>.
          </li>
          <li>
            Upload rows use the uploaded Amazon link (column U) or a clean ASIN URL when seller id is synthetic.
          </li>
        </ul>
      </>
    ),
  },
  {
    q: 'What is in the Tools section?',
    a: (
      <>
        Tools includes <strong>Micro Tools</strong>, <strong>Tracking Extractor</strong>, and{' '}
        <strong>FNSKU Labels</strong>. These are standalone utilities and do not require Keepa access.
      </>
    ),
  },
  {
    q: 'What is Micro Tools?',
    a: (
      <>
        Micro Tools is a shared shortcut board for external utilities and team links. Everyone signed in can browse entries;
        you can add new tools and edit or delete tools you created.
      </>
    ),
  },
  {
    q: 'What is Tracking Extractor?',
    a: (
      <>
        Tracking Extractor accepts carrier PDFs or ZIP archives, extracts tracking numbers, and exports them to Excel. Past
        scans are kept in history so you can reopen or delete previous uploads.
      </>
    ),
  },
  {
    q: 'What is FNSKU Labels?',
    a: (
      <>
        FNSKU Labels parses FBA shipment spreadsheets (CSV, Excel, or ZIP bundles) and generates FNSKU label PDFs or
        workbooks for warehouse labeling.
      </>
    ),
  },
  {
    q: 'Why don’t I see Express Jobs, Daily Runs, or other Keepa pages?',
    a: (
      <>
        Those Menu items require Keepa access on your account. If they are missing from the sidebar, ask an administrator
        to enable the right permissions for your role.
      </>
    ),
  },
]

export default function JobAids() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">FAQ</h1>
        <p className="mt-1 text-sm text-gray-500">
          Common questions about {APP_NAME} Menu and Tools features, aligned with the{' '}
          <Link to="/about" className="text-[#404040] font-medium underline">
            About
          </Link>{' '}
          page.
        </p>
      </div>

      <div className="space-y-3">
        {FAQ_ITEMS.map(({ q, a }) => (
          <details
            key={q}
            className="group card border border-gray-200/80 rounded-xl p-0 overflow-hidden shadow-sm open:shadow-md transition-shadow"
          >
            <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-gray-900 flex items-center justify-between gap-3 hover:bg-gray-50/80 [&::-webkit-details-marker]:hidden">
              <span>{q}</span>
              <span className="text-gray-400 text-xl leading-none shrink-0 group-open:rotate-180 transition-transform">
                ▼
              </span>
            </summary>
            <div className="px-5 pb-5 pt-0 text-sm text-gray-600 leading-relaxed border-t border-gray-100">
              <div className="pt-4">{a}</div>
            </div>
          </details>
        ))}
      </div>

      <p className="text-xs text-gray-400">
        Keepa-related Menu items require account access; Tools are available to all signed-in users.
      </p>
    </div>
  )
}
