import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { hasFlightPack } from '../lib/tile-idb'
import { useFlightStore } from '../stores/flight'
import { cn } from '../lib/cn'

type Props = {
  flightNumber: string
  travelDate: string
  className?: string
}

/**
 * Spotify-style: green dot when this flight’s map pack is in IndexedDB;
 * spinning loader when a tile download is in progress for this flight.
 */
export function MapPackStatusIndicator({
  flightNumber,
  travelDate,
  className,
}: Props) {
  const [downloaded, setDownloaded] = useState(false)
  const storeFn = useFlightStore((s) => s.flightNumber)
  const storeDate = useFlightStore((s) => s.travelDate)
  const tileProgress = useFlightStore((s) => s.tileProgress)
  const fnU = flightNumber.toUpperCase()
  const downloading = Boolean(
    tileProgress && fnU === storeFn.toUpperCase() && travelDate === storeDate,
  )

  useEffect(() => {
    let cancelled = false
    void hasFlightPack(flightNumber, travelDate).then((ok) => {
      if (!cancelled) setDownloaded(ok)
    })
    return () => {
      cancelled = true
    }
  }, [flightNumber, travelDate, tileProgress])

  return (
    <span
      className={cn(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center',
        className,
      )}
      title={
        downloading
          ? 'Downloading map tiles…'
          : downloaded
            ? 'Map available offline'
            : undefined
      }
    >
      {downloading ? (
        <Loader2
          className="text-cyan-600 size-3.5 animate-spin dark:text-cyan-400"
          strokeWidth={2.5}
          aria-hidden
        />
      ) : downloaded ? (
        <span
          className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.4)]"
          aria-hidden
        />
      ) : null}
    </span>
  )
}
