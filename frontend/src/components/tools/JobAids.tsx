import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

const FAQ_ITEMS: { q: string; a: ReactNode }[] = [
  {
    q: 'What is MSW Overwatch?',
    a: (
      <>
        MSW Overwatch is MetroShoe Warehouse’s central workspace: dashboard, notes, notifications, and—when your
        account is enabled—Keepa-based pricing workflows, UPC and MAP management, scheduled runs, and reports.
      </>
    ),
  },
  {
    q: 'How do I sign in?',
    a: (
      <>
        Use your email and password on the sign-in page. New accounts may need approval or feature flags from an
        administrator before Keepa or reporting areas appear.
      </>
    ),
  },
  {
    q: 'What is Keepa Alert Services?',
    a: (
      <>
        Under <strong>Keepa Alert Services</strong> in the sidebar you’ll find <strong>Express Jobs</strong> (batch
        pricing work), <strong>Manage UPCs</strong> and <strong>Manage MAP</strong> for catalogs and pricing programs, and{' '}
        <strong>Daily Runs</strong> (for example DNK/CLK flows) when your role includes access. If these sections are
        hidden, your account may not have Keepa permissions yet.
      </>
    ),
  },
  {
    q: 'What are Express Jobs?',
    a: (
      <>
        Express Jobs run Keepa-related batch work (UPC batches, alerts, and related data). You can create jobs, track
        status, and remove old jobs from the Express Jobs list. Large deletes may take a short time to finish on the
        server.
      </>
    ),
  },
  {
    q: 'What is the Dashboard for?',
    a: (
      <>
        The <Link to="/dashboard" className="text-[#0B1020] font-medium underline">Dashboard</Link> shows widgets you
        can rearrange—things like scheduler countdowns and UPC/MAP stats when your account is eligible. Layout can be
        saved for your user.
      </>
    ),
  },
  {
    q: 'What is the difference between Trainings and this FAQ?',
    a: (
      <>
        <strong>Trainings</strong> (<Link to="/tools/public" className="text-[#0B1020] font-medium underline">Documentations → Trainings</Link>)
        lists curated training materials (links, videos, categories). This <strong>FAQ</strong> page explains how MSW
        Overwatch itself works. <strong>My Toolbox</strong> holds items you star or add for yourself.
      </>
    ),
  },
  {
    q: 'What are My Notes and My Space?',
    a: (
      <>
        <strong>My Notes</strong> gives you rich-text notes for your own documentation. Other “My Space” items depend
        on what your team has enabled for your account.
      </>
    ),
  },
  {
    q: 'How do notifications work?',
    a: (
      <>
        In-app notifications alert you to activity that applies to your account (for example job or system events).
        Check the bell in the header; you can mark notifications read when supported.
      </>
    ),
  },
  {
    q: 'Why is an action blocked or returning permission errors?',
    a: (
      <>
        Many areas require specific roles (for example MAP editing, tool management, or Keepa access). If you see a
        permission or 403 error, ask your administrator to confirm your account flags and team access.
      </>
    ),
  },
  {
    q: 'Who can I contact for help?',
    a: (
      <>
        For access requests, role changes, or bugs, contact your MetroShoe Warehouse system administrator or the team
        that owns MSW Overwatch. For data questions (UPCs, MAP, jobs), use your usual operations or merchandising
        channels.
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
          Common questions about MSW Overwatch and how to use it.
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
        Information here describes typical behavior; your administrator may enable or disable features per account.
      </p>
    </div>
  )
}
