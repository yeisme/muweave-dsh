import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MUWEAVE_CORE_CSS } from '../packages/dsh-muweave-core/src/client/styles'

// Static guard for docs/design/visual-polish-v1.md and editorial-v2.md: tokens only, rem only, no orange,
// monochrome actions (no dusk violet), glass only behind @supports, no ad-hoc inline styles.

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES = [
  'dsh-muweave-core',
  'dsh-muweave-workbench',
  'dsh-muweave-eikona',
  'dsh-muweave-script',
  'dsh-muweave-drama',
  'dsh-muweave-kit',
  'dsh-muweave-schedule',
  'dsh-muweave-canvas',
  'dsh-muweave-stage3d',
  'dsh-muweave-audio',
  'dsh-muweave-assets',
]

function listTsx(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listTsx(full)
    return entry.name.endsWith('.tsx') ? [full] : []
  })
}

const sources = PACKAGES.flatMap((pkg) => listTsx(path.join(rootDir, 'packages', pkg, 'src'))).map((file) => ({
  file: path.relative(rootDir, file),
  text: readFileSync(file, 'utf8'),
}))

// Strip the token block's host-alias fallbacks: `var(--dsw-alias-*, #hex)` is the only allowed literal colour.
const cssWithoutFallbacks = MUWEAVE_CORE_CSS.replace(/var\(--dsw-alias-[a-z0-9-]+,\s*#[0-9a-fA-F]{3,8}\)/g, 'var(--x)')

/** Removes every `@supports (backdrop-filter…) { … }` block, matching braces. */
function withoutBackdropSupports(css: string): string {
  let out = ''
  let i = 0
  const opener = /@supports\s*\(\s*backdrop-filter[^{]*\{/g
  for (let m = opener.exec(css); m; m = opener.exec(css)) {
    out += css.slice(i, m.index)
    let depth = 1
    let j = m.index + m[0].length
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1
      else if (css[j] === '}') depth -= 1
      j += 1
    }
    i = j
    opener.lastIndex = j
  }
  return out + css.slice(i)
}

const oklchColours = [...MUWEAVE_CORE_CSS.matchAll(/oklch\(\s*[\d.]+\s+([\d.]+)\s+([\d.]+)/g)].map((m) => ({
  chroma: Number(m[1]),
  hue: Number(m[2]),
}))

describe('visual static guard (polish v1 + editorial v2)', () => {
  it('keeps the CSS template literal free of stray backticks', () => {
    // The stylesheet is a ``...`` template: a backtick inside a CSS comment silently ends it and breaks the bundle.
    expect(MUWEAVE_CORE_CSS.includes('`')).toBe(false)
  })

  it('allows inline style only for dynamic custom properties, grid columns, overlay coordinates and motion hooks', () => {
    const offenders: string[] = []
    for (const { file, text } of sources) {
      // `const parallax = useParallax(...)` produces a MotionStyle (only `--mw-*` custom properties),
      // so a bare identifier bound to one of the motion hooks is allowed as a style value.
      const motionBindings = new Set<string>()
      for (const m of text.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*use(?:Parallax|Tilt)\b/g)) {
        if (m[1]) motionBindings.add(m[1])
      }
      const re = /style=\{([^}]*\}?)/g
      for (const m of text.matchAll(re)) {
        const body = (m[1] ?? '').replace(/\s+/g, ' ').trim()
        // The capture keeps the closing brace of `style={…}`, so trim it before matching a bare name.
        const bare = body.replace(/\}$/, '').trim().match(/^([A-Za-z_$][\w$]*)(?:\s+as\s+CSSProperties)?$/)
        const allowed =
          /^\{ ?'--(mw|dr)-[a-z-]+':/.test(body) ||
          /^\{\s*gridTemplateColumns\b/.test(body) ||
          /^position\b/.test(body) ||
          (bare !== null && motionBindings.has(bare[1]!)) ||
          /^\s*$/.test(body)
        if (!allowed) offenders.push(`${file}: style={${body.slice(0, 60)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('has no literal colours outside the token fallbacks, in CSS or TSX', () => {
    const literal = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/
    // One documented exception: the system-blue accent pair is a fixed brand value, not a theme
    // colour, so it is written literally instead of chaining to a host alias.
    const cssWithoutAccentLiterals = cssWithoutFallbacks.replace(/^\s*--mw-(?:accent|on-accent)[^;]*;$/gm, '')
    expect(cssWithoutAccentLiterals).not.toMatch(literal)
    const offenders = sources.filter(({ text }) => /(?:color|background|border)[^\n]*(?:#[0-9a-fA-F]{3,8}\b|rgba?\()/.test(text))
    expect(offenders.map((s) => s.file)).toEqual([])
  })

  it('uses rem lengths; px only for 1px/2px hairlines', () => {
    const px = [...MUWEAVE_CORE_CSS.matchAll(/(?<![\w.-])(\d*\.?\d+)px\b/g)].map((m) => Number(m[1]))
    expect(px.filter((v) => v > 2)).toEqual([])
  })

  it('never uses orange hues (oklch hue 30–80)', () => {
    const hues = [...MUWEAVE_CORE_CSS.matchAll(/oklch\(\s*[\d.]+\s+([\d.]+)\s+([\d.]+)/g)]
      .filter((m) => Number(m[1]) > 0.02)
      .map((m) => Number(m[2]))
    expect(hues.length).toBeGreaterThan(0)
    expect(hues.filter((h) => h >= 30 && h <= 80)).toEqual([])
    expect(MUWEAVE_CORE_CSS).not.toMatch(/\borange\b/i)
  })

  it('uses the system blue as the single accent and never the old violet', () => {
    // No saturated dusk violet anywhere.
    expect(oklchColours.filter((c) => c.hue >= 290 && c.hue <= 320 && c.chroma > 0.08)).toEqual([])
    // macOS 26 decision: the accent is system blue, written literally — chaining it to the host's
    // button-primary-fill (ink) silently turned every CTA black.
    expect(MUWEAVE_CORE_CSS).toMatch(/--mw-accent:\s*#0A84FF/i)
    expect(MUWEAVE_CORE_CSS).not.toMatch(/--mw-accent:\s*var\(--dsw-alias-button-primary-fill/)
  })

  it('keeps ambient blobs faint (chroma ≤ 0.06)', () => {
    const blobs = [...MUWEAVE_CORE_CSS.matchAll(/--mw-blob-\d:\s*oklch\(\s*[\d.]+\s+([\d.]+)/g)].map((m) => Number(m[1]))
    expect(blobs.length).toBe(3)
    expect(blobs.filter((c) => c > 0.06)).toEqual([])
  })

  it('only blurs behind @supports, so every glass surface has an opaque fallback', () => {
    expect(MUWEAVE_CORE_CSS).toMatch(/backdrop-filter/)
    expect(withoutBackdropSupports(MUWEAVE_CORE_CSS)).not.toMatch(/backdrop-filter/)
  })

  it('declares every --mw-* token it reads', () => {
    const declared = new Set([...MUWEAVE_CORE_CSS.matchAll(/(--mw-[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
    const read = new Set([...MUWEAVE_CORE_CSS.matchAll(/var\((--mw-[a-z0-9-]+)/g)].map((m) => m[1]))
    const tsxSet = new Set(sources.flatMap(({ text }) => [...text.matchAll(/'(--mw-[a-z0-9-]+)'/g)].map((m) => m[1])))
    const missing = [...read].filter((name) => !declared.has(name) && !tsxSet.has(name))
    expect(missing).toEqual([])
  })

  it('keeps a visible focus ring and honours reduced motion', () => {
    expect(MUWEAVE_CORE_CSS).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--mw-accent\)/)
    expect(MUWEAVE_CORE_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })

  it('keeps selection neutral (no accent on selected state)', () => {
    const selectedRules = [...MUWEAVE_CORE_CSS.matchAll(/([^{}]*(?:data-selected|aria-selected|aria-pressed="true")[^{}]*)\{([^}]*)\}/g)]
    expect(selectedRules.length).toBeGreaterThan(0)
    const tinted = selectedRules.filter((m) => /--mw-accent/.test(m[2] ?? '') && !/\.mw-dsh-btn\[data-variant="primary"\]/.test(m[1] ?? ''))
    expect(tinted.map((m) => m[1]?.trim())).toEqual([])
  })
})
