import {
  APP_COPYRIGHT_OWNER,
  APP_GIT_COMMIT_SHORT,
  APP_NAME,
  APP_VERSION_LABEL,
} from '../constants/app'

export default function About() {
  return (
    <div className="space-y-6">
      <div className="card p-8">
        <div className="mb-4">
          <img src="/app-icon.svg" alt={`${APP_NAME} logo`} className="w-14 h-14" />
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
          {APP_NAME} is a workspace built to help teams monitor product pricing and act quickly.
          Its core purpose is Keepa-based compliance monitoring across vendors, with API and Upload workflows,
          shared recipient management, and report delivery that teams can use immediately.
        </p>
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">Primary Focus: Keepa Alert Services</h2>
        <div className="mt-4 space-y-4 text-gray-700">
          <p>
            Keepa Alert Services is the heart of the platform. It processes managed UPCs against Keepa data,
            compares market pricing with MAP, and highlights off-price activity for rapid review.
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <span className="font-semibold">Express Jobs:</span> On-demand checks with report output and recipient selection.
            </li>
            <li>
              <span className="font-semibold">Daily Runs:</span> Scheduled monitoring per vendor category (DNK, CLK, OBZ, REF, BOR, SFF, TEV, CHA), grouped by active and inactive runs on the dashboard.
            </li>
            <li>
              <span className="font-semibold">API Mode and Import Mode:</span> API Mode uses live Keepa data, while Import Mode evaluates uploaded Keepa report data against managed MAP/UPC scope.
            </li>
            <li>
              <span className="font-semibold">Mode Switching:</span> Vendors can switch between API and Import modes while keeping the same scheduled run time.
            </li>
            <li>
              <span className="font-semibold">Email List and Reporting:</span> Centralized recipient directory with named contacts for runs/jobs, plus CSV/email outputs with seller-aware Amazon links.
            </li>
            <li>
              <span className="font-semibold">Alert Reporting:</span> Findings are converted into downloadable and email-ready outputs when reporting and SMTP settings are configured.
            </li>
            <li>
              <span className="font-semibold">UPC and MAP Support:</span> Uses managed UPC and MAP data per vendor category to evaluate pricing accurately.
            </li>
            <li>
              <span className="font-semibold">Access by Role:</span> Keepa, UPC/MAP, and related workflows are permission-based, so visibility can vary by account role.
            </li>
          </ul>
        </div>
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">Secondary Focus: Documentations</h2>
        <div className="mt-4 space-y-4 text-gray-700">
          <p>
            The Documentations area supports daily operations by keeping commonly used tools and guidance in one place.
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <span className="font-semibold">Trainings:</span> Shared links and utilities for the team.
            </li>
            <li>
              <span className="font-semibold">FAQ:</span> Common questions about using {APP_NAME} and team workflows.
            </li>
          </ul>
          <p>
            In short, Keepa Alert Services drives the monitoring and reporting outcomes, while Documentations
            helps users execute work faster and more consistently.
          </p>
        </div>
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">Copyright and Ownership</h2>
        <p className="mt-3 text-gray-700">
          &copy; {new Date().getFullYear()} {APP_NAME} {APP_VERSION_LABEL}. All rights reserved.
        </p>
        <p className="mt-2 text-gray-700">{APP_COPYRIGHT_OWNER}</p>
        <p className="mt-2 text-gray-700">
          Contact the Developer: <span className="font-semibold">Orville Barba via remote@metroshoewarehouse.com</span>
        </p>
      </div>
    </div>
  )
}

