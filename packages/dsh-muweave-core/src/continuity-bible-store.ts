import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import type {
  ContinuityBibleSetInputV1,
  ContinuityBibleV1,
  ContinuityCharacterAnchorV1,
  ContinuityColorSwatchV1,
  ContinuityVisualGrammarV1,
} from './protocol'

/**
 * Continuity Bible & AI Compliance Disclosure store (`pluginDataDir/continuity-bible.v1.json`).
 * Stores per-workspace visual grammar, color palette, character anchors, negative guardrails,
 * and compliance disclosure metadata with optimistic locking and zero secrets/host paths.
 */

export const CONTINUITY_BIBLE_SCHEMA = 'muweave.continuity-bible.v1' as const
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/
const MAX_TEXT_LEN = 500
const MAX_TITLE_LEN = 120

export class ContinuityBibleInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
  }
}

function assertSafeText(value: unknown, field: string, maxLen = MAX_TEXT_LEN, required = false): string {
  if (value === undefined || value === null) {
    if (required) throw new ContinuityBibleInputError('muweave/invalid_bible_input', `${field} is required`)
    return ''
  }
  if (typeof value !== 'string') {
    throw new ContinuityBibleInputError('muweave/invalid_bible_input', `${field} must be a string`)
  }
  const trimmed = value.trim()
  if (required && !trimmed) {
    throw new ContinuityBibleInputError('muweave/invalid_bible_input', `${field} must be non-empty`)
  }
  if (trimmed.length > maxLen) {
    throw new ContinuityBibleInputError('muweave/invalid_bible_input', `${field} exceeds max length ${maxLen}`)
  }
  if (findPlaintextCredential(trimmed) || containsHostPath(trimmed)) {
    throw new ContinuityBibleInputError(
      'muweave/invalid_bible_input',
      `${field} must not contain plaintext credentials or host paths`,
    )
  }
  return trimmed
}

function defaultVisualGrammar(): ContinuityVisualGrammarV1 {
  return {
    aspectRatio: '9:16',
    lensStyle: '35mm / 50mm cinematic close-up bias',
    lightingRule: 'High-contrast key light with consistent rim separation',
    styleDirective: 'Vertical drama consistent character & scene continuity',
  }
}

export function createDefaultContinuityBible(workspaceId: string): ContinuityBibleV1 {
  return {
    schema: CONTINUITY_BIBLE_SCHEMA,
    workspaceId,
    visualGrammar: defaultVisualGrammar(),
    colorPalette: [],
    characterAnchors: [],
    negativeGuardrails: [],
    complianceDisclosure: '',
    revision: '0',
    updatedAt: '',
  }
}

function validatePalette(raw: unknown): ContinuityColorSwatchV1[] {
  if (!Array.isArray(raw)) {
    throw new ContinuityBibleInputError('muweave/invalid_bible_input', 'colorPalette must be an array')
  }
  if (raw.length > 16) {
    throw new ContinuityBibleInputError('muweave/invalid_bible_input', 'colorPalette supports at most 16 swatches')
  }
  return raw.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new ContinuityBibleInputError('muweave/invalid_bible_input', `colorPalette[${idx}] must be an object`)
    }
    const r = item as Record<string, unknown>
    const name = assertSafeText(r.name, `colorPalette[${idx}].name`, 64, true)
    const hex = typeof r.hex === 'string' ? r.hex.trim() : ''
    if (!HEX_COLOR_RE.test(hex)) {
      throw new ContinuityBibleInputError(
        'muweave/invalid_bible_input',
        `colorPalette[${idx}].hex must match #RRGGBB`,
      )
    }
    return { name, hex }
  })
}

