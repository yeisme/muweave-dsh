import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import {
  createMuweaveMcpServer,
  McpHttpConfigError,
  runStdioMcpServer,
  seedDemoWorkspace,
  startMuweaveMcpHttpServer,
} from '@yeisme/dsh-muweave-core'

describe('MuWeave MCP Server (local stdio + remote Streamable HTTP)', () => {
  it('supports MCP JSON-RPC 2.0, exposes 12 safe tools (no job.approve), 5 resources, and 3 prompts', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-mcp-core-'))
    const dataDir = path.join(ws, 'plugin-data')
    try {
      await seedDemoWorkspace(ws, { pluginDataDir: dataDir })
      const server = createMuweaveMcpServer({ defaultWorkspaceDir: ws, pluginDataDir: dataDir })

      // initialize (both 2024-11-05 and 2025-03-26)
      const init1 = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05' },
      })
      expect((init1?.result as { protocolVersion: string }).protocolVersion).toBe('2024-11-05')

      const init2 = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26' },
      })
      expect((init2?.result as { protocolVersion: string }).protocolVersion).toBe('2025-03-26')

      // notification returns null
      const notif = await server.handleJsonRpc({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      })
      expect(notif).toBeNull()

      // ping
      const ping = await server.handleJsonRpc({ jsonrpc: '2.0', id: 3, method: 'ping' })
      expect(ping?.result).toEqual({})

      // tools/list: 22 tools, NEVER exposes job.approve
      const toolsRes = await server.handleJsonRpc({ jsonrpc: '2.0', id: 4, method: 'tools/list' })
      const tools = (toolsRes?.result as { tools: Array<{ name: string }> }).tools
      expect(tools).toHaveLength(22)
      expect(tools.some((t) => /approve/i.test(t.name))).toBe(false)

      // tools/call: muweave_drama_shots_list + muweave_drama_review_set + muweave_drama_export + muweave_project_diagnose
      const shotsCall = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'muweave_drama_shots_list', arguments: { missingRole: 'keyframe' } },
      })
      const shotsText = (shotsCall?.result as { content: Array<{ text: string }> }).content[0]!.text
      const shotsParsed = JSON.parse(shotsText) as { total: number; shots: Array<{ shotRef: string }> }
      expect(shotsParsed.total).toBe(2)
      expect(containsHostPath(shotsText)).toBe(false)
      expect(findPlaintextCredential(shotsText)).toBeUndefined()

      const reviewCall = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: {
          name: 'muweave_drama_review_set',
          arguments: { shotRef: 'shot_06', status: 'approved', note: 'MCP 审片通过', expectedRevision: 0 },
        },
      })
      const reviewText = (reviewCall?.result as { content: Array<{ text: string }> }).content[0]!.text
      expect(JSON.parse(reviewText)).toMatchObject({ review: { shotRef: 'shot_06', status: 'approved', revision: 1 } })

      const exportCall = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'muweave_drama_export', arguments: { format: 'cmx3600_edl', fps: 24 } },
      })
      const exportText = (exportCall?.result as { content: Array<{ text: string }> }).content[0]!.text
      const exportParsed = JSON.parse(exportText) as { shotCount: number; content: string }
      expect(exportParsed.shotCount).toBe(6)
      expect(exportParsed.content).toContain('FCM: NON-DROP FRAME')
      expect(containsHostPath(exportText)).toBe(false)

      const diagCall = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'muweave_project_diagnose', arguments: {} },
      })
      const diagText = (diagCall?.result as { content: Array<{ text: string }> }).content[0]!.text
      expect(JSON.parse(diagText)).toHaveProperty('migrationReport.schema', 'muweave.migration-report.v1')

      // resources/list & resources/read (all 12)
      const resList = await server.handleJsonRpc({ jsonrpc: '2.0', id: 9, method: 'resources/list' })
      const resources = (resList?.result as { resources: Array<{ uri: string }> }).resources
      expect(resources).toHaveLength(12)
      for (const r of resources) {
        const readRes = await server.handleJsonRpc({
          jsonrpc: '2.0',
          id: `read_${r.uri}`,
          method: 'resources/read',
          params: { uri: r.uri },
        })
        const text = (readRes?.result as { contents: Array<{ text: string }> }).contents[0]!.text
        expect(text.length).toBeGreaterThan(0)
        expect(containsHostPath(text)).toBe(false)
        expect(findPlaintextCredential(text)).toBeUndefined()
      }

      // prompts/list & prompts/get (all 3)
      const promptsRes = await server.handleJsonRpc({ jsonrpc: '2.0', id: 10, method: 'prompts/list' })
      const prompts = (promptsRes?.result as { prompts: Array<{ name: string }> }).prompts
      expect(prompts).toHaveLength(3)
      const promptGet = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 11,
        method: 'prompts/get',
        params: { name: 'drama_director_review', arguments: { shotRef: 'shot_01' } },
      })
      expect((promptGet?.result as { messages: Array<{ content: { text: string } }> }).messages[0]!.content.text).toContain('shot_01')

      server.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('runStdioMcpServer handles both newline-delimited JSON-RPC and Content-Length framing with stderr-only logs', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-mcp-stdio-'))
    try {
      const server = createMuweaveMcpServer({ defaultWorkspaceDir: ws, pluginDataDir: path.join(ws, 'data') })

      // 1. Newline-delimited JSON
      const in1 = new PassThrough()
      const out1 = new PassThrough()
      const err1 = new PassThrough()
      let stdout1 = ''
      let stderr1 = ''
      out1.on('data', (c) => { stdout1 += c.toString('utf8') })
      err1.on('data', (c) => { stderr1 += c.toString('utf8') })

      const done1 = runStdioMcpServer(server, { input: in1, output: out1, stderr: err1 })
      in1.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })}\n`)
      in1.end()
      await done1
      expect(JSON.parse(stdout1.trim())).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
      expect(stderr1).toContain('stdio transport ready')

      // 2. Content-Length framing
      const in2 = new PassThrough()
      const out2 = new PassThrough()
      const err2 = new PassThrough()
      let stdout2 = ''
      out2.on('data', (c) => { stdout2 += c.toString('utf8') })

      const done2 = runStdioMcpServer(server, { input: in2, output: out2, stderr: err2 })
      const body = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' })
      in2.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
      in2.end()
      await done2
      expect(stdout2).toContain('Content-Length:')
      expect(stdout2).toContain('"id":2')

      server.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('startMuweaveMcpHttpServer enforces REMOTE_AUTH_TOKEN_REQUIRED on non-loopback and validates Bearer auth + routes', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-mcp-http-'))
    const prevEnv = process.env.MUWEAVE_MCP_TOKEN
    delete process.env.MUWEAVE_MCP_TOKEN
    try {
      const server = createMuweaveMcpServer({ defaultWorkspaceDir: ws, pluginDataDir: path.join(ws, 'data') })

      // Security gate: non-loopback without authToken MUST throw REMOTE_AUTH_TOKEN_REQUIRED
      await expect(
        startMuweaveMcpHttpServer({ server, host: '0.0.0.0', port: 0 }),
      ).rejects.toThrowError(McpHttpConfigError)

      const started = await startMuweaveMcpHttpServer({
        server,
        host: '127.0.0.1',
        port: 0,
        authToken: 'test-mcp-secret-token',
      })
      const baseUrl = `http://127.0.0.1:${started.port}`

      try {
        // GET /healthz (unauthenticated)
        const health = await fetch(`${baseUrl}/healthz`)
        expect(health.status).toBe(200)
        expect(await health.json()).toEqual({
          ok: true,
          protocol: 'mcp',
          transport: 'streamable-http',
          serverName: 'muweave-dsh-mcp',
        })

        // OPTIONS /mcp (CORS)
        const opt = await fetch(`${baseUrl}/mcp`, { method: 'OPTIONS', headers: { Origin: 'https://client.example' } })
        expect(opt.status).toBe(204)
        expect(opt.headers.get('access-control-allow-origin')).toBe('https://client.example')

        // POST /mcp without token -> 401
        const unauth = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        })
        expect(unauth.status).toBe(401)

        // POST /mcp with wrong token -> 401
        const badAuth = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-token' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
        })
        expect(badAuth.status).toBe(401)

        // POST /mcp initialize with valid Bearer token -> 200 + Mcp-Session-Id
        const initRes = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: 'Bearer test-mcp-secret-token' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } }),
        })
        expect(initRes.status).toBe(200)
        const sessionId = initRes.headers.get('mcp-session-id')
        expect(sessionId).toBeTruthy()

        // POST /mcp notification -> 202
        const notifRes = await fetch(`${baseUrl}/mcp`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: 'Bearer test-mcp-secret-token',
            'mcp-session-id': sessionId!,
          },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        })
        expect(notifRes.status).toBe(202)

        // GET /mcp SSE stream -> text/event-stream starting with ": connected"
        const ac = new AbortController()
        const sseRes = await fetch(`${baseUrl}/mcp`, {
          method: 'GET',
          headers: { authorization: 'Bearer test-mcp-secret-token', 'mcp-session-id': sessionId! },
          signal: ac.signal,
        })
        expect(sseRes.status).toBe(200)
        expect(sseRes.headers.get('content-type')).toContain('text/event-stream')
        const reader = sseRes.body!.getReader()
        const firstChunk = await reader.read()
        expect(new TextDecoder().decode(firstChunk.value)).toContain(': connected')
        ac.abort()

        // DELETE /mcp -> 204
        const delRes = await fetch(`${baseUrl}/mcp`, {
          method: 'DELETE',
          headers: { authorization: 'Bearer test-mcp-secret-token', 'mcp-session-id': sessionId! },
        })
        expect(delRes.status).toBe(204)
      } finally {
        await started.close()
        server.dispose()
      }
    } finally {
      if (prevEnv !== undefined) process.env.MUWEAVE_MCP_TOKEN = prevEnv
      await rm(ws, { recursive: true, force: true })
    }
  })
})
