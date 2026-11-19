import { createElement } from 'react'
import { BUILTIN_CREATOR_TEMPLATES } from '../host-safe-catalog'
import { getFloatingAgentSnapshot } from './floating-agent'
import { statusLabel } from './i18n'

export type TriggerPickOutcome =
  | { text: string; continue?: boolean }
  | { insert: { source: string; ref: string; label: string; clipboardText: string } }
  | 'handled'
  | undefined

export interface DshInputTriggerSourceLike {
  trigger: '@' | '/'
  name: string
  order?: number
  showGroupTitle?: boolean
  candidates(
    session: { sessionId: string },
    req: { query: string; signal: AbortSignal },
  ): Promise<Array<Record<string, unknown>>> | Array<Record<string, unknown>>
  onPick(args: { candidate: Record<string, unknown>; position?: string; span?: { start: number; end: number } }): TriggerPickOutcome
  openReference?(session: { sessionId: string }, refObj: { ref: string }): boolean
  codec?: {
    clipboardText(ref: string): string
    serialize(ref: string, signal?: AbortSignal): Promise<string>
  }
}

export interface ChineseSkillSearchEntry {
  skillName: string
  zhLabel: string
  zhKeywords: string
  description: string
}

export const CREATOR_CHINESE_SKILLS: readonly ChineseSkillSearchEntry[] = [
  {
    skillName: 'muweave-drama-router',
    zhLabel: '漫剧创作路由总控',
    zhKeywords: '漫剧 做剧 短剧 路由 立项 导演',
    description: '选择最窄做剧阶段技能与上下文包，连接 Eikona / Auctra / Scaena 契约',
  },
  {
    skillName: 'muweave-eikona-visual',
    zhLabel: '角色定妆与视觉母版生图',
    zhKeywords: '生图 角色 三视图 定妆 eikona 母版 画面',
    description: '遵循 Sunburst 像素规格生成或检视 Eikona 角色/场景候选并回写 .muweave/',
  },
  {
    skillName: 'muweave-script-scene',
    zhLabel: '剧本场次精修与钩子诊断',
    zhKeywords: '剧本 场次 对白 钩子 冲突 反转 auctra',
    description: '围绕目标、阻碍、代价与反转生成 Auctra 候选场次卡，不直接覆盖正式稿',
  },
  {
    skillName: 'muweave-storyboard-breakdown',
    zhLabel: '竖屏分镜拆解与资产核对',
    zhKeywords: '分镜 拆镜 镜头 景别 资产 四轴 scaena',
    description: '核对剧本场次与 Scaena 分镜摘要表、四轴资产就绪度及时间线时长',
  },
  {
    skillName: 'muweave-schedule-plan',
    zhLabel: '发布排期与档期规划',
    zhKeywords: '排期 档期 发布 日历 上线 节奏 schedule',
    description: '按场次与成稿状态排发布档期，检查空档与过密，回写排期板',
  },
]

/** Recently picked entries, newest first. Survives reloads; capped so the list never grows. */
const RECENT_KEY = 'muweave.triggers.recent.v1'
const RECENT_LIMIT = 6

interface RecentEntry {
  source: 'at' | 'slash'
  key: string
  label: string
  at: number
}

function readRecent(): RecentEntry[] {
  try {
    const raw = globalThis.localStorage?.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((e): e is RecentEntry => {
      if (typeof e !== 'object' || e === null) return false
      const row = e as Record<string, unknown>
      return typeof row.key === 'string' && typeof row.label === 'string' && (row.source === 'at' || row.source === 'slash')
    })
  } catch {
    return []
  }
}

function pushRecent(source: RecentEntry['source'], key: string, label: string): void {
  try {
    const rows = readRecent().filter((e) => !(e.source === source && e.key === key))
    rows.unshift({ source, key, label, at: Date.now() })
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(rows.slice(0, RECENT_LIMIT)))
  } catch {
    // A blocked storage host must never break picking.
  }
}

/** Test seam: read-only view of the recent list. */
export function readRecentTriggers(): readonly RecentEntry[] {
  return readRecent()
}

