import { Link, useLocation } from 'react-router-dom'
import {
  useState,
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { useUser } from '../../contexts/UserContext'
import { useToolBookmarks } from '../../contexts/ToolBookmarksContext'
import { APP_NAME } from '../../constants/app'
import AppLogo from '../common/AppLogo'
import SidebarBookmarkButton from './SidebarBookmarkButton'
import { isToolboxDivider } from '../myspace/toolCatalog'
import { canAccessWebAnalytics } from '../../lib/devFeatures'
import { canAccessFbaBoxContents } from '../../lib/fbaBoxContentsAccess'
import { canAccessOldSkus } from '../../lib/oldSkusAccess'
import { canAccessBcTools } from '../../lib/bcToolsAccess'
import { canAccessLabelFormatChecker } from '../../lib/labelFormatCheckerAccess'
import { canAccessLtlLabelFormatChecker } from '../../lib/ltlLabelFormatCheckerAccess'
import { canAccessShipmentManager } from '../../lib/shipmentManagerAccess'
import { canAccessFbaOrderChecker } from '../../lib/fbaOrderCheckerAccess'
import { canAccessFreightClassCalculator } from '../../lib/freightClassAccess'
import { canAccessDimensioner } from '../../lib/dimensionerAccess'
import { canAccessNsTool } from '../../lib/nsToolAccess'
import { canAccessSessionAudit } from '../../lib/sessionAuditAccess'
import { canWarehouseAccessFnskuLabels } from '../../constants/warehouseAccess'
import { isLabelCenterAvailable } from '../../lib/privatePath'
import { useChatUnreadCount } from '../../hooks/useChatUnreadCount'
import { canAccessTeamChat } from '../../lib/teamChatAccess'

// SVG Icon components that inherit text color via currentColor
const Icons = {
  dashboard: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  package: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  labelCenter: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="3" y="5" width="18" height="14" rx="2" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2} d="M7 9h10M8 13h8M9 16h6" />
    </svg>
  ),
  barcode: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
    </svg>
  ),
  dollar: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  biking: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="17.5" cy="5" r="1.75" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.5 6.5L12 10l-1.5 7" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10l-4 1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.5 17l2 2.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 10.5h4" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12l2.5 6M12 10l4.5 8" />
      <circle cx="7" cy="18" r="2.25" strokeWidth={2} />
      <circle cx="17" cy="18" r="2.25" strokeWidth={2} />
    </svg>
  ),
  user: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  toolbox: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
  ),
  wrench: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    </svg>
  ),
  users: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  liveSessions: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.636 18.364a9 9 0 010-12.728m12.728 0a9 9 0 010 12.728M8.464 15.536a5 5 0 010-7.072m7.072 0a5 5 0 010 7.072M12 12h.01" />
    </svg>
  ),
  audit: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  mail: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8m-18 8h18a2 2 0 002-2V8a2 2 0 00-2-2H3a2 2 0 00-2 2v6a2 2 0 002 2z" />
    </svg>
  ),
  shipTo: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  oldSkus: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  feedback: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.018c8.836 0 16 8.058 16 9.036v7.964a1 1 0 01-1.618.794L17 21" />
    </svg>
  ),
  teamChat: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
    </svg>
  ),
  mySpace: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
    </svg>
  ),
  scanner: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7V5a1 1 0 011-1h2m10 0h2a1 1 0 011 1v2M4 17v2a1 1 0 001 1h2m10 0h2a1 1 0 001-1v-2M7 8v8m3-8v8m3-8v8m3-8v8" />
    </svg>
  ),
  trackingExtractor: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  fnskuLabels: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  fnskuBoxPivot: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M3 14h18M4 6h16a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V7a1 1 0 011-1z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 6v12" />
    </svg>
  ),
  fbaBoxContents: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 3h3m3 0h.01M13 20h7" />
    </svg>
  ),
  fbaShipmentLibrary: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M4 12h16M4 17h10" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16" />
    </svg>
  ),
  manifestGenerator: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6M9 8h1m5 0h.01M7 3h8l4 4v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
    </svg>
  ),
  productCatalog: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h10" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V6a1 1 0 011-1z" />
    </svg>
  ),
  obzSmwFbaInv: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7h18M3 12h18M3 17h10M17 14l4 4m0-4v4h-4" />
    </svg>
  ),
  labelFormatChecker: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3h7l5 5v13H7a1 1 0 01-1-1V4a1 1 0 011-1zm7 0v5h5M9 14l2 2 4-4" />
    </svg>
  ),
  ltlLabelFormatChecker: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3h7l5 5v13H7a1 1 0 01-1-1V4a1 1 0 011-1zm7 0v5h5M9 12h1m-1 4h1m3-4h3m-3 4h3" />
    </svg>
  ),
  nsTool: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-6m4 6V7m4 10v-3M4 4h16a1 1 0 011 1v14a1 1 0 01-1 1H4a1 1 0 01-1-1V5a1 1 0 011-1z" />
    </svg>
  ),
  dnkAllInventory: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10M4 18h10M15 14l5 5m0-5v5h-5" />
    </svg>
  ),
  shipmentManager: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1" />
    </svg>
  ),
  freightClassCalculator: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  dimensioner: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l14-14 4 4L7 21l-4-4zm4-2l2 2m1-5l2 2m1-5l2 2" />
    </svg>
  ),
  chart: (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
}

