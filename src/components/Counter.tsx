import { useEffect, useRef } from 'react'
import { useInView, animate } from 'framer-motion'

export function Counter({
  to,
  compact,
  className,
}: {
  to: number
  compact?: boolean
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-15%' })
  const fired = useRef(false)

  useEffect(() => {
    if (!inView || fired.current || !ref.current) return
    fired.current = true
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const node = ref.current
    const render = (v: number) => {
      if (compact) {
        node.textContent = v >= 1e6 ? (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : Math.round(v).toLocaleString()
      } else {
        node.textContent = Math.round(v).toLocaleString()
      }
    }
    if (reduce) { render(to); return }
    const controls = animate(0, to, {
      duration: 1.6,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: render,
    })
    return () => controls.stop()
  }, [inView, to, compact])

  return <span ref={ref} className={className}>0</span>
}