/** Test seam: clear recents between cases. */
export function clearRecentTriggers(): void {
  try {
    globalThis.localStorage?.removeItem(RECENT_KEY)
  } catch {
    // ignore
  }
}

const DOMAIN_SECTION: Record<string, string> = {
  eikona: '视觉元件',
  script: '剧本元件',
  drama: '做剧元件',
  harness: 'Pi / DSH 工件',
  muweave: '幕织元件',
}

function domainSection(domain: string): string {
  return `.muweave · ${DOMAIN_SECTION[domain] ?? domain}`
}

/**
 * Relevance score for a trigger row: exact label > label prefix > label contains > other fields.
 * Bigger is better; 0 means "does not match the query".
 */
export function scoreTriggerMatch(query: string, label: string, extra: readonly string[]): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const text = label.toLowerCase()
  if (text === q) return 100
  if (text.startsWith(q)) return 80
  if (text.includes(q)) return 60
  const hay = [label, ...extra].join(' ').toLowerCase()
  if (hay.includes(q)) return 30
  // Latin subsequence keeps `@linwu` reaching `el_linwu_front`; CJK has no cheap equivalent here,
  // so Chinese queries rely on the substring tiers above (no fake pinyin table).
  if (/^[\x20-\x7e]+$/.test(q)) {
    let i = 0
    for (const ch of q) {
      i = hay.indexOf(ch, i)
      if (i < 0) return 0
      i += 1
    }
    return 10
  }
  return 0
}

/**
 * `@` query grammar: `eikona:`, `kind:eikona.candidate_group`, `owner:scaena`, `scene:ep01:s01`
 * narrow the pool; the remaining text is the keyword. Unknown prefixes fall back to a keyword.
 */
export interface ParsedAtQuery {
  domain?: string
  kind?: string
  owner?: string
  scene?: string
  episode?: string
  text: string
}

const AT_FILTER_KEYS = new Set(['domain', 'kind', 'owner', 'scene', 'episode'])
/** Bare words that act as a domain filter: `@eikona` is shorter than `@domain:eikona`. */
const AT_BARE_DOMAINS = new Set(['eikona', 'script', 'drama', 'harness', 'muweave'])

export function parseAtQuery(raw: string): ParsedAtQuery {
  const out: ParsedAtQuery = { text: '' }
  const words: string[] = []
  for (const token of raw.trim().split(/\s+/).filter(Boolean)) {
    const idx = token.indexOf(':')
    if (idx <= 0) {
      const bare = token.toLowerCase()
      if (!out.domain && AT_BARE_DOMAINS.has(bare)) out.domain = bare
      else words.push(token)
      continue
    }
    const head = token.slice(0, idx).toLowerCase()
    const value = token.slice(idx + 1)
    // `scene:ep01:s01` keeps everything after the first colon.
    const key = AT_FILTER_KEYS.has(head) ? head : head === 'owner' || head === 'src' ? 'owner' : undefined
    if (!key || !value) {
      words.push(token)
      continue
    }
    if (key === 'domain') out.domain = value.toLowerCase()
    else if (key === 'kind') out.kind = value.toLowerCase()
    else if (key === 'owner') out.owner = value.toLowerCase()
    else if (key === 'scene') out.scene = value.toLowerCase()
    else out.episode = value.toLowerCase()
  }
  out.text = words.join(' ')
  return out
}

function ElementChipIcon({ size = 14 }: { size?: number }) {
  return createElement(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 16 16',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.4,
      'aria-hidden': 'true',
    },
    createElement('rect', { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5 }),
    createElement('circle', { cx: 6, cy: 6.5, r: 1.2 }),
    createElement('path', { d: 'M3.5 12l3.2-3 2.4 2 3.4-3.5' }),
  )
}

/**
 * `@` source exposing materialized `.muweave/` elements as native DSH composer chips.
 * Byte-bounded per send signal with WeakMap<AbortSignal, number>.
 */