interface SidebarProps {
  /** Mobile-only: whether the off-canvas drawer is open. Ignored on lg+ where the sidebar is always static. */
  mobileOpen?: boolean
  /** Mobile-only: called when a navigation link is tapped so the drawer can close. */
  onNavigate?: () => void
  /** Desktop: slide the sidebar off to the left. */
  collapsed?: boolean
}

const NAV_EXTRAS_EXPANDED_KEY = 'sidebar-nav-extras-expanded'
const DIVIDER_LABEL_MAX = 40
const NEW_DIVIDER_INPUT = '__new-divider__'

function readNavExtrasExpanded(): boolean {
  try {
    const stored = localStorage.getItem(NAV_EXTRAS_EXPANDED_KEY)
    if (stored === null) return true
    return stored !== 'false'
  } catch {
    return true
  }
}

export default function Sidebar({ mobileOpen = false, onNavigate, collapsed = false }: SidebarProps = {}) {
  const location = useLocation()
  const { hasKeepaAccess, isWarehouseOnly, isSuperadmin, userInfo, authUser } = useUser()
  const canUseFbaBoxContents = canAccessFbaBoxContents(
    userInfo?.email || authUser?.email,
    isSuperadmin,
  )
  const canUseOldSkus = canAccessOldSkus(
    userInfo?.email || authUser?.email,
    isSuperadmin,
  )
  const canUseBcTools = canAccessBcTools(
    userInfo?.email || authUser?.email,
    isSuperadmin,
  )
  const accountEmail = userInfo?.email || authUser?.email
  const canUseLabelFormatChecker = canAccessLabelFormatChecker(accountEmail)
  const canUseLtlLabelFormatChecker = canAccessLtlLabelFormatChecker(
    accountEmail,
    isSuperadmin,
  )
  const canUseFnskuLabels = canWarehouseAccessFnskuLabels(accountEmail)
  const canUseShipmentManager = canAccessShipmentManager(accountEmail)
  const canUseFbaOrderChecker = canAccessFbaOrderChecker(
    accountEmail,
    isSuperadmin,
  )
  const canUseFreightClass = canAccessFreightClassCalculator(
    accountEmail,
    isSuperadmin,
  )
  const canUseDimensioner = canAccessDimensioner(accountEmail, isSuperadmin)
  const canViewSessionAudit = canAccessSessionAudit(accountEmail, isSuperadmin)
  const canUseNsTool = canAccessNsTool(accountEmail, isSuperadmin)
  const canUseTeamChat = canAccessTeamChat(accountEmail, isSuperadmin)
  const chatUnread = useChatUnreadCount(Boolean(authUser) && canUseTeamChat)
  const isElectron = Boolean(window.desktop?.isElectron)
  const [desktopVersion, setDesktopVersion] = useState<string | null>(null)
  const [isCheckingUpdates, setIsCheckingUpdates] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')
  /** Only one sidebar row shows "highlight" while hovering; route highlight defers to hover target. */
  const [hoveredNav, setHoveredNav] = useState<string | null>(null)
  /** When false, only My Space + My Toolbox stay visible; Menu / tools / General collapse. */
  const [navExtrasExpanded, setNavExtrasExpanded] = useState(readNavExtrasExpanded)

  useEffect(() => {
    try {
      localStorage.setItem(NAV_EXTRAS_EXPANDED_KEY, navExtrasExpanded ? 'true' : 'false')
    } catch {
      /* ignore quota / private mode */
    }
  }, [navExtrasExpanded])

  const isActive = (path: string) => {
    const currentPath = location.pathname
    const currentSearch = location.search || ''

    if (path.includes('?')) {
      const [pathname, query] = path.split('?', 2)
      if (currentPath !== pathname) return false
      const want = new URLSearchParams(query)
      const have = new URLSearchParams(currentSearch)
      for (const key of want.keys()) {
        if (want.get(key) !== have.get(key)) return false
      }
      return true
    }

    if (currentPath === path) return true

    // /jobs matches /jobs/123, /jobs/new, etc.
    const parentRoutes = ['/jobs', '/shipment-manager']
    if (parentRoutes.includes(path)) {
      return currentPath.startsWith(path + '/')
    }

    // /daily-run matches any /daily-run/xxx vendor page
    if (path === '/daily-run') {
      return currentPath.startsWith('/daily-run/')
    }

    // /my-space matches nested my-space routes
    if (path === '/my-space') {
      return currentPath === '/my-space' || currentPath.startsWith('/my-space/')
    }

    // /manage-upcs or /upcs hub highlights when on any /upcs?category=xxx page
    if (path === '/manage-upcs') {
      return currentPath === '/upcs' || currentPath === '/manage-upcs'
    }

    return false
  }

  const navHighlighted = (id: string, routeActive: boolean) =>
    (hoveredNav === null && routeActive) || hoveredNav === id

  const { bookmarks, toolboxEntries, reorderToolbox, addDivider, renameDivider, removeDivider } =
    useToolBookmarks()
  const toolboxListRef = useRef<HTMLDivElement>(null)
  /** Live order (entry ids) while a My Toolbox row is being dragged; null when idle. */
  const [toolboxDragOrder, setToolboxDragOrder] = useState<string[] | null>(null)
  const [toolboxDraggingId, setToolboxDraggingId] = useState<string | null>(null)
  const toolboxDragCleanupRef = useRef<(() => void) | null>(null)
  const [editingDividerId, setEditingDividerId] = useState<string | null>(null)
  const [dividerDraft, setDividerDraft] = useState('')
  const [addingDivider, setAddingDivider] = useState(false)
  const [newDividerDraft, setNewDividerDraft] = useState('')
  /** Which divider input is open; guards against saving twice (Enter, then blur on unmount). */
  const dividerInputRef = useRef<string | null>(null)

  useEffect(
    () => () => {
      toolboxDragCleanupRef.current?.()
      document.body.classList.remove('toolbox-dragging')
    },
    [],
  )

  const pathIconMap = useMemo(() => {
    const map: Record<string, ReactNode> = {
      '/dashboard': Icons.dashboard,
      '/jobs': Icons.package,
      '/daily-run': Icons.biking,
      '/manage-upcs': Icons.barcode,
      '/map': Icons.dollar,
      '/seller-list': Icons.users,
      '/email-list': Icons.mail,
      '/ship-to-addresses': Icons.shipTo,
      '/analytics': Icons.chart,
      '/catalog/old-skus': Icons.oldSkus,
      '/micro-tools': Icons.toolbox,
      '/tracking-scanner': Icons.trackingExtractor,
      '/fnsku-labels': Icons.fnskuLabels,
      '/fnsku-pack-station': Icons.fnskuBoxPivot,
      '/manifest-generator': Icons.manifestGenerator,
      '/dnk-all-inventory': Icons.dnkAllInventory,
      '/label-center': Icons.labelCenter,
      '/label-station': Icons.scanner,
      '/label-station-2': Icons.scanner,
      '/fba-shipment-library': Icons.fbaShipmentLibrary,
      '/freight-class-calculator': Icons.freightClassCalculator,
      '/label-format-checker': Icons.labelFormatChecker,
      '/ltl-label-format-checker': Icons.ltlLabelFormatChecker,
      '/dimensioner': Icons.dimensioner,
      '/fba-box-contents': Icons.fbaBoxContents,
      '/product-catalog-formatter': Icons.productCatalog,
      '/obz-smw-fba-inv': Icons.obzSmwFbaInv,
      '/ns-tool': Icons.nsTool,
      '/shipment-manager': Icons.shipmentManager,
      '/about': Icons.info,
      '/faq': Icons.wrench,
      '/chat': Icons.teamChat,
      '/feedback': Icons.feedback,
      '/notifications': Icons.mail,
      '/admin/users': Icons.users,
      '/admin/live-sessions': Icons.liveSessions,
      '/admin/audit-log': Icons.audit,
    }
    return map
  }, [])

  const toolboxItems = useMemo(
    () =>
      toolboxEntries.map((link) => ({
        kind: isToolboxDivider(link) ? ('divider' as const) : ('tool' as const),
        linkId: link.id,
        path: link.url,
        label: link.title,
        icon: pathIconMap[link.url] || Icons.toolbox,
        id: `toolbox-${link.id}`,
      })),
    [toolboxEntries, pathIconMap],
  )

  const orderedToolboxItems = useMemo(() => {
    if (!toolboxDragOrder) return toolboxItems
    const byId = new Map(toolboxItems.map((item) => [item.linkId, item]))
    const ordered = toolboxDragOrder
      .map((linkId) => byId.get(linkId))
      .filter((item): item is (typeof toolboxItems)[number] => Boolean(item))
    return ordered.length === toolboxItems.length ? ordered : toolboxItems
  }, [toolboxItems, toolboxDragOrder])

  const startToolboxDrag = (event: ReactPointerEvent<HTMLButtonElement>, linkId: string) => {
    if (event.button !== 0) return
    event.preventDefault()
    toolboxDragCleanupRef.current?.()

    const original = toolboxEntries.map((link) => link.id)
    let current = original
    setToolboxDraggingId(linkId)
    setToolboxDragOrder(original)

    const bodyStyle = document.body.style
    const prevUserSelect = bodyStyle.userSelect
    bodyStyle.userSelect = 'none'
    document.body.classList.add('toolbox-dragging')

    const handleMove = (moveEvent: PointerEvent) => {
      const list = toolboxListRef.current
      if (!list) return
      const otherRows = Array.from(list.querySelectorAll<HTMLElement>('[data-toolbox-id]')).filter(
        (row) => row.dataset.toolboxId !== linkId,
      )
      let targetIndex = 0
      for (const row of otherRows) {
        const rect = row.getBoundingClientRect()
        if (moveEvent.clientY > rect.top + rect.height / 2) targetIndex += 1
      }
      const others = current.filter((id) => id !== linkId)
      const next = [...others.slice(0, targetIndex), linkId, ...others.slice(targetIndex)]
      if (next.some((id, index) => id !== current[index])) {
        current = next
        setToolboxDragOrder(next)
      }
    }

    const finish = (commit: boolean) => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      window.removeEventListener('pointercancel', handleCancel)
      bodyStyle.userSelect = prevUserSelect
      document.body.classList.remove('toolbox-dragging')
      toolboxDragCleanupRef.current = null
      setToolboxDraggingId(null)
      setToolboxDragOrder(null)
      if (commit && current.some((id, index) => id !== original[index])) {
        void reorderToolbox(current).catch(() => {
          /* order is reloaded from the server on failure */
        })
      }
    }
    const handleUp = () => finish(true)
    const handleCancel = () => finish(false)

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
    window.addEventListener('pointercancel', handleCancel)
    toolboxDragCleanupRef.current = () => finish(false)
  }

  const handleToolboxHandleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, linkId: string) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const ids = toolboxEntries.map((link) => link.id)
    const from = ids.indexOf(linkId)
    const to = from + (event.key === 'ArrowUp' ? -1 : 1)
    if (from < 0 || to < 0 || to >= ids.length) return
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    void reorderToolbox(ids).catch(() => {
      /* order is reloaded from the server on failure */
    })
  }

  const beginRenameDivider = (linkId: string, label: string) => {
    dividerInputRef.current = linkId
    setAddingDivider(false)
    setDividerDraft(label)
    setEditingDividerId(linkId)
  }

  const finishRenameDivider = (save: boolean) => {
    const linkId = dividerInputRef.current
    if (!linkId || linkId === NEW_DIVIDER_INPUT) return
    dividerInputRef.current = null
    setEditingDividerId(null)
    if (save && dividerDraft.trim()) {
      void renameDivider(linkId, dividerDraft).catch(() => {
        /* previous label is restored on failure */
      })
    }
  }

  const beginAddDivider = () => {
    dividerInputRef.current = NEW_DIVIDER_INPUT
    setEditingDividerId(null)
    setNewDividerDraft('')
    setAddingDivider(true)
  }

  const finishAddDivider = (save: boolean) => {
    if (dividerInputRef.current !== NEW_DIVIDER_INPUT) return
    dividerInputRef.current = null
    setAddingDivider(false)
    if (save && newDividerDraft.trim()) {
      void addDivider(newDividerDraft).catch(() => {
        /* nothing was added */
      })
    }
  }

  const handleDividerInputKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    finish: (save: boolean) => void,
  ) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      finish(true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      finish(false)
    }
  }

  const ToolLink = ({
    to,
    label,
    icon,
    id,
    bookmarkable = true,
    trailing,
  }: {
    to: string
    label: string
    icon: ReactNode
    id: string
    bookmarkable?: boolean
    trailing?: ReactNode
  }) => (
    <Link
      to={to}
      onMouseEnter={() => setHoveredNav(id)}
      className={`sidebar-link ${
        navHighlighted(id, isActive(to))
          ? 'sidebar-link-active'
          : 'sidebar-link-inactive'
      }`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="sidebar-link-label">{label}</span>
      {trailing}
      {bookmarkable && <SidebarBookmarkButton path={to} label={label} />}
    </Link>
  )

  const dividerActionClass =
    'shrink-0 rounded p-0.5 text-content-muted opacity-0 transition-opacity hover:text-content focus-visible:opacity-100 group-hover/toolbox:opacity-100 [@media(hover:none)]:opacity-60'
  const dividerInputClass =
    'w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-content outline-none focus:ring-2 focus:ring-[#81B81D]/40 dark:border-border dark:bg-surface dark:text-slate-100'

  const myToolboxSection = (
    <div className="shrink-0 space-y-0.5 pb-1 pt-1">
      <p className="sidebar-section-label">MY TOOLBOX</p>
      {bookmarks.length === 0 && (
        <p className="px-3 py-1.5 text-[11px] leading-snug text-content-muted">
          Bookmark tools with the pin icon to keep them here.
        </p>
      )}
      {orderedToolboxItems.length > 0 && (
        <div ref={toolboxListRef} className="space-y-0.5">
          {orderedToolboxItems.map((item) => {
            const dragging = toolboxDraggingId === item.linkId
            const isDivider = item.kind === 'divider'
            return (
              <div
                key={item.id}
                data-toolbox-id={item.linkId}
                className={`group/toolbox relative rounded-lg ${
                  dragging ? 'z-10 opacity-80 shadow-lg ring-2 ring-[#81B81D]/60' : ''
                }`}
              >
                {orderedToolboxItems.length > 1 && (
                  <button
                    type="button"
                    onPointerDown={(event) => startToolboxDrag(event, item.linkId)}
                    onKeyDown={(event) => handleToolboxHandleKeyDown(event, item.linkId)}
                    onClick={(event) => event.stopPropagation()}
                    aria-label={`Reorder ${item.label}${isDivider ? ' divider' : ''}. Drag, or use the up and down arrow keys.`}
                    title="Drag to reorder"
                    className="toolbox-drag-handle absolute -left-3 top-1/2 z-20 flex h-7 w-3.5 -translate-y-1/2 touch-none select-none items-center justify-center rounded opacity-0 transition-opacity group-hover/toolbox:opacity-70 focus-visible:opacity-70 [@media(hover:none)]:opacity-45"
                  >
                    {/* Soft white grip; the green hand is the cursor only (see .toolbox-drag-handle). */}
                    <svg className="h-3.5 w-2.5" viewBox="0 0 10 16" aria-hidden="true">
                      <circle cx="2.5" cy="3" r="1.35" fill="#ffffff" stroke="#111111" strokeWidth="0.9" />
                      <circle cx="7.5" cy="3" r="1.35" fill="#ffffff" stroke="#111111" strokeWidth="0.9" />
                      <circle cx="2.5" cy="8" r="1.35" fill="#ffffff" stroke="#111111" strokeWidth="0.9" />
                      <circle cx="7.5" cy="8" r="1.35" fill="#ffffff" stroke="#111111" strokeWidth="0.9" />
                      <circle cx="2.5" cy="13" r="1.35" fill="#ffffff" stroke="#111111" strokeWidth="0.9" />
                      <circle cx="7.5" cy="13" r="1.35" fill="#ffffff" stroke="#111111" strokeWidth="0.9" />
                    </svg>
                  </button>
                )}
                {!isDivider ? (
                  <ToolLink to={item.path} label={item.label} icon={item.icon} id={item.id} />
                ) : editingDividerId === item.linkId ? (
                  <div className="px-1 pb-1 pt-1.5">
                    <input
                      autoFocus
                      value={dividerDraft}
                      maxLength={DIVIDER_LABEL_MAX}
                      onChange={(event) => setDividerDraft(event.target.value)}
                      onKeyDown={(event) => handleDividerInputKeyDown(event, finishRenameDivider)}
                      onBlur={() => finishRenameDivider(true)}
                      onFocus={(event) => event.currentTarget.select()}
                      aria-label="Divider name"
                      className={dividerInputClass}
                    />
                  </div>
                ) : (
                  <div
                    className="flex items-center gap-1.5 px-3 pb-1 pt-2"
                    onDoubleClick={() => beginRenameDivider(item.linkId, item.label)}
                  >
                    <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-wider text-[#81B81D]">
                      {item.label}
                    </span>
                    <span className="h-px min-w-[0.75rem] flex-1 bg-[#81B81D]/35 dark:bg-[#81B81D]/40" aria-hidden="true" />
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        beginRenameDivider(item.linkId, item.label)
                      }}
                      aria-label={`Rename ${item.label} divider`}
                      title="Rename divider"
                      className={dividerActionClass}
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6.232-6.232a2.5 2.5 0 113.536 3.536L12.536 16.536 8 17l.464-4.536z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        void removeDivider(item.linkId).catch(() => {
                          /* list is reloaded from the server on failure */
                        })
                      }}
                      aria-label={`Remove ${item.label} divider`}
                      title="Remove divider (tools stay in My Toolbox)"
                      className={dividerActionClass}
                    >
                      <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {addingDivider ? (
        <div className="px-1 pt-1.5">
          <input
            autoFocus
            value={newDividerDraft}
            maxLength={DIVIDER_LABEL_MAX}
            placeholder="Divider name, e.g. Labels"
            onChange={(event) => setNewDividerDraft(event.target.value)}
            onKeyDown={(event) => handleDividerInputKeyDown(event, finishAddDivider)}
            onBlur={() => finishAddDivider(true)}
            aria-label="New divider name"
            className={`${dividerInputClass} placeholder:normal-case placeholder:font-normal placeholder:tracking-normal placeholder:text-gray-400`}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            beginAddDivider()
          }}
          className="flex w-full items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-content-muted transition-colors hover:bg-gray-100 hover:text-content dark:hover:bg-surface-hover dark:hover:text-slate-100"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v14M5 12h14" />
          </svg>
          Add divider
        </button>
      )}
    </div>
  )

  const navExtrasToggle = (
    <button
      type="button"
      aria-expanded={navExtrasExpanded}
      aria-controls="sidebar-nav-extras"
      onClick={(event) => {
        event.stopPropagation()
        setNavExtrasExpanded((open) => !open)
      }}
      className="mt-1 flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-content-muted transition-colors hover:bg-gray-100 hover:text-content dark:hover:bg-surface-hover dark:hover:text-slate-100"
      title={navExtrasExpanded ? 'Hide the rest of the menu' : 'Show the rest of the menu'}
    >
      <svg
        className={`h-4 w-4 shrink-0 transition-transform duration-200 ${
          navExtrasExpanded ? 'rotate-180' : ''
        }`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      </svg>
      <span className="text-[10px] font-semibold uppercase tracking-wider">
        {navExtrasExpanded ? 'Hide menu' : 'Show menu'}
      </span>
    </button>
  )

  const keepaMenuItems = [
    { path: '/jobs',         label: 'Express Jobs', icon: 'package'  as const },
    { path: '/daily-run',    label: 'Daily Runs',   icon: 'biking'   as const },
    { path: '/manage-upcs', label: 'Manage UPCs',  icon: 'barcode'  as const },
    { path: '/map',          label: 'Manage MAP',   icon: 'dollar'   as const },
    { path: '/seller-list',  label: 'Seller List',  icon: 'users'    as const },
    { path: '/email-list',   label: 'Email List',   icon: 'mail'     as const },
    { path: '/ship-to-addresses', label: 'Ship To Addresses', icon: 'shipTo' as const },
    ...(canAccessWebAnalytics(userInfo?.email || authUser?.email)
      ? [{ path: '/analytics', label: 'Analytics', icon: 'chart' as const }]
      : []),
  ]

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

  // Event-delegated close: on mobile, tapping any nav link closes the drawer.
  // Harmless on desktop where `onNavigate` is not provided.
  const handleNavClick = (event: MouseEvent<HTMLElement>) => {
    if (!onNavigate) return
    if ((event.target as HTMLElement).closest('a')) {
      onNavigate()
    }
  }

  const teamChatLink = (
    <ToolLink
      to="/chat"
      label="Team Chat"
      icon={Icons.teamChat}
      id="team-chat"
      trailing={
        chatUnread > 0 ? (
          <span
            className="inline-flex h-5 min-w-[1.25rem] shrink-0 items-center justify-center rounded-full bg-[#F97316] px-1.5 text-[11px] font-bold leading-none text-white"
            aria-label={`${chatUnread} unread chat messages`}
          >
            {chatUnread > 99 ? '99+' : chatUnread}
          </span>
        ) : undefined
      }
    />
  )

  return (
    <aside
      className={`fixed inset-y-0 left-0 z-50 flex h-app-screen w-60 shrink-0 flex-col overflow-hidden border-r border-gray-200/80 bg-white/80 shadow-lg backdrop-blur-lg transition-[transform,width] duration-300 ease-in-out dark:border-border/80 dark:bg-surface/90 lg:static lg:z-auto lg:h-full lg:translate-x-0 [&>*]:w-60 [&>*]:min-w-60 [&>*]:shrink-0 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      } ${collapsed ? 'lg:w-0 lg:border-r-0 lg:shadow-none' : 'lg:w-60'}`}
    >
      <div className="flex h-20 shrink-0 items-center px-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <AppLogo alt="MSW Overwatch" className="h-11 w-11 shrink-0" />
          <h2 className="min-w-0 truncate text-lg font-bold tracking-tight text-[#404040] dark:text-slate-100">
            {APP_NAME}
          </h2>
        </div>
        {/* Close button — mobile drawer only. */}
        <button
          type="button"
          onClick={onNavigate}
          aria-label="Close menu"
          className="ml-2 shrink-0 rounded-lg p-2 text-gray-600 hover:bg-gray-100 dark:text-content-secondary dark:hover:bg-surface-hover lg:hidden"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <nav
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3"
        onMouseLeave={() => setHoveredNav(null)}
        onClick={handleNavClick}
      >
        {isWarehouseOnly ? (
          <>
            {navExtrasExpanded && (
              <>
                <div className="shrink-0 space-y-0.5">
                  {isLabelCenterAvailable(accountEmail) && (
                    <ToolLink to="/label-center" label="Label Center" icon={Icons.labelCenter} id="label-center" />
                  )}

                  <ToolLink to="/label-station" label="Label Station" icon={Icons.barcode} id="label-station" />
                  <ToolLink to="/label-station-2" label="Label Station II" icon={Icons.barcode} id="label-station-2" />

                  {canUseFnskuLabels && (
                    <ToolLink to="/fnsku-labels" label="FNSKU Labels" icon={Icons.fnskuLabels} id="fnsku-labels" />
                  )}

                  <ToolLink
                    to="/fnsku-pack-station"
                    label="FNSKU Pack Station"
                    icon={Icons.fnskuBoxPivot}
                    id="fnsku-pack-station"
                  />

                  {canUseFbaOrderChecker && (
                    <ToolLink
                      to="/fba-shipment-library"
                      label="FBA Order Checker"
                      icon={Icons.fbaShipmentLibrary}
                      id="fba-shipment-library"
                    />
                  )}

                  {canUseFreightClass && (
                    <ToolLink
                      to="/freight-class-calculator"
                      label="Freight Class"
                      icon={Icons.freightClassCalculator}
                      id="freight-class-calculator"
                    />
                  )}

                  {canUseLabelFormatChecker && (
                    <ToolLink
                      to="/label-format-checker"
                      label="SPD Label Format Checker"
                      icon={Icons.labelFormatChecker}
                      id="label-format-checker"
                    />
                  )}

                  {canUseLtlLabelFormatChecker && (
                    <ToolLink
                      to="/ltl-label-format-checker"
                      label="LTL Label Format Checker"
                      icon={Icons.ltlLabelFormatChecker}
                      id="ltl-label-format-checker"
                    />
                  )}

                  {canUseDimensioner && (
                    <ToolLink to="/dimensioner" label="Dimensioner" icon={Icons.dimensioner} id="dimensioner" />
                  )}

                  {canUseShipmentManager && (
                    <ToolLink
                      to="/shipment-manager"
                      label="Shipment Manager"
                      icon={Icons.shipmentManager}
                      id="shipment-manager"
                    />
                  )}
                </div>

                <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />
              </>
            )}

            <div className="shrink-0 space-y-0.5 pb-1 pt-1">
              <p className="sidebar-section-label">MY SPACE</p>
              <ToolLink to="/my-space" label="My Space" icon={Icons.mySpace} id="my-space" bookmarkable={false} />
            </div>

            <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

            {myToolboxSection}

            <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

            {navExtrasToggle}

            {navExtrasExpanded && (
              <div id="sidebar-nav-extras">
                <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

                <div className="shrink-0 space-y-0.5 pb-1 pt-1">
                  <p className="sidebar-section-label">GENERAL</p>
                  <ToolLink to="/about" label="About" icon={Icons.info} id="about" />
                  <ToolLink to="/faq" label="FAQ" icon={Icons.wrench} id="faq" />
                  {canUseTeamChat && teamChatLink}
                  <ToolLink to="/feedback" label="Feedback From Users" icon={Icons.feedback} id="feedback" />
                </div>
              </div>
            )}
          </>
        ) : (
          <>
        {/* MY SPACE */}
        <div className="shrink-0 space-y-0.5 pb-1">
          <p className="sidebar-section-label">MY SPACE</p>
          <ToolLink to="/my-space" label="My Space" icon={Icons.mySpace} id="my-space" bookmarkable={false} />
        </div>

        <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

        {myToolboxSection}

        <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

        {navExtrasToggle}

        {navExtrasExpanded && (
        <div id="sidebar-nav-extras">
        <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

        {/* MENU: Dashboard + Keepa */}
        <div className="shrink-0">
          <p className="sidebar-section-label">MENU</p>
          <div className="space-y-0.5">
            <ToolLink to="/dashboard" label="Dashboard" icon={Icons.dashboard} id="dashboard" />

            {hasKeepaAccess && keepaMenuItems.map((item) => {
              const linkId =
                item.path === '/jobs'         ? 'jobs'        :
                item.path === '/manage-upcs'  ? 'manage-upcs' :
                item.path === '/map'          ? 'map'         :
                item.path === '/seller-list'  ? 'seller-list' :
                item.path === '/email-list'   ? 'email-list'  :
                item.path === '/ship-to-addresses' ? 'ship-to-addresses' :
                item.path === '/daily-run'    ? 'daily-runs'  :
                item.path === '/analytics'    ? 'analytics'   :
                'keepa-other'

              return (
                <ToolLink
                  key={item.path}
                  to={item.path}
                  label={item.label}
                  icon={Icons[item.icon]}
                  id={linkId}
                />
              )
            })}

            {canUseOldSkus && (
              <ToolLink to="/catalog/old-skus" label="Old SKUs" icon={Icons.oldSkus} id="old-skus" />
            )}
          </div>
        </div>

        <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

        {/* WAREHOUSE TOOLS */}
        <div className="shrink-0 space-y-0.5 pb-1 pt-1">
          <p className="sidebar-section-label">WAREHOUSE TOOLS</p>
          <ToolLink to="/micro-tools" label="Micro Tools" icon={Icons.toolbox} id="micro-tools" />
          <ToolLink
            to="/tracking-scanner"
            label="Tracking Extractor"
            icon={Icons.trackingExtractor}
            id="tracking-scanner"
          />
          <ToolLink to="/fnsku-labels" label="FNSKU Labels" icon={Icons.fnskuLabels} id="fnsku-labels" />
          <ToolLink
            to="/fnsku-pack-station"
            label="FNSKU Pack Station"
            icon={Icons.fnskuBoxPivot}
            id="fnsku-pack-station"
          />
          <ToolLink
            to="/manifest-generator"
            label="Manifest Generator"
            icon={Icons.manifestGenerator}
            id="manifest-generator"
          />
          <ToolLink
            to="/dnk-all-inventory"
            label="DNK AllInventory"
            icon={Icons.dnkAllInventory}
            id="dnk-all-inventory"
          />

          {hasKeepaAccess && isLabelCenterAvailable(accountEmail) && (
            <ToolLink to="/label-center" label="Label Center" icon={Icons.labelCenter} id="label-center" />
          )}

          {hasKeepaAccess && (
            <ToolLink to="/label-station" label="Label Station" icon={Icons.scanner} id="label-station" />
          )}

          {hasKeepaAccess && (
            <ToolLink to="/label-station-2" label="Label Station II" icon={Icons.scanner} id="label-station-2" />
          )}

          {canUseFbaOrderChecker && (
            <ToolLink
              to="/fba-shipment-library"
              label="FBA Order Checker"
              icon={Icons.fbaShipmentLibrary}
              id="fba-shipment-library"
            />
          )}

          {canUseFreightClass && (
            <ToolLink
              to="/freight-class-calculator"
              label="Freight Class"
              icon={Icons.freightClassCalculator}
              id="freight-class-calculator"
            />
          )}

          {canUseLabelFormatChecker && (
            <ToolLink
              to="/label-format-checker"
              label="SPD Label Format Checker"
              icon={Icons.labelFormatChecker}
              id="label-format-checker"
            />
          )}

          {canUseLtlLabelFormatChecker && (
            <ToolLink
              to="/ltl-label-format-checker"
              label="LTL Label Format Checker"
              icon={Icons.ltlLabelFormatChecker}
              id="ltl-label-format-checker"
            />
          )}

          {canUseDimensioner && (
            <ToolLink to="/dimensioner" label="Dimensioner" icon={Icons.dimensioner} id="dimensioner" />
          )}
        </div>

        {(canUseBcTools || canUseShipmentManager || canUseNsTool) && (
          <>
            <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

            {/* BC TOOLS */}
            <div className="shrink-0 space-y-0.5 pb-1 pt-1">
              <p className="sidebar-section-label">BC TOOLS</p>
              {canUseBcTools && canUseFbaBoxContents && (
                <ToolLink
                  to="/fba-box-contents"
                  label="FBA Box Contents"
                  icon={Icons.fbaBoxContents}
                  id="fba-box-contents"
                />
              )}
              {canUseBcTools && (
                <ToolLink
                  to="/product-catalog-formatter"
                  label="Product Catalog Formatter"
                  icon={Icons.productCatalog}
                  id="product-catalog-formatter"
                />
              )}
              {canUseBcTools && isSuperadmin && (
                <ToolLink
                  to="/obz-smw-fba-inv"
                  label="OBZ / SMW FBA INV"
                  icon={Icons.obzSmwFbaInv}
                  id="obz-smw-fba-inv"
                />
              )}
              {canUseNsTool && (
                <ToolLink to="/ns-tool" label="NS Tool" icon={Icons.nsTool} id="ns-tool" />
              )}
              {canUseShipmentManager && (
                <ToolLink
                  to="/shipment-manager"
                  label="Shipment Manager"
                  icon={Icons.shipmentManager}
                  id="shipment-manager"
                />
              )}
            </div>
          </>
        )}

        <div className="my-3 border-t border-gray-300/80" role="separator" aria-hidden="true" />

        {/* GENERAL */}
        <div className="shrink-0 space-y-0.5 pb-1 pt-1">
          <p className="sidebar-section-label">GENERAL</p>
          <ToolLink to="/about" label="About" icon={Icons.info} id="about" />
          <ToolLink to="/faq" label="FAQ" icon={Icons.wrench} id="faq" />
          {canUseTeamChat && teamChatLink}
          <ToolLink to="/feedback" label="Feedback From Users" icon={Icons.feedback} id="feedback" />

          {isSuperadmin && (
            <ToolLink
              to="/admin/users"
              label="User Management"
              icon={Icons.users}
              id="admin-users"
            />
          )}
          {canViewSessionAudit && (
            <ToolLink
              to="/admin/live-sessions"
              label="Live App Sessions"
              icon={Icons.liveSessions}
              id="admin-live-sessions"
            />
          )}
          {canViewSessionAudit && (
            <ToolLink
              to="/admin/audit-log"
              label="Audit Log"
              icon={Icons.audit}
              id="admin-audit"
            />
          )}
        </div>
        </div>
        )}
          </>
        )}
      </nav>
      {isElectron && (
        <div className="mx-4 mb-4 mt-3 shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-border dark:bg-surface-muted">
          <p className="text-xs font-semibold text-gray-700 dark:text-content-secondary">Desktop</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-content-muted">
            Version: <span className="font-mono text-[11px]">{desktopVersion ?? 'loading...'}</span>
          </p>
          <button
            type="button"
            onClick={handleCheckUpdates}
            disabled={isCheckingUpdates}
            className="mt-2 w-full rounded-md bg-[#F97316] px-2 py-1.5 text-xs font-medium text-white hover:bg-[#EA580C] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCheckingUpdates ? 'Checking...' : 'Check for Updates'}
          </button>
          {updateMessage && <p className="mt-2 text-[11px] text-gray-600 dark:text-content-muted">{updateMessage}</p>}
        </div>
      )}
    </aside>
  )
}
