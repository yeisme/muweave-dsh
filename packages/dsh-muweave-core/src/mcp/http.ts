import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { MCP_SERVER_NAME, type MuweaveMcpServer } from './server'

const MAX_BODY_BYTES = 1024 * 1024 // 1 MiB
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export class McpHttpConfigError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

export interface StartMuweaveMcpHttpServerOptions {
  server: MuweaveMcpServer
  host?: string
  port?: number
  authToken?: string
  allowOrigins?: readonly string[]
  keepaliveMs?: number
}

export interface StartedMuweaveMcpHttpServer {
  server: Server
  host: string
  port: number
  url: string
  close(): Promise<void>
}

function constantTimeTokenMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function readBearerToken(req: IncomingMessage): string | undefined {
  const raw = req.headers.authorization
  if (typeof raw !== 'string') return undefined
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim())
  return match?.[1]?.trim() || undefined
}

function corsHeaders(req: IncomingMessage, allowOrigins?: readonly string[]): Record<string, string> {
  const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
  let allowOrigin = ''
  if (origin) {
    if (!allowOrigins || allowOrigins.length === 0 || allowOrigins.includes('*') || allowOrigins.includes(origin)) {
      allowOrigin = origin
    }
  }
  return {
    ...(allowOrigin ? { 'access-control-allow-origin': allowOrigin, vary: 'Origin' } : {}),
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization, Mcp-Session-Id',
    'access-control-expose-headers': 'Mcp-Session-Id',
  }
}

function readBufferedBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(new McpHttpConfigError('PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MiB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export async function startMuweaveMcpHttpServer(
  options: StartMuweaveMcpHttpServerOptions,
): Promise<StartedMuweaveMcpHttpServer> {
  const host = (options.host ?? '127.0.0.1').trim() || '127.0.0.1'
  const requestedPort = options.port ?? 3741
  const effectiveToken = (options.authToken ?? process.env.MUWEAVE_MCP_TOKEN ?? '').trim()
  const isLoopback = LOOPBACK_HOSTS.has(host)

  if (!isLoopback && !effectiveToken) {
    throw new McpHttpConfigError(
      'REMOTE_AUTH_TOKEN_REQUIRED',
      'REMOTE_AUTH_TOKEN_REQUIRED: binding MCP HTTP server to a non-loopback address requires authToken or MUWEAVE_MCP_TOKEN',
    )
  }

  const sseClients = new Set<ServerResponse>()
  const activeSessions = new Set<string>()
  const keepaliveMs = options.keepaliveMs ?? 25_000

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${host}`)
    const method = (req.method ?? 'GET').toUpperCase()
    const cors = corsHeaders(req, options.allowOrigins)

    // Unauthenticated health probe
    if (url.pathname === '/healthz' && method === 'GET') {
      const body = JSON.stringify({
        ok: true,
        protocol: 'mcp',
        transport: 'streamable-http',
        serverName: MCP_SERVER_NAME,
      })
      res.writeHead(200, {
        ...cors,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      })
      res.end(body)
      return
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { ...cors, 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found' } }))
      return
    }

    if (method === 'OPTIONS') {
      res.writeHead(204, cors)
      res.end()
      return
    }

    // Enforce Bearer auth whenever a token is configured.
    if (effectiveToken) {
      const presented = readBearerToken(req)
      if (!presented || !constantTimeTokenMatch(presented, effectiveToken)) {
        res.writeHead(401, {
          ...cors,
          'content-type': 'application/json; charset=utf-8',
          'www-authenticate': 'Bearer realm="muweave-dsh-mcp"',
        })
        res.end(JSON.stringify({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Valid Bearer token required' } }))
        return
      }
    }

    if (method === 'DELETE') {
      const sid = typeof req.headers['mcp-session-id'] === 'string' ? req.headers['mcp-session-id'] : ''
      if (sid) activeSessions.delete(sid)
      res.writeHead(204, cors)
      res.end()
      return
    }

    if (method === 'GET') {
      const sessionId =
        typeof req.headers['mcp-session-id'] === 'string' && req.headers['mcp-session-id'].trim()
          ? req.headers['mcp-session-id'].trim()
          : randomUUID()
      activeSessions.add(sessionId)
      res.writeHead(200, {
        ...cors,
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'mcp-session-id': sessionId,
      })
      res.write(': connected\n\n')
      sseClients.add(res)
      const timer = setInterval(() => {
        if (!res.writableEnded) res.write(': keepalive\n\n')
      }, keepaliveMs)
      req.on('close', () => {
        clearInterval(timer)
        sseClients.delete(res)
      })
      return
    }

    if (method === 'POST') {
      let rawBody: string
      try {
        rawBody = await readBufferedBody(req, MAX_BODY_BYTES)
      } catch (err) {
        const isTooLarge = err instanceof McpHttpConfigError && err.code === 'PAYLOAD_TOO_LARGE'
        res.writeHead(isTooLarge ? 413 : 400, { ...cors, 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: { code: isTooLarge ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST', message: 'Invalid request body' } }))
        return
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        res.writeHead(400, { ...cors, 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }))
        return
      }

      const sessionId =
        typeof req.headers['mcp-session-id'] === 'string' && req.headers['mcp-session-id'].trim()
          ? req.headers['mcp-session-id'].trim()
          : randomUUID()
      activeSessions.add(sessionId)

      const response = await options.server.handleJsonRpc(parsed)
      if (response === null) {
        res.writeHead(202, {
          ...cors,
          'mcp-session-id': sessionId,
          'cache-control': 'no-store',
        })
        res.end()
        return
      }

      res.writeHead(200, {
        ...cors,
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'mcp-session-id': sessionId,
      })
      res.end(JSON.stringify(response))
      return
    }

    res.writeHead(405, { ...cors, 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } }))
  })

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(requestedPort, host, () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  const addr = httpServer.address()
  const actualPort = typeof addr === 'object' && addr ? addr.port : requestedPort
  const hostDisplay = host.includes(':') ? `[${host}]` : host
  const url = `http://${hostDisplay}:${actualPort}/mcp`

  return {
    server: httpServer,
    host,
    port: actualPort,
    url,
    async close() {
      for (const client of sseClients) {
        try {
          client.end()
        } catch {
          /* ignore */
        }
      }
      sseClients.clear()
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve())
      })
    },
  }
}
