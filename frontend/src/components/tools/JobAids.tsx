import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { APP_NAME } from '../../constants/app'

const FAQ_ITEMS: { q: string; a: ReactNode }[] = [
  {
    q: `What is ${APP_NAME}?`,
    a: (
      <>
        {APP_NAME} is MetroShoe Warehouse&apos;s workspace for Keepa-based pricing compliance and day-to-day
        operational tools. The sidebar is organized into <strong>Menu</strong> (monitoring and shared data),{' '}
        <strong>Tools</strong> (document and label utilities), and <strong>General</strong> (about, FAQ, and
        feedback). Warehouse station accounts open <strong>Label Station</strong> only, plus General pages. See the{' '}
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
        Menu includes <strong>Dashboard</strong>, <strong>Notifications</strong>, <strong>Express Jobs</strong>,{' '}
        <strong>Daily Runs</strong>, <strong>Manage UPCs</strong>, <strong>Manage MAP</strong>,{' '}
        <strong>Seller List</strong>, and <strong>Email List</strong>. Express Jobs through Email List require Keepa
        access on your account; Dashboard and Notifications are available to all signed-in users (warehouse-only accounts
        do not see the notifications bell).
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
        status, results, and cleanup live under Express Jobs in the sidebar. Delete finished jobs from the job list or
        detail page when you no longer need them.
      </>
    ),
  },
  {
    q: 'What are Daily Runs?',
    a: (
      <>
        Daily Runs are scheduled monitoring per vendor category (DNK, CLK, OBZ, REF, BOR, SFF, TEV, CHA, JFS). Open{' '}
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
        when recipients and SMTP settings are configured correctly. Each <strong>new</strong> completed run can send its
        own email the same day (for example after countdown, then Trigger Import Run Now). The same job is never emailed
        twice.
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
        Tools includes <strong>Micro Tools</strong>, <strong>Tracking Extractor</strong>, <strong>FNSKU Labels</strong>,{' '}
        <strong>Keepa Import File</strong>, and <strong>Label Station</strong>. Micro Tools, Tracking Extractor, and
        FNSKU Labels are available to all signed-in users. <strong>Keepa Import File</strong> and{' '}
        <strong>Label Station</strong> require Keepa access or a warehouse-only account.
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
        workbooks for warehouse labeling. Past runs are kept in history — delete individual entries or use{' '}
        <strong>Clear history</strong> to remove them all.
      </>
    ),
  },
  {
    q: 'What is Label Station?',
    a: (
      <>
        Label Station is a scan-and-print tool for warehouse labeling. Staff scan a product <strong>UPC</strong>; the app
        looks up the product in the warehouse catalog and prints a formatted label to a Zebra printer (desktop app) or
        downloads a PDF (web browser). Each label shows FNSKU, a scannable barcode, UPC or SKU, condition, and product
        name. Choose label size (small, medium, or large) and printer resolution (203 or 300 dpi). The on-screen preview
        matches the physical label. Catalog managers with Keepa access can import or update products from Excel in the
        Product Catalog tab.
      </>
    ),
  },
  {
    q: 'What is the short-SKU rule on Label Station labels?',
    a: (
      <>
        Staff always scan the <strong>UPC</strong> barcode. If the catalog SKU has <strong>7 numeric digits or fewer</strong>{' '}
        (for example <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">9990357</code>), the label prints that{' '}
        <strong>SKU</strong> under the barcode instead of the UPC. Longer SKUs print the UPC as before.
      </>
    ),
  },
  {
    q: 'What is Keepa Import File?',
    a: (
      <>
        <strong>Keepa Import File</strong> builds Keepa Excel files from the UPCs in Manage UPCs so you can feed Daily Run{' '}
        <strong>Import Mode</strong>. Pick a vendor, click <strong>Download Keepa file</strong>, and use the output on a
        vendor Daily Run page. You can also schedule automatic builds, optional off-price MAP reports, and email delivery
        per vendor. Build history shows past runs with download, contents preview, and <strong>Clear history</strong>{' '}
        controls. The tool requires Keepa access; admins can turn the tool on or off globally.
      </>
    ),
  },
  {
    q: 'What are Notifications?',
    a: (
      <>
        Notifications is the team feed for completed express and daily runs. Click the <strong>bell icon</strong> in the
        top bar (or open <strong>Notifications</strong> from search) to see recent activity, mark items as read, or clear
        the list. The red badge shows how many unread items you have. Warehouse-only accounts do not see the notifications
        bell.
      </>
    ),
  },
  {
    q: 'How do I switch between light and dark mode?',
    a: (
      <>
        Click the <strong>theme toggle</strong> in the top bar — a <strong>moon</strong> icon in light mode and a{' '}
        <strong>sun</strong> icon in dark mode. The same control appears on the landing and login pages before sign-in.
        Your choice is saved on this device and applies across every page. On first visit, the app follows your
        computer&apos;s light/dark system setting until you pick a theme.
      </>
    ),
  },
  {
    q: 'How does two-factor authentication work?',
    a: (
      <>
        Most staff accounts sign in with email, password, and a 6-digit code from an authenticator app (Google
        Authenticator, Authy, 1Password, etc.). On first login you scan a QR code labeled <strong>MSW Overwatch</strong>.
        Shared <strong>warehouse-only</strong> station logins skip MFA. To replace a lost phone, open the profile menu in
        the top bar and choose <strong>Reset authenticator</strong>, then scan the new QR code.
      </>
    ),
  },
  {
    q: 'How do I find a page quickly?',
    a: (
      <>
        Use the <strong>search box</strong> in the top bar. Type part of a page name (for example &quot;Express&quot;,
        &quot;MAP&quot;, or &quot;FAQ&quot;) and pick from the grouped results under Menu, Tools, or General. Warehouse-only
        accounts see a shorter list focused on Label Station and General pages.
      </>
    ),
  },
  {
    q: 'Can I use MSW Overwatch on Windows without a browser?',
    a: (
      <>
        Yes. Click <strong>Download app</strong> in the top bar (browser only) to install the Windows desktop client. The
        Electron app includes the same features as the web UI, plus Label Station Zebra printing and an in-app{' '}
        <strong>Check for Updates</strong> button on the About page.
      </>
    ),
  },
  {
    q: 'What is in the General section?',
    a: (
      <>
        General includes <strong>About</strong> (version and feature overview), <strong>FAQ</strong> (this page),{' '}
        <strong>Feedback From Users</strong> (submit and review suggestions), and{' '}
        <strong>User Management</strong> (superadmin only — accounts, permissions, and maintenance mode).
      </>
    ),
  },
  {
    q: 'What is a warehouse-only account?',
    a: (
      <>
        Warehouse-only accounts are restricted logins for shared station PCs. The sidebar shows{' '}
        <strong>Label Station</strong> plus General pages (About, FAQ, Feedback) — not the full Menu or other Tools.
        This keeps packing stations focused on scan-and-print without access to unrelated compliance tools.
      </>
    ),
  },
  {
    q: 'Why don’t I see Express Jobs, Daily Runs, or other Keepa pages?',
    a: (
      <>
        Those Menu items require Keepa access on your account. If you have a warehouse-only login, you will only see
        Label Station and General. If Keepa pages are missing from a normal account, ask an administrator to enable the
        right permissions for your role.
      </>
    ),
  },
  {
    q: 'What happens when maintenance mode is on?',
    a: (
      <>
        When a superadmin enables maintenance mode, most users see a maintenance page and cannot use the app.{' '}
        <strong>Superadmins</strong> and emails on the server allowlist can still use the API; the web UI currently
        lets superadmins through the maintenance screen. Maintenance can be toggled from{' '}
        <strong>User Management</strong>.
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
          Common questions about {APP_NAME} Menu, Tools, General, appearance, and account access — aligned with the{' '}
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
        Keepa-related Menu items, Keepa Import File, and Label Station require the right account access; other Tools are
        available to all signed-in users. Warehouse-only accounts see Label Station and General only.
      </p>
    </div>
  )
}
