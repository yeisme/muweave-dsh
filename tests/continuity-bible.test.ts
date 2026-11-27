import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import {
  ContinuityBibleInputError,
  ContinuityBibleStore,
  CreatorHostService,
  createMuweaveMcpServer,
  runMuweaveCli,
  type ContinuityBibleV1,
} from '@yeisme/dsh-muweave-core'

describe('v8 ContinuityBibleStore, project.bible.* RPCs, CLI & MCP', () => {
  it('enforces hex validation, credential/path fences, optimistic locking, 0600 persist, and .corrupt-* recovery', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-bible-store-'))
    const file = path.join(dir, 'continuity-bible.v1.json')
    try {
      const store = new ContinuityBibleStore(dir)
      const initial = store.get('ws_alpha')
      expect(initial.schema).toBe('muweave.continuity-bible.v1')
      expect(initial.revision).toBe('0')

      const saved = store.set('ws_alpha', {
        projectTitle: '雨夜怀表',
        visualGrammar: { aspectRatio: '9:16', lensStyle: '35mm close-up' },
        colorPalette: [{ name: 'Deep Indigo', hex: '#1c2a44' }],
        characterAnchors: [
          { name: '林深', wardrobe: '深炭灰风衣', immutableTraits: '左眉浅疤' },
        ],
        negativeGuardrails: ['禁止多指'],
        complianceDisclosure: '本片由 AI 辅助生成',
        expectedRevision: '0',
      })
      expect(saved.revision).toBe('1')
      expect((await stat(file)).mode & 0o777).toBe(0o600)

      // Optimistic lock conflict
      let conflictErr: unknown
      try {
        store.set('ws_alpha', { projectTitle: 'Stale', expectedRevision: '0' })
      } catch (e) {
        conflictErr = e
      }
      expect(conflictErr).toBeInstanceOf(ContinuityBibleInputError)
      expect((conflictErr as ContinuityBibleInputError).code).toBe('muweave/bible_revision_conflict')
      expect((conflictErr as ContinuityBibleInputError).details).toEqual({ currentRevision: '1' })

      // Invalid hex color rejected
      expect(() =>
        store.set('ws_alpha', { colorPalette: [{ name: 'Bad', hex: 'red' }] }),
      ).toThrowError(ContinuityBibleInputError)

      // Plaintext credential & host path rejected
      expect(() =>
        store.set('ws_alpha', { complianceDisclosure: 'key sk-1234567890abcdef1234' }),
      ).toThrowError(ContinuityBibleInputError)
      expect(() =>
        store.set('ws_alpha', { projectTitle: 'See /Users/alice/bible.md' }),
      ).toThrowError(ContinuityBibleInputError)

      // Reload from disk preserves revision & data
      const reloaded = new ContinuityBibleStore(dir)
      expect(reloaded.get('ws_alpha').revision).toBe('1')
      expect(reloaded.get('ws_alpha').complianceDisclosure).toBe('本片由 AI 辅助生成')

      // Corrupt JSON recovery
      await writeFile(file, '{not json', 'utf8')
      const recovered = new ContinuityBibleStore(dir)
      expect(recovered.corruptFile).toContain('continuity-bible.v1.corrupt-')
      expect(recovered.get('ws_alpha').revision).toBe('0')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('wires project.bible.get/set via Host RPC, CLI bible show|set, and MCP tool/resource', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-bible-rpc-'))
    const dataDir = path.join(ws, 'plugin-data')
    try {
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: dataDir })
      const gen0 = svc.currentGeneration()

      const setRes = await svc.handleRpcAction('project.bible.set', {
        projectTitle: '霓虹雨夜',
        complianceDisclosure: 'AI 辅助创作内容',
        expectedRevision: '0',
      })
      expect(setRes.ok).toBe(true)
      if (!setRes.ok) throw new Error('expected ok')
      expect(setRes.generation).toBeGreaterThan(gen0)
      expect((setRes.data as { bible: ContinuityBibleV1 }).bible.revision).toBe('1')

      // CLI bible show --json
      let out = ''
      const code = await runMuweaveCli(['bible', 'show', '--workspace', ws, '--data-dir', dataDir, '--json'], {
        stdout: (s) => { out += s },
      })
      expect(code).toBe(0)
      const parsed = JSON.parse(out) as { bible: ContinuityBibleV1 }
      expect(parsed.bible.projectTitle).toBe('霓虹雨夜')
      expect(containsHostPath(parsed)).toBe(false)
      expect(findPlaintextCredential(parsed)).toBeUndefined()

      // MCP muweave_project_bible & muweave://project/bible
      const mcp = createMuweaveMcpServer({ host: svc })
      const toolRes = await mcp.handleJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'muweave_project_bible', arguments: { action: 'get' } },
      })
      const toolText = (toolRes?.result as { content: Array<{ text: string }> }).content[0]!.text
      expect(JSON.parse(toolText).bible.complianceDisclosure).toBe('AI 辅助创作内容')

      const resRead = await mcp.handleJsonRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/read',
        params: { uri: 'muweave://project/bible' },
      })
      const resText = (resRead?.result as { contents: Array<{ text: string }> }).contents[0]!.text
      expect(JSON.parse(resText).bible.revision).toBe('1')
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
