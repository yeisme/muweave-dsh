import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { casBlobPath, muweaveRoot, type CliRunner } from '@yeisme/muweave-bundle'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import {
  CreatorHostService,
  CustomAdapterError,
  CustomAdapterStore,
  createMuweaveMcpServer,
  runMuweaveCli,
  seedDemoWorkspace,
  validateAdapterEndpointUrl,
  type CapabilityCatalogV1,
  type CustomAdapterViewV1,
  type JobRecordV1,
} from '@yeisme/dsh-muweave-core'

const OFFLINE_RUNNER: CliRunner = async () => ({ exitCode: 1, stdout: '', stderr: 'not installed' })
const TINY_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='

const prevKey = process.env.TEST_MUWEAVE_CUSTOM_KEY
afterEach(() => {
  if (prevKey === undefined) delete process.env.TEST_MUWEAVE_CUSTOM_KEY
  else process.env.TEST_MUWEAVE_CUSTOM_KEY = prevKey
})

describe('v7 Custom Engine Bridge: SSRF guard, zero-secret store, and full capability loop', () => {
  it('validateAdapterEndpointUrl enforces protocol, SSRF, private-LAN opt-in, and external HTTPS rules', () => {
    expect(validateAdapterEndpointUrl('http://127.0.0.1:8188').hostname).toBe('127.0.0.1')
    expect(validateAdapterEndpointUrl('http://localhost:8188').hostname).toBe('localhost')
    expect(validateAdapterEndpointUrl('http://[::1]:8188').hostname).toBe('[::1]')
    expect(validateAdapterEndpointUrl('https://api.openai.com').protocol).toBe('https:')

    // Always blocked
    expect(() => validateAdapterEndpointUrl('file:///etc/passwd')).toThrowError(CustomAdapterError)
    expect(() => validateAdapterEndpointUrl('gopher://127.0.0.1:70')).toThrowError(CustomAdapterError)
    expect(() => validateAdapterEndpointUrl('https://user:pass@api.openai.com')).toThrowError(CustomAdapterError)
    expect(() => validateAdapterEndpointUrl('http://0.0.0.0:8188', true)).toThrowError(CustomAdapterError)
    expect(() => validateAdapterEndpointUrl('http://169.254.169.254/latest/meta-data', true)).toThrowError(CustomAdapterError)

    // Private LAN blocked unless allowPrivateNetwork === true
    let lanErr: unknown
    try {
      validateAdapterEndpointUrl('http://192.168.1.25:8188', false)
    } catch (e) {
      lanErr = e
    }
    expect((lanErr as CustomAdapterError).code).toBe('ADAPTER_PRIVATE_NET_FORBIDDEN')
    expect(validateAdapterEndpointUrl('http://192.168.1.25:8188', true).hostname).toBe('192.168.1.25')
    expect(() => validateAdapterEndpointUrl('http://10.0.0.5:8188', false)).toThrowError(CustomAdapterError)
    expect(() => validateAdapterEndpointUrl('http://render.local:8188', false)).toThrowError(CustomAdapterError)

    // Non-loopback external http rejected with ADAPTER_HTTPS_REQUIRED
    let httpErr: unknown
    try {
      validateAdapterEndpointUrl('http://api.openai.com')
    } catch (e) {
      httpErr = e
    }
    expect((httpErr as CustomAdapterError).code).toBe('ADAPTER_HTTPS_REQUIRED')
  })

  it('CustomAdapterStore rejects plaintext credentials, persists 0600, recovers corrupt JSON, and never leaks secrets', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'muweave-custom-store-'))
    const file = path.join(dir, 'custom-adapters.v1.json')
    try {
      const store = new CustomAdapterStore(file)
      expect(() =>
        store.save({
          adapterId: 'bad-key',
          title: 'Bad',
          protocol: 'openai_http',
          kind: 'image',
          endpointUrl: 'https://api.openai.com',
          authEnvVar: 'sk-1234567890abcdef1234',
        }),
      ).toThrowError(CustomAdapterError)

      delete process.env.TEST_MUWEAVE_CUSTOM_KEY
      const saved = store.save({
        adapterId: 'my-openai',
        title: 'My OpenAI Image',
        protocol: 'openai_http',
        kind: 'image',
        endpointUrl: 'https://api.openai.com',
        model: 'gpt-image-1',
        authEnvVar: 'TEST_MUWEAVE_CUSTOM_KEY',
        unitPriceUsd: 0.04,
      })
      expect(saved.envReady).toBe(false)
      expect((await stat(file)).mode & 0o777).toBe(0o600)

      process.env.TEST_MUWEAVE_CUSTOM_KEY = 'sk-test-secret-never-return-123456'
      const views = store.list()
      expect(views[0]?.envReady).toBe(true)
      expect(JSON.stringify(views)).not.toContain('sk-test-secret')
      expect(findPlaintextCredential(views)).toBeUndefined()

      // Corrupt JSON recovery
      await writeFile(file, '{corrupt', 'utf8')
      const recovered = new CustomAdapterStore(file)
      expect(recovered.list()).toEqual([])
      expect(recovered.corruptFile).toContain('custom-adapters.v1.corrupt-')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('wires custom openai_http adapter into catalog, test, job execution -> CAS PNG, CLI, and MCP', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-custom-rpc-'))
    const dataDir = path.join(ws, 'plugin-data')
    try {
      await seedDemoWorkspace(ws, { pluginDataDir: dataDir })
      process.env.TEST_MUWEAVE_CUSTOM_KEY = 'sk-mock-secret-99999999'

      const mockFetch: typeof globalThis.fetch = async (input, init) => {
        const url = String(input)
        if (url.endsWith('/v1/models') && init?.method === 'HEAD') {
          return new Response(null, { status: 200 })
        }
        if (url.endsWith('/v1/images/generations') && init?.method === 'POST') {
          return new Response(JSON.stringify({ data: [{ b64_json: TINY_PNG_B64 }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        }
        return new Response(null, { status: 404 })
      }

      const svc = new CreatorHostService({
        defaultWorkspaceDir: ws,
        pluginDataDir: dataDir,
        runner: OFFLINE_RUNNER,
        fetchImpl: mockFetch,
      })

      // Save free local-priced custom adapter (unitPriceUsd: 0 so paidEnabled=false still allows approval)
      const saveRes = await svc.handleRpcAction('adapter.custom.save', {
        adapterId: 'local-openai-mock',
        title: 'Mock OpenAI Image',
        protocol: 'openai_http',
        kind: 'image',
        endpointUrl: 'https://api.openai.com',
        model: 'gpt-image-1',
        authEnvVar: 'TEST_MUWEAVE_CUSTOM_KEY',
        unitPriceUsd: 0,
      })
      expect(saveRes.ok).toBe(true)
      expect(((saveRes as { ok: true; data: { adapter: CustomAdapterViewV1 } }).data).adapter.envReady).toBe(true)

      // Zero-cost connectivity probe
      const testRes = await svc.handleRpcAction('adapter.custom.test', { adapterId: 'local-openai-mock' })
      expect(testRes.ok).toBe(true)
      expect((testRes as { ok: true; data: { ok: boolean; reachable: boolean } }).data).toMatchObject({ ok: true, reachable: true })

      // Appears in capability.catalog
      const catRes = await svc.handleRpcAction('capability.catalog', {})
      expect(catRes.ok).toBe(true)
      const caps = (catRes as { ok: true; data: CapabilityCatalogV1 }).data.capabilities
      expect(caps.some((c) => c.capabilityId === 'custom.local-openai-mock' && c.available)).toBe(true)

      // Estimate -> Request -> Approve -> Poll -> CAS PNG verified
      const est = await svc.handleRpcAction('capability.estimate', {
        capabilityId: 'custom.local-openai-mock',
        input: { prompt: '雨夜怀表特写' },
        slots: 1,
      })
      expect(est.ok).toBe(true)
      const estimateId = (est as { ok: true; data: { estimate: { estimateId: string } } }).data.estimate.estimateId

      const req = await svc.handleRpcAction('job.request', {
        estimateId,
        idempotencyKey: 'custom_job_1',
        requestedBy: 'ui',
      })
      expect(req.ok).toBe(true)
      const jobId = (req as { ok: true; data: { job: JobRecordV1 } }).data.job.jobId

      const app = await svc.handleRpcAction('job.approve', { jobId, ceiling: { unit: 'none', amount: 0 } })
      expect(app.ok).toBe(true)

      await (svc as unknown as { capabilities: { engine: { tick(): Promise<void> } } }).capabilities.engine.tick()
      const polled = await svc.handleRpcAction('job.get', { jobId })
      expect(polled.ok).toBe(true)
      const job = (polled as { ok: true; data: { job: JobRecordV1 } }).data.job
      expect(job.status).toBe('waiting_for_human')
      expect(job.slots[0]?.sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(existsSync(casBlobPath(muweaveRoot(ws), job.slots[0]!.sha256!))).toBe(true)

      // MCP muweave_adapters_manage list
      const mcp = createMuweaveMcpServer({ host: svc })
      const mcpList = await mcp.handleJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'muweave_adapters_manage', arguments: { action: 'list' } },
      })
      const mcpText = (mcpList?.result as { content: Array<{ text: string }> }).content[0]!.text
      expect(mcpText).toContain('local-openai-mock')
      expect(mcpText).not.toContain('sk-mock-secret')
      expect(containsHostPath(mcpText)).toBe(false)

      // CLI adapters list & remove
      let cliOut = ''
      const listCode = await runMuweaveCli(['adapters', 'list', '--workspace', ws, '--data-dir', dataDir, '--json'], {
        stdout: (s) => { cliOut += s },
      })
      expect(listCode).toBe(0)
      expect(JSON.parse(cliOut).adapters).toHaveLength(1)

      const remRes = await svc.handleRpcAction('adapter.custom.remove', { adapterId: 'local-openai-mock' })
      expect(remRes.ok).toBe(true)
      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
