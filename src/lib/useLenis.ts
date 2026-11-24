import { useEffect } from 'react'
import Lenis from 'lenis'
import { gsap } from 'gsap'

/** Global smooth scroll, driven by GSAP's ticker. */
export function useLenis() {
  useEffect(() => {
    const lenis = new Lenis({
      lerp: 0.07, // lower = smoother / more glide
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.6,
    })
    const update = (time: number) => lenis.raf(time * 1000)
    gsap.ticker.add(update)
    gsap.ticker.lagSmoothing(0)
    return () => {
      gsap.ticker.remove(update)
      lenis.destroy()
    }
  }, [])
}
