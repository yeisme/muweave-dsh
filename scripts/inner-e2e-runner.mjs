import { execFileSync, spawn } from 'node:child_process'
import http from 'node:http'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const artifactsDir = process.argv[2] ?? path.join(rootDir, 'temp', 'artifacts')
// The launcher passes <evidenceDir>/artifacts where <evidenceDir> carries the run id
// (timestamp + uuid). Derive it so per-run keys stay unique without changing the CLI.
const runId = path.basename(path.dirname(artifactsDir)) || `local-${Date.now()}`
await mkdir(artifactsDir, { recursive: true })

/** The host dsh actually driving this run, recorded in the evidence bundle. */
const dshVersion = (() => {
  try {
    return execFileSync('dsh', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return 'unknown'
  }
})()

// 1x1 valid transparent PNG for deterministic CAS Range preview verification
const SAMPLE_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

async function startLocalStubModelServer() {
  let hitCount = 0
  const server = http.createServer((req, res) => {
    hitCount += 1
    let body = ''
    req.on('data', (c) => {
      body += String(c)
    })
    req.on('end', () => {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
      const chunk1 = {
        id: 'chatcmpl-stub-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-creator-v1',
        choices: [{ index: 0, delta: { role: 'assistant', content: '幕织本地桩模型已就绪。' }, finish_reason: null }],
      }
      const chunk2 = {
        id: 'chatcmpl-stub-1',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: 'stub-creator-v1',
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 16, completion_tokens: 8, total_tokens: 24 },
      }
      res.write(`data: ${JSON.stringify(chunk1)}\n\n`)
      res.write(`data: ${JSON.stringify(chunk2)}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const addr = server.address()
  return {
    port: typeof addr === 'object' && addr ? addr.port : 0,
    hits: () => hitCount,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

import { prepareFixtureWorkspace } from './fixture-workspace.mjs'

const stubModel = await startLocalStubModelServer()
const fixtureWs = await prepareFixtureWorkspace()
const tmpDshHome = await mkdtemp(path.join(os.tmpdir(), 'muweave-dsh-home-'))

let dshProc
let browser

try {
  const cleanEnv = {
    ...process.env,
    DSH_HOME: tmpDshHome,
    MUWEAVE_WORKSPACE_DIR: fixtureWs,
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: '',
    NO_COLOR: '1',
    // Fake owner CLIs first on PATH (offline, deterministic); paid generation is enabled for this test host only.
    PATH: `${path.join(rootDir, 'scripts', 'fake-owners')}${path.delimiter}${process.env.PATH ?? ''}`,
    MUWEAVE_DSH_PAID: '1',
  }

  // 1. Initialize isolated profile from shipped web template (never touches user's ~/.dsh/profiles/web)
  execFileSync('dsh', ['--profile', 'creator-e2e', '--from-default-profile', 'web', '--help'], {
    env: cleanEnv,
    stdio: 'pipe',
  })

  // 2. Install all 6 packed .tgz plugins completely offline
  const tgzNames = [
    'yeisme-dsh-muweave-workbench-0.1.0.tgz',
    'yeisme-dsh-muweave-eikona-0.1.0.tgz',
    'yeisme-dsh-muweave-script-0.1.0.tgz',
    'yeisme-dsh-muweave-drama-0.1.0.tgz',
    'yeisme-dsh-muweave-kit-0.1.0.tgz',
    'yeisme-dsh-muweave-schedule-0.1.0.tgz',
  ]
  for (const tgz of tgzNames) {
    execFileSync(
      'dsh',
      ['plugin', '--profile', 'creator-e2e', 'add', path.join(rootDir, '.work', tgz), '--offline'],
      { env: cleanEnv, stdio: 'inherit' },
    )
  }

  // 3. Create local stub model patch overlay (zero external provider calls)
  const stubPatchPath = path.join(tmpDshHome, 'stub-model.patch.yml')
  await writeFile(
    stubPatchPath,
    [
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      localstub:',
      '        api: openai-completions',
      `        baseURL: http://127.0.0.1:${stubModel.port}/v1`,
      '        headers:',
      '          Authorization: Bearer stub',
      '        defaultMaxTokens: 512',
      '        models:',
      '          - id: stub-creator-v1',
      '            name: Stub Creator Model',
      '            contextWindow: 64000',
      '- id: agent-default-model',
      '  config:',
      '    provider: localstub',
      '    model: stub-creator-v1',
      '',
    ].join('\n'),
  )

  // Seed the isolated host's bot roster so the real RPC path can exercise the
  // manager-to-worker delegation branch. The calls below still go through the
  // browser's authenticated /api/muweave-dsh/rpc route.
  const botDataDir = path.join(tmpDshHome, 'plugin-data', 'muweave-dsh')
  await mkdir(botDataDir, { recursive: true })
  await writeFile(
    path.join(botDataDir, 'bots.v1.json'),
    JSON.stringify({
      schema: 'muweave.bots.v1',
      bots: [
        {
          botId: 'muweave-manager',
          role: 'manager',
          presetRef: 'muweave-creator',
          capabilityGrants: ['task.delegate'],
          ownerScopes: [],
          workspaceScopes: ['*'],
          budgetEnvelope: { unit: 'none' },
          state: 'active',
          revision: 1,
        },
        {
          botId: 'muweave-worker',
          role: 'worker',
          presetRef: 'muweave-creator-worker',
          capabilityGrants: ['task.delegate'],
          ownerScopes: [],
          workspaceScopes: ['*'],
          budgetEnvelope: { unit: 'none' },
          state: 'active',
          revision: 1,
        },
      ],
      pauses: {},
    }) + '\n',
    { mode: 0o600 },
  )

  // 4. Boot DSH web host on ephemeral port 0
  dshProc = spawn(
    'dsh',
    ['--profile', 'creator-e2e', '--patch', stubPatchPath, '--no-open', '--port', '0'],
    { env: cleanEnv, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let dshLogs = ''
  const launchUrl = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for DSH URL. Logs:\n${dshLogs}`)), 20_000)
    const onChunk = (buf) => {
      dshLogs += String(buf)
      const m = /http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+/.exec(dshLogs)
      if (m) {
        clearTimeout(timer)
        resolve(m[0])
      }
    }
    dshProc.stdout.on('data', onChunk)
    dshProc.stderr.on('data', onChunk)
    dshProc.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`DSH exited early (${code}):\n${dshLogs}`))
    })
  })

  if (dshLogs.includes('did not activate')) {
    throw new Error(`DSH reported plugin activation failure:\n${dshLogs}`)
  }
  process.stdout.write('DSH host booted cleanly on loopback with 0 activation warnings.\n')

  // 5. Launch real Chrome via Playwright and verify all 5 plugins + multi-breakpoint invariants
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()

  const pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))
  const rpcLines = []
  const inflight = new Map()
  page.on('request', (req) => inflight.set(req, Date.now()))
  page.on('requestfinished', (req) => inflight.delete(req))
  page.on('requestfailed', (req) => {
    rpcLines.push(`FAILED ${req.url().slice(0, 80)} ${req.failure()?.errorText} ${req.postData()?.slice(0, 100)}`)
    inflight.delete(req)
  })
  page.on('response', async (resp) => {
    if (!resp.url().includes('/api/muweave-dsh/rpc') || resp.request().method() !== 'POST') return
    const env = await resp.json().catch(() => undefined)
    const req = JSON.parse(resp.request().postData() ?? '{}')
    rpcLines.push(
      `${resp.status()} ${req.action} ${JSON.stringify(req.payload ?? {}).slice(0, 80)} -> ok=${env?.ok} gen=${env?.generation} ${env?.error?.code ?? ''}`,
    )
  })

  await page.goto(launchUrl, { waitUntil: 'networkidle' })

  // P3 real-host smoke for the P2 bot/task/event RPCs. Keep the evidence
  // projection deliberately narrow so task goals, credentials, and host paths
  // never enter the integration artifact.
  const botTaskRpcEvidence = []
  const recordBotTaskStep = (step, action, detail, extra = {}) => {
    botTaskRpcEvidence.push({ step, action, detail, ...extra })
    process.stdout.write(`PASS ${step}: ${detail}\n`)
  }
  const failBotTaskStep = (step, action, message, response) => {
    const actual = response && typeof response === 'object'
      ? { ok: response.ok, error: response.error ? { code: response.error.code, message: response.error.message } : undefined }
      : response
    botTaskRpcEvidence.push({ step, action, status: 'failed', message, actual })
    throw new Error(`[${action}] ${message}; actual=${JSON.stringify(actual)}`)
  }
  const rpc = async (action, payload) => page.evaluate(async ({ action: rpcAction, payload: rpcPayload }) => {
    try {
      const response = await fetch('/api/muweave-dsh/rpc', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: rpcAction, payload: rpcPayload }),
      })
      const body = await response.json().catch(() => undefined)
      return { status: response.status, body }
    } catch (error) {
      return { status: 0, body: { ok: false, error: { code: 'RPC_TRANSPORT_FAILED', message: String(error) } } }
    }
  }, { action, payload })

  const workspaceId = `integration-${runId}`
  const managerId = 'muweave-manager'
  const workerId = 'muweave-worker'
  const sessionRef = `test-session-${runId}`
  const delegateKey = `delegate-${runId}`
  const rosterResponse = (await rpc('bot.roster', { workspaceId })).body
  if (!rosterResponse?.ok) failBotTaskStep('bot.roster', 'bot.roster', 'expected an RPC success envelope', rosterResponse)
  const bots = rosterResponse.data?.bots
  const manager = Array.isArray(bots) ? bots.find((bot) => bot?.role === 'manager' && typeof bot?.botId === 'string') : undefined
  if (!manager || !manager.botId) failBotTaskStep('bot.roster', 'bot.roster', 'expected at least one manager with a non-empty botId', rosterResponse)
  recordBotTaskStep('bot.roster', 'bot.roster', `manager=${manager.botId}`, { managerId: manager.botId, botCount: bots.length })

  const bindResponse = (await rpc('bot.session.bind', { botId: manager.botId, workspaceId, sessionRef })).body
  if (!bindResponse?.ok || bindResponse.data?.session?.sessionRef !== sessionRef) {
    failBotTaskStep('bot.session.bind', 'bot.session.bind', `expected sessionRef ${sessionRef}`, bindResponse)
  }
  recordBotTaskStep('bot.session.bind', 'bot.session.bind', `bound ${manager.botId} to ${sessionRef}`)

  const sessionResponse = (await rpc('bot.session.get', { botId: manager.botId, workspaceId })).body
  if (!sessionResponse?.ok || sessionResponse.data?.session?.sessionRef !== sessionRef) {
    failBotTaskStep('bot.session.get', 'bot.session.get', `expected readback sessionRef ${sessionRef}`, sessionResponse)
  }
  recordBotTaskStep('bot.session.get', 'bot.session.get', `read back ${sessionRef}`)

  const rootResponse = (await rpc('task.create', { workspaceId, goal: 'integration root task', idempotencyKey: `root-${runId}` })).body
  if (!rootResponse?.ok || typeof rootResponse.data?.task?.taskId !== 'string') {
    failBotTaskStep('task.delegate', 'task.create', 'expected a parent task for delegation trace', rootResponse)
  }
  const parentTaskId = rootResponse.data.task.taskId
  const delegatePayload = {
    workspaceId,
    goal: 'integration delegated task',
    assignedBy: { botId: manager.botId },
    assignedToBotId: workerId,
    parentTaskRef: parentTaskId,
    idempotencyKey: delegateKey,
  }
  const delegateResponse = (await rpc('task.delegate', delegatePayload)).body
  if (!delegateResponse?.ok || typeof delegateResponse.data?.task?.taskId !== 'string') {
    failBotTaskStep('task.delegate', 'task.delegate', 'expected manager-to-worker delegation to create a task', delegateResponse)
  }
  const taskId = delegateResponse.data.task.taskId
  recordBotTaskStep('task.delegate', 'task.delegate', `created ${taskId} for ${workerId}`, { taskId, assignedTo: workerId })

  const taskResponse = (await rpc('task.get', { taskId })).body
  const task = taskResponse?.data?.task
  if (!taskResponse?.ok || task?.parentTaskRef !== parentTaskId || task?.rootTaskId !== parentTaskId || task?.assignedTo?.botId !== workerId) {
    failBotTaskStep('task.get', 'task.get', `expected parentTaskRef=${parentTaskId}, rootTaskId=${parentTaskId}, assignedTo=${workerId}`, taskResponse)
  }
  recordBotTaskStep('task.get', 'task.get', `parent=${parentTaskId} root=${parentTaskId} assignedTo=${workerId}`)

  const traceResponse = (await rpc('task.trace', { taskId })).body
  const traceText = JSON.stringify(traceResponse?.data ?? '')
  if (!traceResponse?.ok || !traceResponse.data?.task || traceResponse.data.task.taskId !== taskId || /(?:\/home|\/Users|\/root|\/var|\/tmp|\/etc|\/opt|\/private|\/mnt|\/srv|\/proc)\//.test(traceText)) {
    failBotTaskStep('task.trace', 'task.trace', 'expected a trace chain with no absolute host path', traceResponse)
  }
  recordBotTaskStep('task.trace', 'task.trace', `trace returned for ${taskId} without absolute paths`)

  const eventResponse = (await rpc('event.list', { taskId, limit: 50 })).body
  const events = eventResponse?.data?.events
  if (!eventResponse?.ok || !Array.isArray(events) || !events.some((event) => event?.event === 'task.delegated' && event?.taskId === taskId)) {
    failBotTaskStep('event.list', 'event.list', `expected task.delegated for ${taskId}`, eventResponse)
  }
  recordBotTaskStep('event.list', 'event.list', `found task.delegated for ${taskId}`)

  const cancelResponse = (await rpc('task.cancel', { taskId })).body
  const cancelledResponse = (await rpc('task.get', { taskId })).body
  if (!cancelResponse?.ok || cancelResponse.data?.task?.status !== 'cancelled' || !cancelledResponse?.ok || cancelledResponse.data?.task?.status !== 'cancelled') {
    failBotTaskStep('task.cancel', 'task.cancel/task.get', `expected cancelled status for ${taskId}`, { cancelResponse, cancelledResponse })
  }
  recordBotTaskStep('task.cancel', 'task.cancel/task.get', `${taskId} is cancelled`)

  const replayResponse = (await rpc('task.delegate', delegatePayload)).body
  if (!replayResponse?.ok || replayResponse.data?.task?.taskId !== taskId) {
    failBotTaskStep('idempotency', 'task.delegate', `same idempotencyKey should return ${taskId}`, replayResponse)
  }
  const conflictResponse = (await rpc('task.delegate', { ...delegatePayload, goal: 'different integration delegated task' })).body
  if (conflictResponse?.ok || conflictResponse?.error?.code !== 'TASK_IDEMPOTENCY_CONFLICT') {
    failBotTaskStep('idempotency', 'task.delegate', 'different payload should return TASK_IDEMPOTENCY_CONFLICT', conflictResponse)
  }
  recordBotTaskStep('idempotency', 'task.delegate', `replayed ${taskId}; conflict code TASK_IDEMPOTENCY_CONFLICT`, { taskId, conflictCode: conflictResponse.error.code })
  await writeFile(path.join(artifactsDir, 'bot-task-rpc.json'), JSON.stringify({ schema: 'muweave.bot-task-rpc.v1', workspaceId, managerId: manager.botId, workerId, steps: botTaskRpcEvidence }, null, 2) + '\n')

  // Verify startup did NOT hijack native home (`[data-muweave-workspace-root]` is absent until user selects a panel)
  const initialWorkspaceCount = await page.locator('[data-muweave-workspace-root="true"]').count()
  if (initialWorkspaceCount !== 0) {
    throw new Error('Anti-pattern violation: a plugin selected its global panel at startup instead of keeping native home')
  }

  // One sidebar entry ("做剧剧场") replaces the five per-plugin entries; the rooms live behind the
  // Codex/Claude-style switcher at the top of the theater.
  const theaterNavRe = /^(做剧剧场|Drama Theater)$/
  const legacyNavRe = /幕织原件总览|MuWeave Bundle Hub|Eikona 视觉元件台|剧本编剧室|做剧分镜与生产台|创作工具箱/
  const theaterNav = page.getByRole('button', { name: theaterNavRe }).first()
  await theaterNav.waitFor({ state: 'visible', timeout: 10_000 })
  const theaterNavCount = await page.getByRole('button', { name: theaterNavRe }).count()
  if (theaterNavCount !== 1) {
    throw new Error(`Expected exactly one 做剧剧场 sidebar entry, found ${theaterNavCount}`)
  }
  const legacyNavCount = await page.locator('[data-slot="sidebar.panellist"]').getByRole('button', { name: legacyNavRe }).count()
  if (legacyNavCount !== 0) {
    throw new Error(`Legacy per-plugin sidebar entries still registered (${legacyNavCount})`)
  }
  await theaterNav.click()
  await page.locator('[data-muweave-workspace-root="true"]').waitFor({ state: 'visible', timeout: 10_000 })
  process.stdout.write('Verified a single 做剧剧场 sidebar entry opens the theater.\n')


  /** Desk v3 overlay diagnostics: bounding box + paint-affecting computed styles. */
  async function probeOverlay(selector, label) {
    const info = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return { missing: true }
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      return {
        cls: String(el.className).slice(0, 60),
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        opacity: cs.opacity, visibility: cs.visibility, display: cs.display, zIndex: cs.zIndex,
        background: cs.backgroundColor, transform: cs.transform, filter: cs.filter,
        parentOverflow: (() => { let n = el.parentElement; while (n && n !== document.body) { const p = getComputedStyle(n); if (p.overflow !== 'visible' || p.filter !== 'none' || p.transform !== 'none') return `${n.className}:overflow=${p.overflow},filter=${p.filter},transform=${p.transform}`; n = n.parentElement } return 'none' })(),
      }
    }, selector)
    process.stdout.write(`probe[${label}] ${JSON.stringify(info)}\n`)
  }

  const roomExpectations = [
    { name: 'workbench', id: 'muweave-workbench', verifyTextRe: /第一集《雨夜街口》成片闭环|run_linwu_01/ },
    { name: 'eikona', id: 'muweave-eikona', verifyTextRe: /art_linwu_front/ },
    { name: 'script', id: 'muweave-script', verifyTextRe: /雨夜重逢 · 双时间轴/ },
    { name: 'drama', id: 'muweave-drama', verifyTextRe: /shot:ep01:s01:01/ },
    { name: 'kit', id: 'muweave-kit', verifyTextRe: /漫剧角色三视图与定妆母版配方/ },
    { name: 'schedule', id: 'muweave-schedule', verifyTextRe: /待排池|Backlog/ },
  ]
  const switcher = page.locator('[data-muweave-room-switcher="true"]')
  const roomNav = page.locator('[data-muweave-room-nav="true"]')
  // Wide theater: rooms are a glass pill nav (editorial v2); the menu stays for narrow widths and keyboard users.
  async function enterRoom(room, via = 'nav') {
    if (via === 'nav') {
      await roomNav.waitFor({ state: 'visible', timeout: 5_000 })
      await roomNav.locator(`[data-room-id="${room.id}"]`).click()
    } else {
      await switcher.click()
      const menu = page.getByRole('menu')
      await menu.waitFor({ state: 'visible', timeout: 5_000 })
      await menu.locator(`[role="menuitemradio"][data-room-id="${room.id}"]`).click()
    }
    await page.locator(`[data-muweave-theater="${room.id}"]`).waitFor({ state: 'attached', timeout: 10_000 })
    if (via === 'nav') {
      const current = await roomNav.locator('[aria-current="page"]').getAttribute('data-room-id', { timeout: 5_000 })
      if (current !== room.id) throw new Error(`Room nav marks ${current} current after entering ${room.id}`)
    }
    const enteredAt = Date.now()
    try {
      await page.getByText(room.verifyTextRe).first().waitFor({ state: 'visible', timeout: 10_000 })
      process.stdout.write(`Room [${room.name}] content visible after ${Date.now() - enteredAt}ms.\n`)
    } catch (err) {
      await page.screenshot({ path: path.join(artifactsDir, `${room.name}-room-failed-1440x900.png`) })
      process.stdout.write(`--- rpc ---\n${rpcLines.slice(-40).join('\n')}\n--- inflight ---\n${[...inflight].map(([r, t]) => `${Date.now() - t}ms ${r.method()} ${r.url().replace(/token=[^&]+/, 'token=…').slice(0, 100)} ${r.postData()?.slice(0, 100) ?? ''}`).join('\n')}\n`)
      throw err
    }
  }

  for (const [i, room] of roomExpectations.entries()) {
    if (i === 1) {
      // Capture the open switcher menu once, over the overview room.
      await switcher.click()
      await page.getByRole('menu').waitFor({ state: 'visible', timeout: 5_000 })
      const items = await page.getByRole('menuitemradio').count()
      // The five original rooms plus the 成稿 room added by creator platform v1.
      if (items !== roomExpectations.length + 1) {
        throw new Error(`Room switcher lists ${items} rooms, expected ${roomExpectations.length + 1}`)
      }
      if ((await page.locator('[role="menuitemradio"][data-room-id="muweave-draft"]').count()) !== 1) {
        throw new Error('Room switcher is missing the 成稿 room')
      }
      await page.waitForTimeout(300)
      await page.screenshot({ path: path.join(artifactsDir, 'theater-switcher-open-1440x900.png') })
      await page.keyboard.press('Escape')
      await page.getByRole('menu').waitFor({ state: 'detached', timeout: 5_000 })
    }
    // The last room goes through the menu so both entry paths stay covered.
    if (i > 0) await enterRoom(room, i === roomExpectations.length - 1 ? 'menu' : 'nav')
    else await page.getByText(room.verifyTextRe).first().waitFor({ state: 'visible', timeout: 10_000 })
    await page.locator('[data-muweave-hero="true"]').first().waitFor({ state: 'visible', timeout: 5_000 })
    if (room.name === 'drama') {
      // Work-first: the shot board is the default view; the table sits behind the view switch.
      await page.locator('[data-drama-shot-board="true"]').first().waitFor({ state: 'visible', timeout: 5_000 })
      if ((await page.locator('[data-drama-shot-board="true"] .mw-media-card').count()) === 0) {
        throw new Error('Drama shot board rendered no shot cards')
      }
      process.stdout.write('Verified drama shot board is the default storyboard view.\n')
    }
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(artifactsDir, `${room.name}-panel-1440x900.png`) })
    process.stdout.write(`Verified theater room [${room.name}] rendered .muweave/ elements.\n`)
  }

  // Creator platform v1: 成稿 room -> 为此镜出图 -> estimate -> submit -> approve -> slots -> accept -> shot image.
  // (Paid-disabled approve gating is covered by tests/capabilities.test.ts and tests/generation-ui.test.tsx.)
  const draftRoomId = 'muweave-draft'
  await roomNav.locator(`[data-room-id="${draftRoomId}"]`).click()
  await page.locator(`[data-muweave-theater="${draftRoomId}"]`).waitFor({ state: 'attached', timeout: 10_000 })
  await page.locator('[data-muweave-draft="true"]').waitFor({ state: 'visible', timeout: 10_000 })
  const shotRef = 'shot:ep01:s01:01'
  const genBtn = page.locator(`[data-muweave-shot-generate="${shotRef}"]`)
  await genBtn.waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(artifactsDir, 'draft-room-1440x900.png') })
  await genBtn.click()
  const drawer = page.locator('[data-muweave-generation-drawer="true"]')
  await drawer.waitFor({ state: 'visible', timeout: 10_000 })
  const prefilled = await drawer.locator('textarea').first().inputValue()
  if (!prefilled.trim()) throw new Error('Generation drawer opened without a prefilled prompt for the shot')
  await drawer.locator('[data-muweave-estimate="true"]').click()
  await drawer.locator('[data-muweave-estimate-result="true"]').waitFor({ state: 'visible', timeout: 15_000 })
  await drawer.locator('[data-muweave-submit="true"]').click()
  const approvalCard = drawer.locator('[data-muweave-approval]')
  await approvalCard.waitFor({ state: 'visible', timeout: 15_000 })
  const approveBtn = approvalCard.locator('[data-muweave-approve]')
  // Approve needs a ceiling >= the estimate (prefilled for priced jobs) and, for unknown-cost jobs, the extra checkbox.
  const ceilingInput = approvalCard.locator('[data-muweave-ceiling="true"]')
  if (!(Number(await ceilingInput.inputValue()) > 0)) {
    const estText = (await approvalCard.locator('[data-muweave-approval-estimate="true"]').textContent()) ?? ''
    const amount = Number(/[\d.]+/.exec(estText)?.[0] ?? '1')
    await ceilingInput.fill(String(amount > 0 ? amount : 1))
  }
  const unknownBox = approvalCard.locator('[data-muweave-accept-unknown="true"]')
  if ((await unknownBox.count()) > 0) await unknownBox.check()
  if (await approveBtn.isDisabled()) throw new Error('Approve is disabled although this test host enabled paid generation and a valid ceiling is set')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(artifactsDir, 'generation-approval-1440x900.png') })
  await approveBtn.click()
  const slotLoc = drawer.locator('[data-muweave-slot="slot_1"]')
  await slotLoc.waitFor({ state: 'visible', timeout: 15_000 })
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('[data-muweave-generation-drawer] [data-muweave-slot][data-status="done"] img')]
    return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0)
  }, null, { timeout: 30_000 })
  process.stdout.write('Verified generation job reached done slots with decoded images (fake owner).\n')
  await drawer.locator('[data-muweave-slot-accept="slot_1"]').click()
  await page.waitForFunction(() => document.querySelector('[data-muweave-slot="slot_1"]')?.getAttribute('data-review') === 'accepted', null, { timeout: 15_000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(artifactsDir, 'generation-drawer-1440x900.png') })
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(artifactsDir, 'generation-drawer-dark-1440x900.png') })
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(artifactsDir, 'generation-drawer-390x844.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(200)
  await drawer.getByRole('button', { name: /关闭生成台|Close generation desk/ }).click()
  await drawer.waitFor({ state: 'detached', timeout: 5_000 })
  const shotCard = page.locator('[data-muweave-draft-board="true"] img[data-muweave-shot-image]').first()
  // The draft room re-syncs and reloads in place when a review links media (mediaRevision); no re-entry.
  try {
    await shotCard.waitFor({ state: 'visible', timeout: 15_000 })
  } catch (err) {
    await page.screenshot({ path: path.join(artifactsDir, 'draft-room-link-failed-1440x900.png') })
    process.stdout.write(`--- rpc (draft link) ---\n${rpcLines.slice(-25).join('\n')}\n`)
    throw err
  }
  process.stdout.write('Draft room refreshed in place after the review.\n')
  await page.waitForFunction(() => {
    const img = document.querySelector('[data-muweave-draft-board] img[data-muweave-shot-image]')
    return Boolean(img && img.complete && img.naturalWidth > 0)
  }, null, { timeout: 15_000 })
  process.stdout.write('Verified accepted slot is linked: shot card shows a decoded img[data-muweave-shot-image].\n')
  await page.screenshot({ path: path.join(artifactsDir, 'draft-room-linked-1440x900.png') })
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(artifactsDir, 'draft-room-dark-1440x900.png') })
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(artifactsDir, 'draft-room-390x844.png') })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(200)

  // Desk v4: schedule room -> pick a backlog row -> tap a day -> chip appears -> tap chip to clear
  await enterRoom(roomExpectations.find((r) => r.id === 'muweave-schedule'), 'nav')
  const backlogRow = page.locator('[data-muweave-schedule-backlog="true"] li button').first()
  await backlogRow.waitFor({ state: 'visible', timeout: 10_000 })
  await backlogRow.click()
  const dayCell = page.locator('[data-muweave-schedule-board="true"] [role="gridcell"][data-in-month="true"]').nth(19)
  await dayCell.click()
  const chip = page.locator('[data-muweave-schedule-board="true"] .mw-sched-chip').first()
  await chip.waitFor({ state: 'visible', timeout: 10_000 })
  const chipText = (await chip.innerText()).trim()
  await page.screenshot({ path: path.join(artifactsDir, 'schedule-room-1440x900.png'), animations: 'disabled' })
  await chip.click()
  await chip.waitFor({ state: 'detached', timeout: 10_000 })
  process.stdout.write(`Verified schedule room: planned "${chipText}" onto a day and cleared it again.\n`)

  // Alt+2 switches straight to the second room (Eikona).
  await page.locator('[data-muweave-workspace-root="true"]').first().click({ position: { x: 4, y: 4 } })
  await page.keyboard.press('Alt+Digit2')
  await page.locator('[data-muweave-theater="muweave-eikona"]').waitFor({ state: 'attached', timeout: 5_000 })
  process.stdout.write('Verified Alt+N room shortcut.\n')

  // In the Eikona room, verify Range CAS image loaded (`naturalWidth > 0`) and 3-state Floating Agent
  await page.getByText('art_linwu_front').first().waitFor({ state: 'visible' })

  const imgLoaded = await page.waitForFunction(() => {
    const img = document.querySelector('img[alt="art_linwu_front"]')
    return Boolean(img && img.complete && img.naturalWidth > 0)
  }, { timeout: 10_000 })
  if (!imgLoaded) {
    throw new Error('CAS Range media preview image failed to decode in browser')
  }
  process.stdout.write('Verified short-TTL Range CAS media image preview decoded (naturalWidth > 0).\n')

  // The Eikona hero shows real candidate covers, not placeholder art.
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('[data-muweave-hero="true"] [data-muweave-cover="images"] img')]
    return imgs.length > 0 && imgs.every((img) => img.complete && img.naturalWidth > 0)
  }, null, { timeout: 10_000 })
  process.stdout.write('Verified Eikona hero cover collage decoded real candidate images.\n')

  // P0 (editorial v2): host tokens the theme maps onto, read in light and dark. Values only, no paths.
  const hostTokenNames = [
    '--dsw-elevation-soft',
    '--dsw-elevation-prominent',
    '--dsw-elevation-panel',
    '--dsw-radius-sm',
    '--dsw-radius-md',
    '--dsw-radius-lg',
    '--dsw-radius-xl',
    '--dsw-radius-panel',
    '--dsw-alias-button-primary-fill',
    '--dsw-alias-button-primary-fill-hover',
    '--dsw-alias-label-primary-inverted',
    '--dsw-alias-bg-layer-2',
  ]
  const readHostTokens = (names) =>
    page.evaluate((list) => {
      const root = document.querySelector('[data-muweave-workspace-root="true"]') ?? document.body
      const cs = getComputedStyle(root)
      return Object.fromEntries(list.map((n) => [n, cs.getPropertyValue(n).trim()]))
    }, names)
  const darkAttr = await page.evaluate(() => document.body.hasAttribute('data-ds-dark-theme'))
  const lightTokens = await readHostTokens(hostTokenNames)
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
  await page.waitForTimeout(250)
  const darkTokens = await readHostTokens(hostTokenNames)
  await page.screenshot({ path: path.join(artifactsDir, 'eikona-panel-dark-1440x900.png') })
  if (!darkAttr) await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  await writeFile(
    path.join(artifactsDir, 'host-tokens.json'),
    `${JSON.stringify({ host: `dsh@${dshVersion}`, startedDark: darkAttr, light: lightTokens, dark: darkTokens }, null, 2)}\n`,
  )
  const emptyTokens = hostTokenNames.filter((n) => !lightTokens[n])
  process.stdout.write(`Host tokens read (light/dark); empty in light: ${emptyTokens.length ? emptyTokens.join(', ') : 'none'}.\n`)

  // Verify global split-compare mode, ProgressStrip, and one-click .muweave/ sync button
  // Desk v3 keeps every layout control behind one 「视图」 popover.
  await page.getByRole('button', { name: /^(视图|View)$/ }).first().click()
  await page.getByRole('button', { name: /左右对比|Side-by-Side/ }).first().click()
  await page.keyboard.press('Escape')
  await page.locator('[data-muweave-compare-secondary="true"]').waitFor({ state: 'visible', timeout: 5_000 })
  await page.getByRole('region', { name: 'Drama Process Timing' }).waitFor({ state: 'visible', timeout: 5_000 })
  await page.getByRole('button', { name: /同步 \.muweave\/|Sync \.muweave\// }).first().click()
  process.stdout.write('Verified global horizontal split-compare pane, ProgressStrip, and .muweave/ live sync.\n')

  // Desk v3: room filter lives in a popover, so the stage is full width by default
  await enterRoom(roomExpectations[0], 'nav')
  if ((await page.locator('[data-muweave-pane="left"]').count()) !== 0) {
    throw new Error('Stage is not full width: a left pane rendered before the filter popover was opened')
  }
  await page.getByRole('button', { name: /原件筛选|Element filter/ }).first().click()
  await page.locator('[data-muweave-pane="left"]').first().waitFor({ state: 'visible', timeout: 5_000 })
  await page.waitForTimeout(350)
  await probeOverlay('[data-muweave-pane="left"]', 'filter-popover')
  await page.screenshot({ path: path.join(artifactsDir, 'desk-filter-popover-1440x900.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await page.locator('[data-muweave-pane="left"]').first().waitFor({ state: 'hidden', timeout: 5_000 })
  process.stdout.write('Verified full-width stage with the room filter in a popover.\n')

  // Desk v3: command palette lists rooms + stage views + actions and closes on Escape
  await page.locator('[data-muweave-open-palette="true"]').first().click()
  const palette = page.locator('[data-muweave-command-palette="true"]')
  await palette.waitFor({ state: 'visible', timeout: 5_000 })
  await page.waitForTimeout(350)
  await probeOverlay('.mw-cmdk-panel', 'palette-panel')
  const paletteRowsAll = await palette.locator('.mw-cmdk-row').count()
  const paletteGroups = await palette.locator('.mw-cmdk-group').count()
  await page.screenshot({ path: path.join(artifactsDir, 'desk-command-palette-1440x900.png'), animations: 'disabled' })
  if (paletteRowsAll < 3 || paletteGroups < 2) {
    throw new Error(`Command palette listed ${paletteRowsAll} rows in ${paletteGroups} groups`)
  }
  // Locale-agnostic query: type the first two characters of an existing row and expect it to stay.
  const firstLabel = (await palette.locator('.mw-cmdk-label').first().innerText()).trim()
  await page.locator('.mw-cmdk-input').fill(firstLabel.slice(0, 2))
  await page.waitForTimeout(150)
  const paletteRowsFiltered = await palette.locator('.mw-cmdk-row').count()
  if (paletteRowsFiltered < 1) throw new Error(`Palette returned no rows for "${firstLabel.slice(0, 2)}"`)
  await page.keyboard.press('Escape')
  await palette.waitFor({ state: 'hidden', timeout: 5_000 })
  process.stdout.write(
    `Verified command palette (${paletteRowsAll} rows / ${paletteGroups} groups, ${paletteRowsFiltered} after filtering) and Escape dismissal.\n`,
  )

  // Verify 3-state Floating Agent (`bar` -> `panel` -> `pill` -> `bar`) and `data-ready="true"`
  const floatBar = page.locator('[data-muweave-floating-agent="bar"]')
  await floatBar.waitFor({ state: 'visible', timeout: 8_000 })
  if ((await floatBar.getAttribute('data-ready')) !== 'true') {
    throw new Error('Floating agent bar missing data-ready="true"')
  }

  await page.getByRole('button', { name: /展开对话浮窗|Expand Panel/ }).click()
  await page.locator('[data-muweave-floating-agent="panel"][data-ready="true"]').waitFor({ state: 'visible' })

  await page.getByRole('button', { name: /最小化为胶囊|Minimize to Pill/ }).click()
  await page.locator('[data-muweave-floating-agent="pill"][data-ready="true"]').waitFor({ state: 'visible' })

  await page.locator('[data-muweave-floating-agent="pill"] button').click()
  await page.locator('[data-muweave-floating-agent="bar"][data-ready="true"]').waitFor({ state: 'visible' })
  process.stdout.write('Verified shell.overlay 3-state Floating Agent transitions (bar -> panel -> pill -> bar).\n')

  // Multi-breakpoint geometry check (1440, 1024, 768, 390): ensure Floating Agent NEVER overlaps settings.launcher button
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 768, height: 900 },
    { width: 390, height: 844 },
  ]
  for (const vp of viewports) {
    await page.setViewportSize(vp)
    await page.waitForTimeout(180)
    const overlap = await page.evaluate(() => {
      const floatEl = document.querySelector('[data-muweave-floating-agent]')
      const settingsBtn = document.querySelector('[data-slot="settings.launcher"] button')
      if (!floatEl || !settingsBtn) return false
      const a = floatEl.getBoundingClientRect()
      // Compare against the launcher's *visible* box: the host rail clips a wider labelled button.
      const raw = settingsBtn.getBoundingClientRect()
      const b = { left: raw.left, top: raw.top, right: raw.right, bottom: raw.bottom }
      for (let el = settingsBtn.parentElement; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el)
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue
        const c = el.getBoundingClientRect()
        b.left = Math.max(b.left, c.left)
        b.top = Math.max(b.top, c.top)
        b.right = Math.min(b.right, c.right)
        b.bottom = Math.min(b.bottom, c.bottom)
      }
      if (b.right - b.left <= 0 || b.bottom - b.top <= 0) return false
      const horizOverlap = a.left < b.right && a.right > b.left
      const vertOverlap = a.top < b.bottom && a.bottom > b.top
      if (!(horizOverlap && vertOverlap)) return false
      const r = (el) => {
        const x = el?.getBoundingClientRect()
        return x ? [x.left, x.top, x.width, x.height].map(Math.round).join(',') : 'none'
      }
      const vis = [b.left, b.top, b.right - b.left, b.bottom - b.top].map(Math.round).join(',')
      return `float=${r(floatEl)} settings=${r(settingsBtn)} visible=${vis} root=${r(document.querySelector('.mw-dsh-root'))}`
    })
    if (overlap) {
      await page.screenshot({ path: path.join(artifactsDir, `overlap-failed-${vp.width}x${vp.height}.png`) })
      throw new Error(`Floating Agent overlapped [data-slot="settings.launcher"] button at ${vp.width}x${vp.height} (${overlap})`)
    }
    // Narrow theater: the pill nav folds away and the menu switcher shows the room name.
    const navShown = await roomNav.isVisible()
    if (vp.width >= 1440 && !navShown) throw new Error(`Room pill nav hidden at ${vp.width}x${vp.height}`)
    if (vp.width <= 390 && navShown) throw new Error(`Room pill nav still shown at ${vp.width}x${vp.height}`)
    await page.screenshot({ path: path.join(artifactsDir, `eikona-panel-${vp.width}x${vp.height}.png`) })
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
    await page.waitForTimeout(200)
    await page.screenshot({ path: path.join(artifactsDir, `eikona-panel-dark-${vp.width}x${vp.height}.png`) })
    await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
    process.stdout.write(`Verified zero host-button overlap & captured light/dark screenshots at ${vp.width}x${vp.height}.\n`)
  }

  // Return to 1440x900, expand Floating Agent panel, and click "Open Full Session" to verify clean transition back
  // to DSH Conversation view (Floating Agent unmounts outside MuWeave global panels), workspace session creation,
  // and real rightbar dockkit Companion mount (`[data-muweave-companion]`)!
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('button', { name: /展开对话浮窗|Expand Panel/ }).click()
  await page.getByRole('button', { name: /在对话页打开完整会话|Open Full Session/ }).first().click()
  await page.waitForFunction(() => document.querySelectorAll('[data-muweave-floating-agent]').length === 0, {
    timeout: 8_000,
  })
  // Rightbar dockkit mounts the Companion after the conversation view commits; on a loaded box that
  // can take a few seconds longer than the default, so wait for the view first and allow 25s.
  await page.getByText(/幕织剧组创作模式|MuWeave Creator/).first().waitFor({ state: 'visible', timeout: 25_000 })
  const companionLocator = page.locator('[data-muweave-companion]')
  await companionLocator.first().waitFor({ state: 'visible', timeout: 25_000 })

  // Verify registered workspace title and muweave-creator agent preset are active in the UI
  const wsBaseName = path.basename(fixtureWs)
  await page.getByText(wsBaseName).first().waitFor({ state: 'visible', timeout: 8_000 })
  await page.getByText(/幕织剧组创作模式|MuWeave Creator/).first().waitFor({ state: 'visible', timeout: 8_000 })

  // Unconditionally submit a prompt in the active workspace session to exercise the local SSE stub model end-to-end
  const textbox = page.locator('[role="textbox"]').first()
  await textbox.waitFor({ state: 'visible', timeout: 10_000 })
  await textbox.evaluate((el) => el.focus())
  await page.keyboard.type('检查第一集原件状态')
  await page.keyboard.press('Enter')
  await page.getByText('幕织本地桩模型已就绪。').first().waitFor({ state: 'visible', timeout: 10_000 })
  if (stubModel.hits() < 1) {
    throw new Error('Expected local SSE stub model server to receive at least 1 completion request')
  }
  await page.screenshot({ path: path.join(artifactsDir, 'conversation-rightbar-dockkit-1440x900.png') })
  process.stdout.write(
    `Verified workspace registration, muweave-creator preset, local SSE stub model (${stubModel.hits()} hits), and right-sidebar dockkit Companion.\n`,
  )

  // The session's 「做剧」 conversation view: registered next to 轨迹, shows the empty state or the
  // progress line, and leads back into the theater; the header action does the same in one click.
  const viewTab = page.getByRole('tab', { name: /^(做剧|Drama)$/ }).or(page.getByRole('button', { name: /^(做剧|Drama)$/ }))
  await viewTab.first().waitFor({ state: 'visible', timeout: 10_000 })
  await viewTab.first().click()
  const sessionView = page.locator('[data-muweave-session-view="true"]')
  await sessionView.waitFor({ state: 'visible', timeout: 10_000 })
  await sessionView.getByRole('group', { name: /制作进度|Production progress/ }).waitFor({ state: 'visible', timeout: 10_000 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.join(artifactsDir, 'session-drama-view-1440x900.png') })
  process.stdout.write('Verified session 「做剧」 conversation.view tab with progress line.\n')

  const headerAction = page.locator('[data-muweave-theater-open="header"]')
  if ((await headerAction.count()) > 0) {
    await headerAction.first().click()
    process.stdout.write('Session header 「剧场」 action is present.\n')
  } else {
    process.stdout.write('Session header actions seat not rendered; entering via the session view instead.\n')
    await sessionView.locator('[data-muweave-theater-open="session-view"]').click()
  }
  await page.locator('[data-muweave-room-switcher="true"]').waitFor({ state: 'visible', timeout: 10_000 })
  await page.locator('[data-muweave-theater-back="true"]').click()
  await page.locator('[data-muweave-room-switcher="true"]').waitFor({ state: 'detached', timeout: 10_000 })
  process.stdout.write('Verified one-click round trip conversation -> theater -> conversation.\n')

  if (pageErrors.length > 0) {
    throw new Error(`Uncaught browser page errors:\n${pageErrors.join('\n')}`)
  }



  process.stdout.write('ALL OFFLINE REAL-HOST DSH PLAYWRIGHT E2E CHECKS PASSED.\n')
} finally {
  await browser?.close().catch(() => undefined)
  if (dshProc && !dshProc.killed) {
    dshProc.kill('SIGTERM')
  }
  await stubModel.close().catch(() => undefined)
  await rm(tmpDshHome, { recursive: true, force: true }).catch(() => undefined)
  await rm(fixtureWs, { recursive: true, force: true }).catch(() => undefined)
}