function validateAnchors(raw: unknown): ContinuityCharacterAnchorV1[] {
  if (!Array.isArray(raw)) {
    throw new ContinuityBibleInputError('muweave/invalid_bible_input', 'characterAnchors must be an array')
  }
  if (raw.length > 32) {
    throw new ContinuityBibleInputError('muweave/invalid_bible_input', 'characterAnchors supports at most 32 entries')
  }
  return raw.map((item, idx) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new ContinuityBibleInputError('muweave/invalid_bible_input', `characterAnchors[${idx}] must be an object`)
    }
    const r = item as Record<string, unknown>
    const name = assertSafeText(r.name, `characterAnchors[${idx}].name`, 80, true)
    const roleRef = assertSafeText(r.roleRef, `characterAnchors[${idx}].roleRef`, 128, false)
    const wardrobe = assertSafeText(r.wardrobe, `characterAnchors[${idx}].wardrobe`, MAX_TEXT_LEN, false)
    const immutableTraits = assertSafeText(r.immutableTraits, `characterAnchors[${idx}].immutableTraits`, MAX_TEXT_LEN, false)
    const negativeNotes = assertSafeText(r.negativeNotes, `characterAnchors[${idx}].negativeNotes`, MAX_TEXT_LEN, false)
    return {
      name,
      ...(roleRef ? { roleRef } : {}),
      wardrobe,
      immutableTraits,
      ...(negativeNotes ? { negativeNotes } : {}),
    }
  })
}

function validateGuardrails(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new ContinuityBibleInputError('muweave/invalid_bible_input', 'negativeGuardrails must be an array')
  }
  if (raw.length > 32) {
    throw new ContinuityBibleInputError('muweave/invalid_bible_input', 'negativeGuardrails supports at most 32 entries')
  }
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = 0; i < raw.length; i += 1) {
    const val = assertSafeText(raw[i], `negativeGuardrails[${i}]`, 160, false)
    if (val && !seen.has(val)) {
      seen.add(val)
      out.push(val)
    }
  }
  return out
}

function cloneBible(b: ContinuityBibleV1): ContinuityBibleV1 {
  return {
    ...b,
    visualGrammar: { ...b.visualGrammar },
    colorPalette: b.colorPalette.map((c) => ({ ...c })),
    characterAnchors: b.characterAnchors.map((a) => ({ ...a })),
    negativeGuardrails: [...b.negativeGuardrails],
  }
}

export class ContinuityBibleStore {
  private readonly file: string
  private bibles = new Map<string, ContinuityBibleV1>()
  corruptFile?: string

  constructor(pluginDataDir: string) {
    this.file = path.join(pluginDataDir, 'continuity-bible.v1.json')
    this.load()
  }

  get(workspaceId: string): ContinuityBibleV1 {
    const existing = this.bibles.get(workspaceId)
    return existing ? cloneBible(existing) : createDefaultContinuityBible(workspaceId)
  }

  set(workspaceId: string, input: ContinuityBibleSetInputV1): ContinuityBibleV1 {
    if (findPlaintextCredential(input) || containsHostPath(input)) {
      throw new ContinuityBibleInputError(
        'muweave/invalid_bible_input',
        'Continuity bible must not contain plaintext credentials or host paths',
      )
    }
    const wsId = assertSafeText(workspaceId, 'workspaceId', 128, true)
    const prev = this.bibles.get(wsId)
    const currentRevNum = prev ? Number(prev.revision) || 0 : 0
    const currentRevision = String(currentRevNum)

    if (input.expectedRevision !== undefined && input.expectedRevision !== '') {
      if (String(input.expectedRevision) !== currentRevision) {
        throw new ContinuityBibleInputError(
          'muweave/bible_revision_conflict',
          `Continuity bible revision conflict: expected ${input.expectedRevision}, current is ${currentRevision}`,
          { currentRevision },
        )
      }
    }

    const base = prev ?? createDefaultContinuityBible(wsId)
    const vgInput = input.visualGrammar ?? {}
    const visualGrammar: ContinuityVisualGrammarV1 = {
      aspectRatio: vgInput.aspectRatio !== undefined
        ? assertSafeText(vgInput.aspectRatio, 'visualGrammar.aspectRatio', 32, true)
        : base.visualGrammar.aspectRatio,
      lensStyle: vgInput.lensStyle !== undefined
        ? assertSafeText(vgInput.lensStyle, 'visualGrammar.lensStyle', 200, false)
        : base.visualGrammar.lensStyle,
      lightingRule: vgInput.lightingRule !== undefined
        ? assertSafeText(vgInput.lightingRule, 'visualGrammar.lightingRule', 240, false)
        : base.visualGrammar.lightingRule,
      styleDirective: vgInput.styleDirective !== undefined
        ? assertSafeText(vgInput.styleDirective, 'visualGrammar.styleDirective', MAX_TEXT_LEN, false)
        : base.visualGrammar.styleDirective,
    }

    const projectTitle = input.projectTitle !== undefined
      ? assertSafeText(input.projectTitle, 'projectTitle', MAX_TITLE_LEN, false)
      : base.projectTitle

    const colorPalette = input.colorPalette !== undefined
      ? validatePalette(input.colorPalette)
      : base.colorPalette.map((c) => ({ ...c }))

    const characterAnchors = input.characterAnchors !== undefined
      ? validateAnchors(input.characterAnchors)
      : base.characterAnchors.map((a) => ({ ...a }))

    const negativeGuardrails = input.negativeGuardrails !== undefined
      ? validateGuardrails(input.negativeGuardrails)
      : [...base.negativeGuardrails]

    const complianceDisclosure = input.complianceDisclosure !== undefined
      ? assertSafeText(input.complianceDisclosure, 'complianceDisclosure', 280, false)
      : base.complianceDisclosure

    const next: ContinuityBibleV1 = {
      schema: CONTINUITY_BIBLE_SCHEMA,
      workspaceId: wsId,
      ...(projectTitle ? { projectTitle } : {}),
      visualGrammar,
      colorPalette,
      characterAnchors,
      negativeGuardrails,
      complianceDisclosure,
      revision: String(currentRevNum + 1),
      updatedAt: new Date().toISOString(),
    }

    this.bibles.set(wsId, next)
    this.persist()
    return cloneBible(next)
  }

