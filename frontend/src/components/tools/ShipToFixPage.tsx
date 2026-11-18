import { Link } from 'react-router-dom'
import ShipToFixPanel from './ShipToFixPanel'

export default function ShipToFixPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <Link to="/shipment-manager" className="text-sm font-medium text-[#404040] hover:underline">
          ← Back to shipments
        </Link>
      </div>

      <ShipToFixPanel />
    </div>
  )
}
