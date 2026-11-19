import { describe, expect, it } from 'vitest'
import {
  clearRecentTriggers,
  createMuweaveElementAtSource,
  createMuweaveSlashSource,
  parseAtQuery,
  readRecentTriggers,
  scoreTriggerMatch,
} from '../packages/dsh-muweave-core/src/client/triggers'
import { publishKnownElementsForTriggers } from '../packages/dsh-muweave-core/src/client/floating-agent'
import type { MuweaveElementSummaryV1 } from '../packages/dsh-muweave-core/src/protocol'

function el(over: Partial<MuweaveElementSummaryV1> & { elementId: string; title: string }): MuweaveElementSummaryV1 {
  return {
    domain: 'eikona',
    kind: 'eikona.candidate_group',
    sourceOwner: 'eikona',
    sourceRef: 'eikona://runs/r1',
    status: 'waiting_review',
    digest: `sha256:${'a'.repeat(64)}`,
    updatedAt: '2026-11-18T00:00:00Z',
    ...over,
  } as MuweaveElementSummaryV1
}

const signal = () => new AbortController().signal

describe('trigger relevance scoring', () => {
  it('ranks exact, prefix, substring, other-field and subsequence matches in that order', () => {
    expect(scoreTriggerMatch('林雾', '林雾', [])).toBe(100)
    expect(scoreTriggerMatch('林雾', '林雾定妆组', [])).toBe(80)
    expect(scoreTriggerMatch('定妆', '林雾定妆组', [])).toBe(60)
    expect(scoreTriggerMatch('scaena', '分镜表', ['scaena'])).toBe(30)
    expect(scoreTriggerMatch('linwu', '林雾正面定妆', ['el_linwu_front'])).toBe(30)
    // Subsequence, not substring: l→f skips the middle of the id.
    expect(scoreTriggerMatch('lwf', '林雾正面定妆', ['el_linwu_front'])).toBe(10)
    expect(scoreTriggerMatch('zzz', '林雾', [])).toBe(0)
    // Empty query keeps everything.
    expect(scoreTriggerMatch('  ', '林雾', [])).toBe(1)
  })
})

describe('@ query grammar', () => {
  it('extracts known prefixes and keeps the rest as keywords', () => {
    expect(parseAtQuery('eikona 林雾')).toEqual({ domain: 'eikona', text: '林雾' })
    expect(parseAtQuery('kind:drama.shot 特写')).toEqual({ kind: 'drama.shot', text: '特写' })
    expect(parseAtQuery('owner:scaena')).toEqual({ owner: 'scaena', text: '' })
    // A ref contains colons: everything after the first one is the value.
    expect(parseAtQuery('scene:ep01:s01')).toEqual({ scene: 'ep01:s01', text: '' })
    expect(parseAtQuery('episode:ep01 场次')).toEqual({ episode: 'ep01', text: '场次' })
    // Unknown prefixes stay literal keywords.
    expect(parseAtQuery('note:abc')).toEqual({ text: 'note:abc' })
  })
})

describe('@ source: relevance, recents, filters and budget', () => {
  it('sorts by relevance, promotes the last pick and honours prefixes', async () => {
    clearRecentTriggers()
    publishKnownElementsForTriggers([
      el({ elementId: 'el_linwu_front', title: '林雾正面定妆' }),
      el({ elementId: 'el_linwu_side', title: '林雾侧面定妆' }),
      el({ elementId: 'el_shot_01', title: '分镜摘要表', domain: 'drama', kind: 'drama.storyboard_table', sourceOwner: 'scaena', sourceRef: 'shot:ep01:s01:01' }),
    ])
    const source = createMuweaveElementAtSource()

    const all = await source.candidates({ sessionId: 's1' }, { query: '', signal: signal() })
    expect(all).toHaveLength(3)
    // A readable status replaces the raw enum.
    expect(String((all[0] as { description: string }).description)).not.toContain('waiting_review')

    const filtered = await source.candidates({ sessionId: 's1' }, { query: 'eikona', signal: signal() })
    expect(filtered.map((c) => c.name).sort()).toEqual(['el_linwu_front', 'el_linwu_side'])

    const byKind = await source.candidates({ sessionId: 's1' }, { query: 'kind:drama.storyboard_table', signal: signal() })
    expect(byKind.map((c) => c.name)).toEqual(['el_shot_01'])

    const byScene = await source.candidates({ sessionId: 's1' }, { query: 'scene:s01:01', signal: signal() })
    expect(byScene.map((c) => c.name)).toEqual(['el_shot_01'])

    // Pick the side view: it moves to the top of the next listing under 最近使用.
    source.onPick({ candidate: { name: 'el_linwu_side', label: '林雾侧面定妆', value: 'el_linwu_side|eikona|eikona://runs/r1|sha256:aaaaaaaaaaaaaaaaaaa' } })
    expect(readRecentTriggers().map((r) => r.key)).toEqual(['el_linwu_side'])
    const afterPick = await source.candidates({ sessionId: 's1' }, { query: '', signal: signal() })
    expect(afterPick[0]!.name).toBe('el_linwu_side')
    expect(afterPick[0]!.section).toBe('最近使用')
  })

  it('keeps the per-send serialization budget', async () => {
    const source = createMuweaveElementAtSource()
    const ctrl = new AbortController()
    const line = await source.codec!.serialize('el_a|eikona|eikona://runs/r1|sha256:abc', ctrl.signal)
    expect(line).toContain('MuWeaveElement id=el_a')
    // Fill the budget, then one more reference must fail instead of silently truncating.
    let failed = false
    for (let i = 0; i < 900 && !failed; i += 1) {
      try {
        await source.codec!.serialize('x'.repeat(40), ctrl.signal)
      } catch {
        failed = true
      }
    }
    expect(failed).toBe(true)
  })
})

describe('/ source: skills outrank templates', () => {
  it('returns a skill first for a shared keyword and remembers the pick', async () => {
    clearRecentTriggers()
    const slash = createMuweaveSlashSource()
    const rows = await slash.candidates({ sessionId: 's1' }, { query: '分镜', signal: signal() })
    expect(rows.length).toBeGreaterThanOrEqual(1)
    const first = rows[0] as { value: { kind: string; skillName?: string } }
    expect(first.value.kind).toBe('skill')
    expect(first.value.skillName).toBe('muweave-storyboard-breakdown')

    const picked = slash.onPick({ candidate: rows[0]!, position: 'inline' })
    expect(picked).toEqual({ text: ' /muweave-storyboard-breakdown ' })
    expect(readRecentTriggers().some((r) => r.source === 'slash' && r.key === 'muweave-storyboard-breakdown')).toBe(true)
  })

  it('finds the schedule skill with Chinese keywords', async () => {
    const slash = createMuweaveSlashSource()
    const rows = await slash.candidates({ sessionId: 's1' }, { query: '排期', signal: signal() })
    const names = rows.map((r) => String((r as { value: { skillName?: string } }).value.skillName ?? (r as { name: string }).name))
    expect(names).toContain('muweave-schedule-plan')
  })
})