  private load(): void {
    if (!existsSync(this.file)) return
    try {
      const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as unknown
      const list = typeof parsed === 'object' && parsed !== null ? (parsed as { bibles?: unknown }).bibles : undefined
      if (!Array.isArray(list)) throw new Error('bibles is not an array')
      for (const raw of list) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue
        if (findPlaintextCredential(raw) || containsHostPath(raw)) continue
        const r = raw as Partial<ContinuityBibleV1>
        if (typeof r.workspaceId !== 'string' || !r.workspaceId.trim()) continue
        if (typeof r.revision !== 'string') continue
        try {
          const vg = (r.visualGrammar ?? {}) as Partial<ContinuityVisualGrammarV1>
          const normalized: ContinuityBibleV1 = {
            schema: CONTINUITY_BIBLE_SCHEMA,
            workspaceId: r.workspaceId.trim(),
            ...(typeof r.projectTitle === 'string' && r.projectTitle.trim() ? { projectTitle: r.projectTitle.trim() } : {}),
            visualGrammar: {
              aspectRatio: typeof vg.aspectRatio === 'string' && vg.aspectRatio.trim() ? vg.aspectRatio.trim() : '9:16',
              lensStyle: typeof vg.lensStyle === 'string' ? vg.lensStyle : '',
              lightingRule: typeof vg.lightingRule === 'string' ? vg.lightingRule : '',
              styleDirective: typeof vg.styleDirective === 'string' ? vg.styleDirective : '',
            },
            colorPalette: r.colorPalette ? validatePalette(r.colorPalette) : [],
            characterAnchors: r.characterAnchors ? validateAnchors(r.characterAnchors) : [],
            negativeGuardrails: r.negativeGuardrails ? validateGuardrails(r.negativeGuardrails) : [],
            complianceDisclosure: typeof r.complianceDisclosure === 'string' ? r.complianceDisclosure : '',
            revision: r.revision,
            updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt : new Date().toISOString(),
          }
          this.bibles.set(normalized.workspaceId, normalized)
        } catch {
          /* skip invalid entry */
        }
      }
    } catch {
      this.bibles.clear()
      const aside = path.join(path.dirname(this.file), `continuity-bible.v1.corrupt-${Date.now()}.json`)
      try {
        renameSync(this.file, aside)
        this.corruptFile = aside
      } catch {
        this.corruptFile = this.file
      }
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`
    writeFileSync(
      tmp,
      `${JSON.stringify({ schema: CONTINUITY_BIBLE_SCHEMA, bibles: [...this.bibles.values()] }, null, 2)}\n`,
      { mode: 0o600 },
    )
    renameSync(tmp, this.file)
  }
}
