import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { MUWEAVE_CORE_CSS } from '../packages/dsh-muweave-core/src/client/styles'
import * as coreClient from '../packages/dsh-muweave-core/src/client/index'
import { usePrefersReducedMotion } from '../packages/dsh-muweave-core/src/client/motion'
import { QUEUE_STAGGER_LIMIT, queueStagger } from '../packages/dsh-muweave-workbench/src/stage-workbench'

// docs/design/motion-spec.md: four feedback motions built only from the existing tokens and keyframes.

/** All declaration blocks of rules whose selector list is exactly `selector` (at-rule copies included), joined. */
function rulesFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const blocks = [...MUWEAVE_CORE_CSS.matchAll(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  expect(blocks.length, selector).toBeGreaterThan(0)
  return blocks.map((m) => m[1]).join('\n')
}

/** Every `@media (prefers-reduced-motion: reduce) { ... }` body, matching braces. */
function reducedMotionBlocks(): string[] {
  const out: string[] = []
  const head = '@media (prefers-reduced-motion: reduce)'
  for (let at = MUWEAVE_CORE_CSS.indexOf(head); at >= 0; at = MUWEAVE_CORE_CSS.indexOf(head, at + 1)) {
    const open = MUWEAVE_CORE_CSS.indexOf('{', at)
    let depth = 0
    for (let i = open; i < MUWEAVE_CORE_CSS.length; i++) {
      if (MUWEAVE_CORE_CSS[i] === '{') depth++
      else if (MUWEAVE_CORE_CSS[i] === '}' && --depth === 0) {
        out.push(MUWEAVE_CORE_CSS.slice(open + 1, i))
        break
      }
    }
  }
  return out
}

describe('motion spec M4: L3 stagger cap', () => {
  it('staggers only the first six rows; the seventh row on has no delay', () => {
    expect(QUEUE_STAGGER_LIMIT).toBe(6)
    const steps = Array.from({ length: 7 }, (_, i) => queueStagger(i))
    expect(steps).toEqual([0, 1, 2, 3, 4, 5, 0])
    expect(queueStagger(6)).toBe(0)
    expect(queueStagger(40)).toBe(0)
    expect(queueStagger(-1)).toBe(0)
  })

  it('turns the step into a 40ms delay on a 200ms mw-rise, so the last staggered row starts within 200ms', () => {
    const rule = rulesFor('.mw-stage-queue > li')
    expect(rule).toMatch(/animation:\s*mw-rise var\(--mw-dur-base\) var\(--mw-ease-out\) both;/)
    expect(rule).toMatch(/animation-delay:\s*calc\(var\(--mw-stagger, 0\) \* 40ms\);/)
    expect((QUEUE_STAGGER_LIMIT - 1) * 40).toBeLessThanOrEqual(200)
  })
})

describe('motion spec M1-M3: values', () => {
  it('M1 fades the stage work surface in over 180ms with ease-out', () => {
    expect(rulesFor('.mw-stage-work')).toMatch(/animation:\s*mw-fade-in 180ms var\(--mw-ease-out\) both;/)
  })

  it('M2 scales a hovered variant to 1.02 and darkens its hairline, with no shadow lift', () => {
    expect(rulesFor('.mw-stage-variant')).toMatch(/transition:\s*transform var\(--mw-dur-fast\) var\(--mw-ease-out\);/)
    expect(rulesFor('.mw-stage-variant-cell:hover .mw-stage-variant')).toMatch(/transform:\s*scale\(1\.02\);/)
    const line = rulesFor('.mw-stage-variant-cell:hover .mw-stage-variant:not([data-current="true"]) .mw-stage-thumb')
    expect(line).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--mw-line-strong\);/)
  })

  it('M3 slides the compare pane in from the right over 200ms and has no exit motion', () => {
    expect(rulesFor('.mw-compare')).toMatch(/transition:\s*opacity var\(--mw-dur-base\) var\(--mw-ease\), transform var\(--mw-dur-base\) var\(--mw-ease\);/)
    expect(MUWEAVE_CORE_CSS).toMatch(/@starting-style\s*\{\s*\.mw-compare\s*\{\s*opacity:\s*0;\s*transform:\s*translateX\(0\.5rem\);/)
  })

  // The whitelist is exact on purpose: any animation must be a deliberate addition. `mw-compare-in`
  // was added for the compare pane because the existing keyframes all move on the Y axis, and the
  // pane needs a horizontal entrance (see motion-spec.md M3).
  it('adds no keyframes and no duration literal beyond the two the spec names', () => {
    expect([...MUWEAVE_CORE_CSS.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1])).toEqual([
      'mw-drift',
      'mw-fade-in',
      'mw-compare-in',
      'mw-rise',
      'mw-pulse',
      'mw-pop',
      'mw-spring-in',
      'mw-sched-drawer-in',
    ])
    const motion = MUWEAVE_CORE_CSS.slice(MUWEAVE_CORE_CSS.indexOf('/* ---------- Motion (desk v8'))
    expect([...new Set(motion.match(/\b\d+m?s\b/g))].sort()).toEqual(['180ms', '40ms'])
  })
})

describe('motion spec: reduced motion', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('stops every animation and transition in the workspace through the one global rule', () => {
    const global = reducedMotionBlocks().find((body) => body.includes('.mw-dsh-root *'))
    expect(global).toBeDefined()
    expect(global).toMatch(/animation:\s*none !important;/)
    expect(global).toMatch(/transition:\s*none !important;/)
  })

  it('also drops the static hover scale, which the global rule does not touch', () => {
    expect(reducedMotionBlocks().some((body) => /\.mw-stage-variant-cell:hover \.mw-stage-variant\s*\{\s*transform:\s*none;/.test(body))).toBe(true)
  })

  it('reports the user preference through usePrefersReducedMotion', () => {
    let listener: (() => void) | undefined
    const media = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => {
        listener = fn
      },
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('matchMedia', vi.fn(() => media))
    const { result } = renderHook(() => usePrefersReducedMotion())
    expect(result.current).toBe(true)
    media.matches = false
    act(() => listener?.())
    expect(result.current).toBe(false)
  })
})

describe('motion hooks', () => {
  it('keeps only the delegated tilt and the reduced-motion probe', () => {
    expect(typeof coreClient.useTiltDelegation).toBe('function')
    expect(typeof coreClient.usePrefersReducedMotion).toBe('function')
    expect('useTilt' in coreClient).toBe(false)
    expect('useParallax' in coreClient).toBe(false)
  })
})
