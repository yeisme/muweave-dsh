import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

export type MotionStyle = Record<`--mw-${string}`, string>

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

export interface TiltOptions {
  disabled?: boolean
}

function motionStyle(values: Record<`--mw-${string}`, string>): MotionStyle {
  return values as MotionStyle
}

/** Normalizes pointer position inside an element to the two tilt custom properties. */
export function useTilt<T extends HTMLElement>(options: TiltOptions = {}): { ref: RefObject<T>; style: MotionStyle } {
  const ref = useRef<T>(null)
  const reducedMotion = usePrefersReducedMotion()
  const [tilt, setTilt] = useState({ x: '0', y: '0' })
  const disabled = options.disabled === true || reducedMotion

  useEffect(() => {
    const element = ref.current
    if (disabled) {
      setTilt({ x: '0', y: '0' })
      return
    }
    if (!element) return

    const update = (event: PointerEvent) => {
      const bounds = element.getBoundingClientRect()
      if (bounds.width <= 0 || bounds.height <= 0) return
      const x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
      const y = ((event.clientY - bounds.top) / bounds.height) * 2 - 1
      setTilt({ x: String(Math.max(-1, Math.min(1, x))), y: String(Math.max(-1, Math.min(1, y))) })
    }
    const reset = () => setTilt({ x: '0', y: '0' })

    element.addEventListener('pointerenter', update)
    element.addEventListener('pointermove', update)
    element.addEventListener('pointerleave', reset)
    return () => {
      element.removeEventListener('pointerenter', update)
      element.removeEventListener('pointermove', update)
      element.removeEventListener('pointerleave', reset)
    }
  }, [disabled])

  return {
    ref,
    style: useMemo(() => motionStyle({ '--mw-tilt-x': tilt.x, '--mw-tilt-y': tilt.y }), [tilt.x, tilt.y]),
  }
}

/** Projects viewport pointer position into bounded parallax custom properties. */
export function useParallax(strength = 0.35): MotionStyle {
  const reducedMotion = usePrefersReducedMotion()
  const [parallax, setParallax] = useState({ x: '0', y: '0' })
  const amount = Number.isFinite(strength) ? strength : 0.35

  useEffect(() => {
    if (reducedMotion) {
      setParallax({ x: '0', y: '0' })
      return
    }
    if (typeof window === 'undefined') return
    const update = (event: PointerEvent) => {
      const width = window.innerWidth
      const height = window.innerHeight
      if (width <= 0 || height <= 0) return
      const x = Math.max(-1, Math.min(1, (event.clientX / width) * 2 - 1)) * amount
      const y = Math.max(-1, Math.min(1, (event.clientY / height) * 2 - 1)) * amount
      setParallax({ x: String(x), y: String(y) })
    }
    const reset = () => setParallax({ x: '0', y: '0' })

    window.addEventListener('pointermove', update)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('pointermove', update)
      window.removeEventListener('blur', reset)
    }
  }, [amount, reducedMotion])

  return useMemo(
    () => motionStyle({ '--mw-parallax-x': parallax.x, '--mw-parallax-y': parallax.y }),
    [parallax.x, parallax.y],
  )
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
