import { useEffect, useState } from 'react'

export type Stats = {
  as_of_utc: string
  block: number
  operators: number
  max_operators: number
  validators: number
  earning: number
  total_stake_alpha: number
  netuid: number
  tempo: number
}

const FALLBACK: Stats = {
  as_of_utc: '2026-11-22T12:00:00Z',
  block: 9562834,
  operators: 1024,
  max_operators: 1024,
  validators: 1,
  earning: 767,
  total_stake_alpha: 5096987,
  netuid: 24,
  tempo: 360,
}

/** Loads the real SN24 snapshot, falling back to a baked copy. */
export function useStats(): Stats {
  const [stats, setStats] = useState<Stats>(FALLBACK)
  useEffect(() => {
    fetch('/stats.json', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setStats({ ...FALLBACK, ...d }))
      .catch(() => {})
  }, [])
  return stats
}

export function fmtCompact(n: number): string {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M'
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K'
  return Math.round(n).toLocaleString()
}
