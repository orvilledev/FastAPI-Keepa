import VendorSchedulerCountdown from './VendorSchedulerCountdown'

/** Legacy DNK countdown without vendor prefix in the title (historical Dashboard use). */
export default function SchedulerCountdown() {
  return (
    <VendorSchedulerCountdown vendor="dnk" title="Keepa Off Price Daily Run" />
  )
}