export interface MuweaveElementAtHooks {
  /** Open the theater at the element's room (`ref` is `elementId|owner|sourceRef|digest`). */
  onOpenElement?: (ref: string) => void
  /** A candidate was inserted into `sessionId`'s composer. */
  onPicked?: (sessionId: string | undefined, pick: { ref: string; label: string }) => void
}

export function createMuweaveElementAtSource(hooks?: MuweaveElementAtHooks | (() => void)): DshInputTriggerSourceLike {
  const sendBytes = new WeakMap<AbortSignal, number>()
  const MAX_SERIALIZE_BYTES = 32 * 1024
  const { onOpenElement, onPicked }: MuweaveElementAtHooks =
    typeof hooks === 'function' ? { onOpenElement: () => hooks() } : (hooks ?? {})
  // onPick carries no session; the composer that asked for candidates is the one picking.
  let lastSessionId: string | undefined

  return {
    trigger: '@',
    name: 'muweave-elements',
    order: 24,
    showGroupTitle: true,
    candidates(session, { query, signal }) {
      lastSessionId = session?.sessionId
      if (signal.aborted) return []
      const parsed = parseAtQuery(query)
      const recent = readRecent().filter((e) => e.source === 'at')
      const items = getFloatingAgentSnapshot().knownElements
      const lang = typeof navigator !== 'undefined' && navigator.language?.startsWith('en') ? 'en' : 'zh'

      const scored = items
        .map((el) => {
          if (parsed.domain && el.domain !== parsed.domain) return undefined
          if (parsed.kind && el.kind !== parsed.kind) return undefined
          if (parsed.owner && el.sourceOwner !== parsed.owner) return undefined
          if (parsed.scene && !`${el.sourceRef}`.toLowerCase().includes(parsed.scene)) return undefined
          if (parsed.episode && !`${el.sourceRef} ${el.title}`.toLowerCase().includes(parsed.episode)) return undefined
          const score = scoreTriggerMatch(parsed.text, el.title, [el.elementId, el.kind, el.sourceRef, el.sourceOwner])
          if (score === 0) return undefined
          const recentRank = recent.findIndex((r) => r.key === el.elementId)
          return { el, score, recentRank }
        })
        .filter((row): row is { el: (typeof items)[number]; score: number; recentRank: number } => row !== undefined)
        .sort((a, b) => {
          // Recents first (newest first), then relevance, then title for a stable list.
          if (a.recentRank !== b.recentRank) {
            if (a.recentRank === -1) return 1
            if (b.recentRank === -1) return -1
            return a.recentRank - b.recentRank
          }
          if (b.score !== a.score) return b.score - a.score
          // Ids are ASCII, so this tie-break is identical on every host locale.
          return a.el.elementId.localeCompare(b.el.elementId)
        })
        .slice(0, 24)

      return scored.map(({ el, recentRank }) => ({
        name: el.elementId,
        label: el.title,
        description: `${el.sourceOwner} · ${statusLabel(el.status, lang)}`,
        section: recentRank >= 0 ? '最近使用' : domainSection(el.domain),
        icon: ElementChipIcon,
        value: `${el.elementId}|${el.sourceOwner}|${el.sourceRef}|${el.digest.slice(0, 19)}`,
      }))
    },
    onPick({ candidate }) {
      const refStr = String(candidate.value ?? candidate.name ?? '')
      const label = String(candidate.label ?? candidate.name ?? 'element')
      const elementId = refStr.split('|')[0] ?? refStr
      pushRecent('at', elementId, label)
      try {
        onPicked?.(lastSessionId, { ref: refStr, label })
      } catch {
        // Logging must never block the insert.
      }
      return {
        insert: {
          source: 'muweave-elements',
          ref: refStr,
          label,
          clipboardText: `@[${label}](${refStr})`,
        },
      }
    },
    openReference(_session, refObj) {
      onOpenElement?.(refObj?.ref ?? '')
      return true
    },
    codec: {
      clipboardText: (ref) => `@muweave(${ref})`,
      async serialize(ref, signal) {
        const [elementId, owner, sourceRef, shortDigest] = ref.split('|')
        const line = `[MuWeaveElement id=${elementId ?? ref} owner=${owner ?? 'muweave'} ref=${sourceRef ?? ref} digest=${shortDigest ?? 'verified'}]`
        if (signal) {
          const prev = sendBytes.get(signal) ?? 0
          const next = prev + line.length
          if (next > MAX_SERIALIZE_BYTES) {
            throw new Error('MuWeave element reference byte budget exceeded for this message')
          }
          sendBytes.set(signal, next)
        }
        return line
      },
    },
  }
}

