export default function About() {
  return (
    <div className="space-y-6">
      <div className="card p-8">
        <h1 className="text-3xl font-bold text-gray-900">About This Project</h1>
        <p className="mt-3 text-gray-600 max-w-4xl">
          MSW Overwatch is a workspace built to help teams monitor product pricing and act quickly.
          Its core purpose is the Keepa API workflow: running checks, detecting off-price listings,
          and delivering reports that teams can use immediately.
        </p>
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">Primary Focus: Keepa Alert Services</h2>
        <div className="mt-4 space-y-4 text-gray-700">
          <p>
            Keepa Alert Services is the heart of the platform. It processes UPC lists against Keepa data,
            compares market pricing with MAP, and highlights off-price activity.
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <span className="font-semibold">Express Jobs:</span> Run on-demand checks for selected UPCs.
            </li>
            <li>
              <span className="font-semibold">Daily Runs (DNK/CLK):</span> Scheduled monitoring that runs automatically.
            </li>
            <li>
              <span className="font-semibold">Alert Reporting:</span> Generates downloadable reports and email outputs for findings.
            </li>
            <li>
              <span className="font-semibold">UPC and MAP Support:</span> Uses managed product and MAP data to evaluate pricing accurately.
            </li>
          </ul>
        </div>
      </div>

      <div className="card p-8">
        <h2 className="text-2xl font-semibold text-gray-900">Secondary Focus: Resources</h2>
        <div className="mt-4 space-y-4 text-gray-700">
          <p>
            The Resources area supports daily operations by keeping commonly used tools and guidance in one place.
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <span className="font-semibold">Public Tools:</span> Shared links and utilities for the team.
            </li>
            <li>
              <span className="font-semibold">Job Aids:</span> Reference materials and workflow guides.
            </li>
          </ul>
          <p>
            In short, Keepa Alert Services drives the monitoring and reporting outcomes, while Resources
            helps users execute work faster and more consistently.
          </p>
        </div>
      </div>
    </div>
  )
}

