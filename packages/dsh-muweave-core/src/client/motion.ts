import { useEffect, useState, type RefObject } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** Tracks the user's motion preference without touching window during SSR. */
export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(REDUCED_MOTION_QUERY).matches
      : false,
  )

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const media = window.matchMedia(REDUCED_MOTION_QUERY)
    const update = () => setReducedMotion(media.matches)
    update()
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', update)
      return () => media.removeEventListener('change', update)
    }
    media.addListener(update)
    return () => media.removeListener(update)
  }, [])

  return reducedMotion
}

/**
 * Delegated tilt: one pointer listener for a whole workspace instead of a prop on every card.
 * Any element matching `selector` under `root` gets `--mw-tilt-x/y` written as the pointer moves,
 * so rooms do not have to thread a `tilt` prop through every card they render.
 */
export function useTiltDelegation(
  root: RefObject<HTMLElement>,
  options: { selector?: string; maxDegrees?: number } = {},
): void {
  const reducedMotion = usePrefersReducedMotion()
  const selector = options.selector ?? '[data-interactive="true"]'

  useEffect(() => {
    const host = root.current
    if (!host || reducedMotion) return

    const active = new WeakMap<HTMLElement, true>()

    const clear = (el: HTMLElement) => {
      if (!active.has(el)) return
      active.delete(el)
      el.style.setProperty('--mw-tilt-x', '0')
      el.style.setProperty('--mw-tilt-y', '0')
      el.style.removeProperty('transform')
    }

    const onMove = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLElement>(selector) : null
      const previous = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-mw-tilting="true"]') : null
      if (previous && previous !== target) {
        previous.removeAttribute('data-mw-tilting')
        clear(previous)
      }
      if (!target || !host.contains(target)) return
      const rect = target.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      const nx = Math.max(-1, Math.min(1, ((event.clientX - rect.left) / rect.width) * 2 - 1))
      const ny = Math.max(-1, Math.min(1, ((event.clientY - rect.top) / rect.height) * 2 - 1))
      // Inline transform beats any cascade and survives the room's transitions.
      target.style.setProperty('--mw-tilt-x', String(nx))
      target.style.setProperty('--mw-tilt-y', String(ny))
      target.style.transform = `perspective(60rem) rotateX(${(ny * -3).toFixed(2)}deg) rotateY(${(nx * 3).toFixed(2)}deg)`
      target.setAttribute('data-mw-tilting', 'true')
      active.set(target, true)
    }

    const onLeave = () => {
      for (const el of host.querySelectorAll<HTMLElement>('[data-mw-tilting="true"]')) {
        el.removeAttribute('data-mw-tilting')
        clear(el)
      }
    }

    host.addEventListener('pointermove', onMove)
    host.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
      onLeave()
    }
  }, [root, reducedMotion, selector])
}