/**
 * `/` source enabling Chinese keyword lookup for creator skills and preset prompt templates.
 * Returns `{ text: '/<skillName> ' }` (with leading space when inline) so DSH's native skill
 * lexicon highlights and injects `<skill_content>` identically to built-in rows.
 */
export function createMuweaveSlashSource(): DshInputTriggerSourceLike {
  return {
    trigger: '/',
    name: 'muweave-creator-slash',
    order: 28,
    showGroupTitle: false,
    candidates(_session, { query, signal }) {
      if (signal.aborted) return []
      const recent = readRecent().filter((e) => e.source === 'slash')

      const skillRows = CREATOR_CHINESE_SKILLS.map((s) => {
        const score = scoreTriggerMatch(query, s.zhLabel, [s.skillName, s.zhKeywords, s.description])
        const recentRank = recent.findIndex((r) => r.key === s.skillName)
        return score === 0
          ? undefined
          : {
              name: s.skillName,
              label: s.zhLabel,
              description: s.description,
              section: recentRank >= 0 ? '最近使用' : '幕织创作技能',
              value: { kind: 'skill', skillName: s.skillName },
              score,
              recentRank,
              roleRank: 0,
            }
      }).filter((r): r is NonNullable<typeof r> => r !== undefined)

      const tplRows = BUILTIN_CREATOR_TEMPLATES.map((tpl) => {
        const score = scoreTriggerMatch(query, tpl.title, [tpl.category, tpl.summary, tpl.releaseId])
        const recentRank = recent.findIndex((r) => r.key === tpl.releaseId)
        return score === 0
          ? undefined
          : {
              name: tpl.releaseId,
              label: tpl.title,
              description: tpl.summary,
              section: recentRank >= 0 ? '最近使用' : `预设提示词 · ${tpl.category}`,
              value: { kind: 'template', templateRef: tpl.templateRef, title: tpl.title },
              score,
              recentRank,
              roleRank: 1,
            }
      }).filter((r): r is NonNullable<typeof r> => r !== undefined)

      return [...skillRows, ...tplRows]
        .sort((a, b) => {
          if (a.recentRank !== b.recentRank) {
            if (a.recentRank === -1) return 1
            if (b.recentRank === -1) return -1
            return a.recentRank - b.recentRank
          }
          // A skill is an action, a template is a skeleton: skills win ties so `/分镜` opens the skill.
          if (a.roleRank !== b.roleRank) return a.roleRank - b.roleRank
          if (b.score !== a.score) return b.score - a.score
          return a.label.localeCompare(b.label)
        })
        .map(({ score: _score, recentRank: _recent, roleRank: _role, ...row }) => row)
    },
    onPick({ candidate, position }) {
      const val = (candidate.value ?? {}) as { kind?: string; skillName?: string; templateRef?: string; title?: string }
      const prefix = position === 'inline' ? ' ' : ''
      if (val.kind === 'skill' && val.skillName) {
        pushRecent('slash', val.skillName, String(candidate.label ?? val.skillName))
        return { text: `${prefix}/${val.skillName} ` }
      }
      if (val.kind === 'template' && val.templateRef) {
        pushRecent('slash', String(candidate.name ?? ''), String(candidate.label ?? ''))
        return { text: `${prefix}[预设提示词 ${val.title ?? ''} · ${val.templateRef}] ` }
      }
      return { text: `${prefix}/${String(candidate.name ?? '')} ` }
    },
  }
}
