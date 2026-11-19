import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bindBundleRef, initBundle, putCasBlob } from '@yeisme/muweave-bundle'
import {
  ClientGenerationGuard,
  CreatorHostService,
  MUWEAVE_MEDIA_PATH,
  MUWEAVE_RPC_PATH,
  mountSharedMuweaveHostRoutes,
  type DshFetchRouteDef,
} from '@yeisme/dsh-muweave-core'

async function workspaceId(svc: CreatorHostService): Promise<string> {
  const listed = await svc.handleRpcAction('workspace.list', {})
  if (!listed.ok) throw new Error('workspace list failed')
  return (listed.data as { workspaces: Array<{ workspaceId: string }> }).workspaces[0]!.workspaceId
}

describe('@yeisme/dsh-muweave-core host RPC, Range media, and reconcile ledger', () => {
  it('enforces cross-site rejection, credential fence, and structured error envelopes without throwing', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-host-'))
    try {
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: path.join(ws, 'plugin-data') })
      const rpc = svc.createRpcFetchHandler()

      const crossRes = await rpc({
        method: 'POST',
        headers: { get: (k) => (k === 'sec-fetch-site' ? 'cross-site' : null) },
        text: async () => '{"action":"workspace.list","payload":{}}',
      })
      expect(crossRes.status).toBe(403)

      const credRes = await rpc({
        method: 'POST',
        headers: { get: () => 'same-origin' },
        text: async () => JSON.stringify({ action: 'bundle.bind', payload: { target: 'eikona-run', ref: 'sk-1234567890abcdefghij' } }),
      })
      expect(credRes.status).toBe(200)
      const credJson = await credRes.json()
      expect(credJson.ok).toBe(false)
      expect(credJson.error.code).toBe('muweave/plaintext_credential_rejected')

      const badJsonRes = await rpc({
        method: 'POST',
        headers: { get: () => 'same-origin' },
        text: async () => '{broken-json',
      })
      expect(badJsonRes.status).toBe(200)
      expect((await badJsonRes.json()).error.code).toBe('muweave/invalid_json')
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('lists elements without initializing or rewriting the bundle and rejects an invalid manifest over RPC', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-host-invalid-manifest-'))
    try {
      const root = path.join(ws, '.muweave')
      const manifestPath = path.join(root, 'bundle.v1.json')
      const indexPath = path.join(root, 'index.v1.json')
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: path.join(ws, 'pdata') })
      const rpc = svc.createRpcFetchHandler()
      const list = async () => {
        const response = await rpc({ method: 'POST', text: async () => '{"action":"bundle.elements.list","payload":{}}' })
        expect(response.status).toBe(200)
        return response.json()
      }
      expect(await list()).toMatchObject({ ok: false, error: { code: 'muweave/bundle_not_initialized' } })
      expect(await readdir(ws)).not.toContain('.muweave')

      await initBundle(ws)
      const original = '{"schemaVersion":999,"projectId":"KEEP-ME","bindings":{"eikonaRuns":["KEEP-RUN"]}}\n'
      await writeFile(manifestPath, original)
      const existingIndex = await readFile(indexPath, 'utf8')
      expect(await list()).toMatchObject({ ok: false, error: { code: 'muweave/contract_mismatch', retryable: false } })
      expect(await svc.handleRpcAction('bundle.sync', {})).toMatchObject({ ok: false, error: { code: 'muweave/contract_mismatch' } })
      expect(await readFile(manifestPath, 'utf8')).toBe(original)
      expect(await readFile(indexPath, 'utf8')).toBe(existingIndex)
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('lists the failed owner as unavailable without publishing its packet', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-host-owner-failure-'))
    try {
      await bindBundleRef(ws, 'eikona-run', 'run-01')
      const svc = new CreatorHostService({
        defaultWorkspaceDir: ws,
        pluginDataDir: path.join(ws, 'pdata'),
        runner: async () => ({
          exitCode: 7,
          stdout: '{"schema_version":"eikona.review_packet.v1","run_id":"run-01","candidates":[]}',
          stderr: 'synthetic failure',
        }),
      })
      expect(await svc.handleRpcAction('bundle.sync', {})).toMatchObject({ ok: true })
      expect(await svc.handleRpcAction('bundle.elements.list', {})).toMatchObject({
        ok: true,
        data: { ownerStates: { eikona: 'unavailable' }, elements: [] },
      })
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('serves CAS SHA-256 verified blobs over short-TTL tokens with HTTP 206 Range support', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-media-'))
    try {
      await initBundle(ws)
      const sample = Buffer.from('0123456789ABCDEF-image-payload')
      const blobRef = await putCasBlob(ws, sample, 'image/png')
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: path.join(ws, 'pdata') })
      const media = svc.createMediaFetchHandler()

      const issueEnv = await svc.handleRpcAction('media.token.issue', { workspaceId: await workspaceId(svc), blobDigest: blobRef.blobDigest, mimeType: 'image/png' })
      expect(issueEnv.ok).toBe(true)
      const token = (issueEnv as { ok: true; data: { token: string } }).data.token

      const fullRes = await media({
        method: 'GET',
        url: `http://127.0.0.1${MUWEAVE_MEDIA_PATH}?token=${token}`,
        headers: { get: () => null },
        text: async () => '',
      })
      expect(fullRes.status).toBe(200)
      expect(Buffer.from(await fullRes.arrayBuffer()).toString()).toBe('0123456789ABCDEF-image-payload')

      const rangeRes = await media({
        method: 'GET',
        url: `http://127.0.0.1${MUWEAVE_MEDIA_PATH}?token=${token}`,
        headers: { get: (k) => (k === 'range' ? 'bytes=0-9' : null) },
        text: async () => '',
      })
      expect(rangeRes.status).toBe(206)
      expect(rangeRes.headers.get('content-range')).toBe(`bytes 0-9/${sample.length}`)
      expect(Buffer.from(await rangeRes.arrayBuffer()).toString()).toBe('0123456789')
      const beyondEof = await media({ method: 'GET', url: `http://127.0.0.1${MUWEAVE_MEDIA_PATH}?token=${token}`, headers: { get: (name) => (name === 'range' ? `bytes=0-${sample.length + 20}` : null) }, text: async () => '' })
      expect(beyondEof.status).toBe(206)
      expect(beyondEof.headers.get('content-range')).toBe(`bytes 0-${sample.length - 1}/${sample.length}`)
      const openEnded = await media({ method: 'GET', url: `http://127.0.0.1${MUWEAVE_MEDIA_PATH}?token=${token}`, headers: { get: (name) => (name === 'range' ? 'bytes=10-' : null) }, text: async () => '' })
      expect(openEnded.status).toBe(206)
      const suffix = await media({ method: 'GET', url: `http://127.0.0.1${MUWEAVE_MEDIA_PATH}?token=${token}`, headers: { get: (name) => (name === 'range' ? 'bytes=-4' : null) }, text: async () => '' })
      expect(suffix.status).toBe(206)
      expect(Buffer.from(await suffix.arrayBuffer()).toString()).toBe('load')
      const unsatisfiable = await media({ method: 'GET', url: `http://127.0.0.1${MUWEAVE_MEDIA_PATH}?token=${token}`, headers: { get: (name) => (name === 'range' ? `bytes=${sample.length}-` : null) }, text: async () => '' })
      expect(unsatisfiable.status).toBe(416)
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('locks timed-out controlled mutations into reconcile_required, rejects idempotency conflicts, and tracks monotonic generations', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-reconcile-'))
    try {
      await mkdir(path.join(ws, '.auctra'), { recursive: true })
      await writeFile(path.join(ws, '.auctra', 'project.yaml'), 'title: test\n')

      let shouldTimeout = true
      const svc = new CreatorHostService({
        defaultWorkspaceDir: ws,
        pluginDataDir: path.join(ws, 'pdata'),
        runner: async (bin, args) => {
          if (bin === 'auctra' && args.includes('save') && shouldTimeout) {
            return { exitCode: 124, stdout: '', stderr: 'ETIMEDOUT' }
          }
          if (bin === 'auctra' && args.includes('reconcile')) {
            const key = args[args.indexOf('--idempotency-key') + 1]
            return { exitCode: 0, stdout: JSON.stringify({ status: 'completed', idempotencyKey: key }), stderr: '' }
          }
          return { exitCode: 0, stdout: '{}', stderr: '' }
        },
      })

      const id = await workspaceId(svc)
      const saveEnv = await svc.handleRpcAction('auctra.scene_card.save', {
        workspaceId: id,
        sceneRef: 'scene:01',
        expectedRevision: '2',
        idempotencyKey: 'idem-save-01',
        card: { goal: '夺回怀表' },
      })
      expect(saveEnv.ok).toBe(false)
      if (!saveEnv.ok) {
        expect(saveEnv.error.code).toBe('RECONCILE_REQUIRED')
        const opRef = saveEnv.error.operationRef!
        expect(opRef).toMatch(/^op_auctra_/)

        const conflictEnv = await svc.handleRpcAction('auctra.scene_card.save', {
          workspaceId: id,
          sceneRef: 'scene:01',
          expectedRevision: '2',
          idempotencyKey: 'idem-save-01',
          card: { goal: '完全不同的篡改请求' },
        })
        expect(conflictEnv.ok).toBe(false)
        if (!conflictEnv.ok) expect(conflictEnv.error.code).toBe('IDEMPOTENCY_CONFLICT')

        const timingEnv = await svc.handleRpcAction('timing.projection', {})
        expect(timingEnv.ok).toBe(true)
        if (timingEnv.ok) {
          const snap = timingEnv.data as { reconcileRequiredCount: number; spans: Array<{ nextAction: string }> }
          expect(snap.reconcileRequiredCount).toBe(1)
          expect(snap.spans[0]?.nextAction).toBe('reconcile_original')
        }

        shouldTimeout = false
        const recEnv = await svc.handleRpcAction('operation.reconcile', { operationRef: opRef })
        expect(recEnv.ok).toBe(true)
        if (recEnv.ok) {
          const settled = (recEnv.data as { operation: { status: string } }).operation
          expect(settled.status).toBe('completed')
        }
      }

      // Restart persistence check: a brand-new CreatorHostService reading the same pluginDataDir
      // restores the ledger and replays idempotent outcomes without re-invoking the CLI!
      let cliInvocationsOnRestart = 0
      const restartedSvc = new CreatorHostService({
        defaultWorkspaceDir: ws,
        pluginDataDir: path.join(ws, 'pdata'),
        runner: async () => {
          cliInvocationsOnRestart += 1
          return { exitCode: 0, stdout: '{}', stderr: '' }
        },
      })
      const replayConflict = await restartedSvc.handleRpcAction('auctra.scene_card.save', {
        workspaceId: await workspaceId(restartedSvc),
        sceneRef: 'scene:01',
        expectedRevision: '2',
        idempotencyKey: 'idem-save-01',
        card: { goal: '重启后篡改请求' },
      })
      expect(replayConflict.ok).toBe(false)
      if (!replayConflict.ok) expect(replayConflict.error.code).toBe('IDEMPOTENCY_CONFLICT')
      expect(cliInvocationsOnRestart).toBe(0)

      // Media token issuance rejects invalid digests and missing CAS blobs fail-closed
      const restartedId = await workspaceId(restartedSvc)
      const badTokenEnv = await restartedSvc.handleRpcAction('media.token.issue', { workspaceId: restartedId, blobDigest: 'sha256:not-a-hex' })
      expect(badTokenEnv.ok).toBe(false)
      const missingBlobEnv = await restartedSvc.handleRpcAction('media.token.issue', {
        workspaceId: restartedId,
        blobDigest: 'sha256:9999999999999999999999999999999999999999999999999999999999999999',
      })
      expect(missingBlobEnv.ok).toBe(false)
      if (!missingBlobEnv.ok) expect(missingBlobEnv.error.code).toBe('muweave/media_not_found')

      const guard = new ClientGenerationGuard()
      const req1 = guard.nextIssueStamp()
      const req2 = guard.nextIssueStamp()
      expect(guard.shouldAccept(5, req2)).toBe(true)
      expect(guard.shouldAccept(4, req1)).toBe(false)
      // Parallel reads at one generation answer out of order; none of them is stale.
      const par1 = guard.nextIssueStamp()
      const par2 = guard.nextIssueStamp()
      expect(guard.shouldAccept(5, par2)).toBe(true)
      expect(guard.shouldAccept(5, par1)).toBe(true)
      const reqAfterRestart = guard.nextIssueStamp()
      expect(guard.shouldAccept(1, reqAfterRestart)).toBe(false)
      expect(guard.currentGeneration()).toBe(5)
      guard.observeHost('host-restarted')
      expect(guard.shouldAccept(1, reqAfterRestart)).toBe(true)
      expect(guard.currentGeneration()).toBe(1)
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('ref-counts shared host routes cleanly across multiple plugins and disposes on final unload', () => {
    const registered: string[] = []
    const disposed: string[] = []
    const disposers: Array<() => void> = []

    const fakeCtx = {
      connection: {
        fetch: {
          register(route: DshFetchRouteDef) {
            registered.push(route.path)
            return () => {
              disposed.push(route.path)
            }
          },
        },
      },
      effect(fn: () => void | (() => void)) {
        const d = fn()
        if (typeof d === 'function') disposers.push(d)
      },
    }

    mountSharedMuweaveHostRoutes(fakeCtx, 'plugin-1')
    mountSharedMuweaveHostRoutes(fakeCtx, 'plugin-2')
    expect(registered).toEqual([MUWEAVE_RPC_PATH, MUWEAVE_MEDIA_PATH])
    expect(disposed).toEqual([])

    disposers[0]!()
    expect(disposed).toEqual([])
    disposers[1]!()
    expect(disposed).toEqual([MUWEAVE_RPC_PATH, MUWEAVE_MEDIA_PATH])
  })

  it('uses the omitted workspace default, rejects unknown ids, and contains registration paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'muweave-workspaces-'))
    try {
      const first = path.join(root, 'first')
      const nested = path.join(first, 'nested')
      const outside = path.join(root, 'outside')
      await mkdir(nested, { recursive: true })
      await mkdir(outside)
      await symlink(outside, path.join(first, 'escape'))
      const svc = new CreatorHostService({ defaultWorkspaceDir: first, pluginDataDir: path.join(root, 'data') })
      const omitted = await svc.handleRpcAction('bundle.status', {})
      expect(omitted.ok).toBe(true)
      const unknown = await svc.handleRpcAction('bundle.status', { workspaceId: 'ws_missing' })
      expect(unknown.ok).toBe(false)
      if (!unknown.ok) expect(unknown.error.code).toBe('WORKSPACE_NOT_FOUND')
      const registered = await svc.handleRpcAction('workspace.register', { workspaceDir: nested, label: 'Nested' })
      expect(registered.ok).toBe(true)
      for (const rejectedPath of [outside, path.join(first, 'escape'), path.join(first, 'missing'), '/etc']) {
        const rejected = await svc.handleRpcAction('workspace.register', { workspaceDir: rejectedPath })
        expect(rejected.ok).toBe(false)
        if (!rejected.ok) expect(rejected.error.code).toBe('muweave/workspace_path_rejected')
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('keeps same-digest unknown mutations recoverable and rejects unknown bind targets without generation changes', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-replay-'))
    try {
      const svc = new CreatorHostService({
        defaultWorkspaceDir: ws,
        pluginDataDir: path.join(ws, 'data'),
        runner: async (_bin, args) => args.includes('asset-failed')
          ? { exitCode: 1, stdout: '', stderr: 'secret provider failure /tmp/private' }
          : { exitCode: 124, stdout: '', stderr: 'secret provider timeout /tmp/private' },
      })
      const id = await workspaceId(svc)
      const before = svc.currentGeneration()
      const first = await svc.handleRpcAction('eikona.asset.bind', { workspaceId: id, handle: 'asset-1', idempotencyKey: 'same' })
      const replay = await svc.handleRpcAction('eikona.asset.bind', { workspaceId: id, handle: 'asset-1', idempotencyKey: 'same' })
      expect(first.ok).toBe(false)
      expect(replay.ok).toBe(false)
      if (!replay.ok) expect(replay.error.code).toBe('RECONCILE_REQUIRED')
      const failed = await svc.handleRpcAction('eikona.asset.bind', { workspaceId: id, handle: 'asset-failed', idempotencyKey: 'failed-key' })
      const failedReplay = await svc.handleRpcAction('eikona.asset.bind', { workspaceId: id, handle: 'asset-failed', idempotencyKey: 'failed-key' })
      expect(failed.ok).toBe(false)
      expect(failedReplay.ok).toBe(false)
      if (!failedReplay.ok) expect(failedReplay.error.code).toBe('IDEMPOTENT_REPLAY_NOT_SUCCESSFUL')
      const operationRef = first.ok ? '' : first.error.operationRef
      const unavailable = await svc.handleRpcAction('operation.reconcile', { operationRef })
      expect(unavailable.ok).toBe(false)
      if (!unavailable.ok) expect(unavailable.error.code).toBe('CAPABILITY_UNAVAILABLE')
      const rejected = await svc.handleRpcAction('bundle.bind', { workspaceId: id, target: 'unknown-owner', ref: 'ref-1' })
      expect(rejected.ok).toBe(false)
      expect(svc.currentGeneration()).toBe(before + 2)
      const ledger = await readFile(path.join(ws, 'data', 'ledger.v1.json'), 'utf8')
      expect(ledger).not.toContain('/tmp/private')
      expect(ledger).not.toContain('secret provider')
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('rejects corrupt ledgers, unsafe media, ambiguous reconcile text, and rolls back partial route registration', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-hardening-'))
    try {
      await initBundle(ws)
      const blob = await putCasBlob(ws, Buffer.from('safe-bytes'), 'image/png')
      const dataDir = path.join(ws, 'data')
      await mkdir(dataDir)
      const listed = await new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: path.join(ws, 'unused') }).handleRpcAction('workspace.list', {})
      const currentId = listed.ok ? (listed.data as { workspaces: Array<{ workspaceId: string }> }).workspaces[0]!.workspaceId : ''
      const now = new Date().toISOString()
      const valid = { operationRef: 'op_cli_1234567890', workspaceId: currentId, owner: 'cli', action: 'bundle.sync', idempotencyKey: 'kept', requestDigest: blob.blobDigest, status: 'failed', createdAt: now, updatedAt: now }
      const sibling = { ...valid, operationRef: 'op_cli_0987654321', workspaceId: 'ws_later_registered', idempotencyKey: 'sibling', status: 'reconcile_required' }
      await writeFile(path.join(dataDir, 'ledger.v1.json'), JSON.stringify({
        schema: 'muweave.host-ledger.v1', generation: 9,
        operations: [valid, { operationRef: 'bad-record' }, sibling],
      }))
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: dataDir, runner: async () => ({ exitCode: 0, stdout: 'completed but not structured', stderr: '' }) })
      expect(svc.currentGeneration()).toBe(9)
      const restored = await svc.handleRpcAction('timing.projection', {})
      expect(restored.ok).toBe(true)
      if (restored.ok) {
        const refs = (restored.data as { spans: Array<{ operationRef: string }> }).spans.map((span) => span.operationRef)
        expect(refs).toEqual(expect.arrayContaining(['op_cli_1234567890', 'op_cli_0987654321']))
      }
      const id = await workspaceId(svc)
      const mime = await svc.handleRpcAction('media.token.issue', { workspaceId: id, blobDigest: blob.blobDigest, mimeType: 'text/html' })
      expect(mime.ok).toBe(false)
      const issued = await svc.handleRpcAction('media.token.issue', { workspaceId: id, blobDigest: blob.blobDigest, mimeType: 'image/png' })
      const token = issued.ok ? (issued.data as { token: string }).token : ''
      const badRange = await svc.createMediaFetchHandler()({ method: 'GET', url: `http://127.0.0.1${MUWEAVE_MEDIA_PATH}?token=${token}`, headers: { get: (name) => (name === 'range' ? 'bytes=999-' : null) }, text: async () => '' })
      expect(badRange.status).toBe(416)
      expect(await badRange.text()).not.toContain(ws)
      await mkdir(path.join(ws, '.auctra'))
      const ambiguous = await svc.handleRpcAction('auctra.scene_card.save', { workspaceId: id, sceneRef: 'scene:01', expectedRevision: '1', idempotencyKey: 'ambiguous', card: { goal: 'x' } })
      const operationRef = ambiguous.ok ? '' : ambiguous.error.operationRef
      const reconciled = await svc.handleRpcAction('operation.reconcile', { operationRef })
      expect(reconciled.ok).toBe(false)

      delete globalThis.__YEISME_MUWEAVE_DSH_HOST_BUS__
      const disposed: string[] = []
      expect(() => mountSharedMuweaveHostRoutes({
        connection: { fetch: { register(route: DshFetchRouteDef): () => void { if (route.path === MUWEAVE_MEDIA_PATH) throw new Error('media failed'); return () => { disposed.push(route.path) } } } },
        effect(fn) { fn() },
      }, 'rollback')).toThrow('media failed')
      expect(disposed).toEqual([MUWEAVE_RPC_PATH])
    } finally {
      delete globalThis.__YEISME_MUWEAVE_DSH_HOST_BUS__
      await rm(ws, { recursive: true, force: true })
    }
  })
})
