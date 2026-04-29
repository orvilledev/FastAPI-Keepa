import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

const FAQ_ITEMS: { q: string; a: ReactNode }[] = [
  {
    q: 'What is the Keepa API workflow in this project?',
    a: (
      <>
        MSW Overwatch is built around the Keepa API workflow: teams monitor product pricing, run checks against Keepa
        data, spot off-price listings, and receive reports they can use right away. See also the{' '}
        <Link to="/about" className="text-[#0B1020] font-medium underline">
          About
        </Link>{' '}
        page for how this fits together.
      </>
    ),
  },
  {
    q: 'What is Keepa Alert Services?',
    a: (
      <>
        It is the core of the platform: processing UPC lists against Keepa data, comparing market pricing to MAP, and
        highlighting off-price activity. The sidebar groups related tools—Express Jobs, UPC and MAP management, Daily
        Runs, and reporting—when your account has access.
      </>
    ),
  },
  {
    q: 'What are Express Jobs?',
    a: (
      <>
        Express Jobs are on-demand checks: you run batch work against selected UPCs (jobs, status, and cleanup live
        under Express Jobs in the app). They are part of the Keepa Alert Services workflow described on{' '}
        <Link to="/about" className="text-[#0B1020] font-medium underline">
          About
        </Link>
        .
      </>
    ),
  },
  {
    q: 'What are Daily Runs?',
    a: (
      <>
        Daily Runs are scheduled monitoring per vendor category (DNK, CLK, OBZ, REF, BOR, SFF, TEV, CHA) so pricing
        stays under review without starting each batch by hand.
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
        Yes. Use the mode toggle in Vendor Daily Run (<strong>API Mode</strong> / <strong>Import Mode</strong>). The next
        scheduled run uses whichever mode is currently selected for that vendor.
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
    q: 'Do Upload Daily Run and Trigger Upload Run Now (Express) send emails?',
    a: (
      <>
        Yes. Both paths run through the same uploaded-mode scheduler flow and include report generation + email sending
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
    q: 'What is Alert Reporting?',
    a: (
      <>
        Alert Reporting turns findings into outputs your team can use: downloadable reports and email-style outputs when
        the workflow is configured for them.
      </>
    ),
  },
  {
    q: 'How do UPC and MAP data support Keepa checks?',
    a: (
      <>
        Managed UPC lists and MAP (minimum advertised price) data feed the comparisons: the system evaluates listings
        against MAP and Keepa market data so off-price activity is easier to see.
      </>
    ),
  },
  {
    q: 'Why don’t I see Keepa or UPC/MAP features?',
    a: (
      <>
        Those areas depend on account access to the Keepa-related tools. If Express Jobs, UPC/MAP, or Daily Runs are
        missing, your administrator may need to enable the right permissions for your role.
      </>
    ),
  },
]

export default function JobAids() {
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">FAQ</h1>
        <p className="mt-1 text-sm text-gray-500">
          Questions about the Keepa Alert Services workflow and Documentations (Trainings and this FAQ), aligned with the{' '}
          <Link to="/about" className="text-[#0B1020] font-medium underline">
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
        Scope is the Keepa-related product and Documentations; availability of features may vary by account.
      </p>
    </div>
  )
}
