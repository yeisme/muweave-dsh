#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBundleManifestFromDisk, renderAgentOutput, stripHostPaths } from '@yeisme/muweave-bundle'
import { runCapabilityDoctor } from './capabilities/doctor'
import type { CapabilityCatalogV1 } from './capability-protocol'
import { DemoSeedError, seedDemoWorkspace } from './demo-seed'
import { exportCanvasMermaid } from './canvas-board-store'
import { compileStage3dPrompt } from './stage3d-store'
import { exportDramaPortableBundle } from './drama-export'
import { createLocalMcpBridge, createMuweaveMcpServer, createRemoteMcpBridge, runStdioMcpServer } from './mcp/server'
import { startMuweaveMcpHttpServer } from './mcp/http'
import type {
  AudioMixConfigV1,
  CanvasBoardV1,
  ContinuityBibleV1,
  CustomAdapterViewV1,
  DramaExportResultV1,
  EpisodeCutOverrideV1,
  EpisodeQcReportV1,
  ProjectMigrationReportV1,
  ShotReviewBatchResultV1,
  ShotReviewImportResultV1,
  ShotReviewRecordV1,
  Stage3dScenesV1,
  WorkspaceSummaryView,
  WorkspaceTabsConfigV1,
} from './protocol'

interface ParsedArgs {
  positional: string[]
  flags: Record<string, string | boolean>
}

const BOOLEAN_FLAGS = new Set(['json', 'agent', 'force', 'help', 'h', 'capabilities', 'allow-private', 'restore', 'strict', 'allow-locked'])

function parseArgv(argv: readonly string[]): ParsedArgs {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!
    if (arg === '-h') {
      flags.help = true
      continue
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1)
      } else {
        const key = arg.slice(2)
        const next = argv[i + 1]
        if (!BOOLEAN_FLAGS.has(key) && next !== undefined && !next.startsWith('--')) {
          flags[key] = next
          i += 1
        } else {
          flags[key] = true
        }
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

function strFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

function numFlag(flags: Record<string, string | boolean>, key: string): number | undefined {
  const raw = strFlag(flags, key)
  if (raw === undefined) return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

const HELP_TEXT = `muweave — MuWeave DSH Creator CLI & MCP Server

Usage:
  muweave status [--workspace <dir>] [--json | --agent]
  muweave shots list [--scene <ref>] [--status <status>] [--missing <role>]
  muweave review set <shotRef> --status <status> [--note <text>] [--tags a,b] [--expected-revision <n>]
  muweave review batch (--file <path> | --items <json>)
  muweave review import <file.json> [--allow-locked]
  muweave export <cut_manifest_v1|cmx3600_edl|shotlist_csv|fcpxml_1_10|jianying_draft_v1|srt_subtitles|webvtt_subtitles|review_deck_html> [--episode <ref>] [--fps 24|25|30] [--aspect 9:16] [--out <file>] [--bundle-dir <dir>]
  muweave bible show
  muweave bible set [--title <text>] [--aspect <ratio>] [--lens <text>] [--lighting <text>] [--style <text>] [--disclosure <text>] [--guardrails a,b] [--expected-revision <rev>]
  muweave qc [--episode <ref>] [--strict]
  muweave tabs show | preset <default|director|writer|visual_3d|full_studio> | reset
  muweave canvas show | export-mermaid
  muweave stage3d show | export-prompts
  muweave audio show [--episode <ref>]
  muweave cut show [--episode <ref>]
  muweave cut reorder <episodeRef> <shot1,shot2,...>
  muweave cut trim <episodeRef> <shotRef> <seconds>
  muweave cut omit <episodeRef> <shotRef> [--restore]
  muweave cut reset <episodeRef>
  muweave adapters list
  muweave adapters add <adapterId> --protocol <openai_http|comfyui_http|cli_wrapper> --title <text> --kind <image|voice|video|sfx|music> [--endpoint <url>] [--binary <bin>] [--model <name>] [--auth-env <ENV_VAR>] [--price <usd>] [--allow-private]
  muweave adapters remove <adapterId>
  muweave adapters test <adapterId>
  muweave schedule list
  muweave schedule plan <ref> <YYYY-MM-DD> [--label <text>] [--kind <kind>] [--note <text>] [--project <id>]
  muweave schedule clear <ref>
  muweave diagnose [--project <id>]
  muweave migrate report
  muweave doctor --capabilities [--json | --agent]
  muweave bots list
  muweave bots pause <botId> [--expected-revision <n>]
  muweave bots resume <botId> [--expected-revision <n>]
  muweave tasks list
  muweave tasks trace <taskId>
  muweave tasks cancel <taskId>
  muweave demo [seed] [--force] [--episodes 1|2]
  muweave mcp [--transport stdio|http] [--host 127.0.0.1] [--port 3741] [--auth-token <tok>] [--host-url <url>]

Global flags:
  --workspace <dir>   Target workspace directory (defaults to cwd)
  --data-dir <dir>    Plugin data directory (defaults to ~/.dsh/plugin-data/muweave-dsh)
  --host-url <url>    Proxy RPC requests to a running DSH host instead of local direct mode
  --auth-token <tok>  Bearer token for remote HTTP MCP server or remote host proxy
  --json              Emit sanitized JSON output
  --agent             Emit AI-native spec_version=1.0 key=value output
`

export interface RunMuweaveCliIo {
  stdout?: (chunk: string) => void
  stderr?: (chunk: string) => void
}

export async function runMuweaveCli(
  argv: readonly string[],
  io: RunMuweaveCliIo = {},
): Promise<number> {
  const stdout = io.stdout ?? ((s) => process.stdout.write(s))
  const stderr = io.stderr ?? ((s) => process.stderr.write(s))
  const { positional, flags } = parseArgv(argv)
  const asJson = flags.json === true
  const asAgent = flags.agent === true

  const emit = (command: string, payload: Record<string, unknown>, humanText: string, ok = true): number => {
    const safePayload = stripHostPaths(payload)
    if (asAgent) {
      stdout(renderAgentOutput({ ok, ...safePayload }, command))
    } else if (asJson) {
      stdout(`${JSON.stringify({ ok, command, ...safePayload }, null, 2)}\n`)
    } else {
      stdout(humanText.endsWith('\n') ? humanText : `${humanText}\n`)
    }
    return ok ? 0 : 1
  }

  const emitError = (command: string, code: string, message: string): number => {
    const safeMsg = stripHostPaths(message)
    if (asAgent) {
      stdout(renderAgentOutput({ ok: false, error: { code, message: safeMsg } }, command))
    } else if (asJson) {
      stdout(`${JSON.stringify({ ok: false, command, error: { code, message: safeMsg } }, null, 2)}\n`)
    } else {
      stderr(`[${code}] ${safeMsg}\n`)
    }
    return 1
  }

  if (flags.help === true || positional.length === 0 || positional[0] === 'help') {
    stdout(HELP_TEXT)
    return 0
  }

  const cmd = positional[0]!
  const sub = positional[1]
  const workspaceDir = path.resolve(strFlag(flags, 'workspace') ?? process.cwd())
  const pluginDataDir = strFlag(flags, 'data-dir') ? path.resolve(strFlag(flags, 'data-dir')!) : undefined
  const hostUrl = strFlag(flags, 'host-url')
  const authToken = strFlag(flags, 'auth-token')

  // 1. Demo workspace seed
  if (cmd === 'demo') {
    if (sub && sub !== 'seed') {
      return emitError('demo', 'muweave/unknown_subcommand', `Unknown demo subcommand: ${sub}`)
    }
    try {
      const result = await seedDemoWorkspace(workspaceDir, {
        force: flags.force === true,
        pluginDataDir,
        episodes: numFlag(flags, 'episodes'),
      })
      return emit(
        'demo.seed',
        result as unknown as Record<string, unknown>,
        `Demo workspace ready: ${result.title} (${result.projectId}) — ${result.elementCount} elements, ${result.shotCount} shots, ${result.reviewCount} reviews, ${result.scheduleCount} scheduled.`,
      )
    } catch (err) {
      if (err instanceof DemoSeedError) return emitError('demo.seed', err.code, err.message)
      return emitError('demo.seed', 'muweave/demo_seed_failed', err instanceof Error ? err.message : 'Demo seed failed')
    }
  }

  // 2. MCP Server transport
  if (cmd === 'mcp') {
    const transport = (strFlag(flags, 'transport') ?? 'stdio').toLowerCase()
    const mcpServer = createMuweaveMcpServer({
      defaultWorkspaceDir: workspaceDir,
      pluginDataDir,
      hostUrl,
      authToken,
    })
    if (transport === 'stdio') {
      await runStdioMcpServer(mcpServer)
      mcpServer.dispose()
      return 0
    }
    if (transport === 'http') {
      const host = strFlag(flags, 'host') ?? '127.0.0.1'
      const port = numFlag(flags, 'port') ?? 3741
      try {
        const started = await startMuweaveMcpHttpServer({
          server: mcpServer,
          host,
          port,
          authToken,
        })
        stderr(`[muweave-dsh-mcp] Streamable HTTP listening on ${started.url}\n`)
        await new Promise<void>((resolve) => {
          const shutdown = () => {
            void started.close().finally(() => {
              mcpServer.dispose()
              resolve()
            })
          }
          process.once('SIGINT', shutdown)
          process.once('SIGTERM', shutdown)
        })
        return 0
      } catch (err) {
        mcpServer.dispose()
        const code = (err as { code?: string })?.code ?? 'MCP_HTTP_START_FAILED'
        return emitError('mcp.http', code, err instanceof Error ? err.message : 'Failed to start MCP HTTP server')
      }
    }
    mcpServer.dispose()
    return emitError('mcp', 'muweave/invalid_transport', `Unsupported transport: ${transport} (use stdio or http)`)
  }

  // 3. RPC-backed commands
  const bridge = hostUrl
    ? createRemoteMcpBridge({ hostUrl, authToken })
    : createLocalMcpBridge({ defaultWorkspaceDir: workspaceDir, pluginDataDir })

  try {
    if (cmd === 'status') {
      const [wsRes, bundleRes] = await Promise.all([
        bridge.call('workspace.list', {}),
        bridge.call('bundle.status', {}),
      ])
      if (!bundleRes.ok) return emitError('status', bundleRes.error.code, bundleRes.error.message)
      const data = bundleRes.data as {
        initialized: boolean
        workspace: { workspaceId: string; label: string; hasBundle: boolean }
        index?: { projectId: string; title: string; revision: number; counts?: { total: number } }
      }
      const workspaces = wsRes.ok ? (wsRes.data as { workspaces: unknown[] }).workspaces : []
      const human = data.initialized && data.index
        ? `Workspace ${data.workspace.workspaceId} (${data.workspace.label}) — ${data.index.title} [${data.index.projectId}] rev ${data.index.revision}, ${data.index.counts?.total ?? 0} elements`
        : `Workspace ${data.workspace.workspaceId} (${data.workspace.label}) — bundle not initialized (run "muweave demo seed" to try a sample project)`
      return emit('status', { workspaceCount: workspaces.length, ...data }, human)
    }

    if (cmd === 'shots' && sub === 'list') {
      const mcpServer = createMuweaveMcpServer({ bridge })
      const rpcRes = await mcpServer.handleJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'muweave_drama_shots_list',
          arguments: {
            ...(strFlag(flags, 'scene') ? { sceneRef: strFlag(flags, 'scene') } : {}),
            ...(strFlag(flags, 'status') ? { reviewStatus: strFlag(flags, 'status') } : {}),
            ...(strFlag(flags, 'missing') ? { missingRole: strFlag(flags, 'missing') } : {}),
          },
        },
      })
      const text = ((rpcRes?.result as { content?: Array<{ text?: string }>; isError?: boolean })?.content?.[0]?.text) ?? '{}'
      const parsed = JSON.parse(text) as { total?: number; shots?: Array<Record<string, unknown>>; error?: { code: string; message: string } }
      if (parsed.error) return emitError('shots.list', parsed.error.code, parsed.error.message)
      const shots = parsed.shots ?? []
      const lines = shots.map(
        (s) =>
          `#${String(s.order).padStart(2, '0')} ${s.shotRef} (${s.sceneRef}) [${s.reviewStatus}] ${((Number(s.plannedDurationMicros ?? 0)) / 1_000_000).toFixed(1)}s roles=${(s.rolesPresent as string[]).join(',') || 'none'}`,
      )
      return emit(
        'shots.list',
        { total: shots.length, shots },
        shots.length ? lines.join('\n') : 'No matching shots found.',
      )
    }

    if (cmd === 'review' && sub === 'set') {
      const shotRef = positional[2] ?? ''
      const status = strFlag(flags, 'status') ?? ''
      const tagsRaw = strFlag(flags, 'tags')
      const expectedRevision = numFlag(flags, 'expected-revision')
      const res = await bridge.call('drama.shot.review.set', {
        shotRef,
        status,
        ...(strFlag(flags, 'scene') ? { sceneRef: strFlag(flags, 'scene') } : {}),
        ...(strFlag(flags, 'note') !== undefined ? { note: strFlag(flags, 'note') } : {}),
        ...(tagsRaw ? { tags: tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) } : {}),
        ...(expectedRevision !== undefined ? { expectedRevision } : {}),
      })
      if (!res.ok) return emitError('review.set', res.error.code, res.error.message)
      const review = (res.data as { review: ShotReviewRecordV1 }).review
      return emit(
        'review.set',
        { review },
        `Saved review for ${review.shotRef}: ${review.status} (rev ${review.revision})`,
      )
    }

    if (cmd === 'review' && sub === 'batch') {
      let rawItems: unknown
      const fileFlag = strFlag(flags, 'file')
      const itemsFlag = strFlag(flags, 'items')
      if (fileFlag) {
        rawItems = JSON.parse(await readFile(path.resolve(fileFlag), 'utf8'))
      } else if (itemsFlag) {
        rawItems = JSON.parse(itemsFlag)
      } else {
        return emitError('review.batch', 'muweave/missing_items', 'Provide --file <path> or --items <json>')
      }
      const items = Array.isArray(rawItems) ? rawItems : (rawItems as { items?: unknown }).items
      const res = await bridge.call('drama.shot.review.batch', { items })
      if (!res.ok) return emitError('review.batch', res.error.code, res.error.message)
      const data = res.data as ShotReviewBatchResultV1
      return emit(
        'review.batch',
        data as unknown as Record<string, unknown>,
        `Batch review complete: ${data.succeededCount} succeeded, ${data.failedCount} failed.`,
      )
    }

    if (cmd === 'review' && sub === 'import') {
      const fileArg = positional[2] ?? strFlag(flags, 'file')
      if (!fileArg) return emitError('review.import', 'muweave/missing_file', 'Provide a review-feedback.json file path')
      const raw = JSON.parse(await readFile(path.resolve(fileArg), 'utf8')) as unknown
      const items = Array.isArray(raw) ? raw : (raw as { items?: unknown }).items
      const res = await bridge.call('drama.shot.review.import', {
        items,
        allowLocked: flags['allow-locked'] === true,
      })
      if (!res.ok) return emitError('review.import', res.error.code, res.error.message)
      const data = res.data as ShotReviewImportResultV1
      return emit(
        'review.import',
        data as unknown as Record<string, unknown>,
        `Imported ${data.importedCount} review(s), skipped ${data.skippedLockedCount} locked, ${data.invalidCount} invalid.`,
      )
    }

    if (cmd === 'bible') {
      if (!sub || sub === 'show') {
        const res = await bridge.call('project.bible.get', {})
        if (!res.ok) return emitError('bible.show', res.error.code, res.error.message)
        const bible = (res.data as { bible: ContinuityBibleV1 }).bible
        const human = [
          `Continuity Bible (rev ${bible.revision}) — ${bible.projectTitle ?? bible.workspaceId}`,
          `Visual: ${bible.visualGrammar.aspectRatio} | ${bible.visualGrammar.lensStyle}`,
          `Disclosure: ${bible.complianceDisclosure || '(not set)'}`,
          `Palette: ${bible.colorPalette.length} swatch(es) | Anchors: ${bible.characterAnchors.length} | Guardrails: ${bible.negativeGuardrails.length}`,
        ].join('\n')
        return emit('bible.show', { bible }, human)
      }
      if (sub === 'set') {
        const vg: Record<string, string> = {}
        if (strFlag(flags, 'aspect')) vg.aspectRatio = strFlag(flags, 'aspect')!
        if (strFlag(flags, 'lens')) vg.lensStyle = strFlag(flags, 'lens')!
        if (strFlag(flags, 'lighting')) vg.lightingRule = strFlag(flags, 'lighting')!
        if (strFlag(flags, 'style')) vg.styleDirective = strFlag(flags, 'style')!
        const guardrailsRaw = strFlag(flags, 'guardrails')
        const res = await bridge.call('project.bible.set', {
          ...(strFlag(flags, 'title') ? { projectTitle: strFlag(flags, 'title') } : {}),
          ...(Object.keys(vg).length ? { visualGrammar: vg } : {}),
          ...(strFlag(flags, 'disclosure') !== undefined ? { complianceDisclosure: strFlag(flags, 'disclosure') } : {}),
          ...(guardrailsRaw ? { negativeGuardrails: guardrailsRaw.split(',').map((s) => s.trim()).filter(Boolean) } : {}),
          ...(strFlag(flags, 'expected-revision') ? { expectedRevision: strFlag(flags, 'expected-revision') } : {}),
        })
        if (!res.ok) return emitError('bible.set', res.error.code, res.error.message)
        const bible = (res.data as { bible: ContinuityBibleV1 }).bible
        return emit('bible.set', { bible }, `Saved Continuity Bible (rev ${bible.revision})`)
      }
      return emitError('bible', 'muweave/unknown_subcommand', `Unknown bible subcommand: ${sub}`)
    }

    if (cmd === 'qc') {
      const episodeRef = strFlag(flags, 'episode')
      const strict = flags.strict === true
      const res = await bridge.call('drama.qc.report', episodeRef ? { episodeRef } : {})
      if (!res.ok) return emitError('qc', res.error.code, res.error.message)
      const report = res.data as EpisodeQcReportV1
      const human = [
        `Episode QC Report — score=${report.score}/100, readyForDelivery=${report.readyForDelivery} (blockers=${report.counts.blocker}, warnings=${report.counts.warning}, pass=${report.counts.pass})`,
        ...report.findings.map((f) => `  [${f.severity.toUpperCase()}] ${f.code}${f.shotRef ? ` (${f.shotRef})` : ''}: ${f.message}`),
      ].join('\n')
      const ok = !strict || report.readyForDelivery
      return emit('qc', report as unknown as Record<string, unknown>, human, ok)
    }

    if (cmd === 'tabs') {
      if (!sub || sub === 'show') {
        const res = await bridge.call('workspace.tabs.get', {})
        if (!res.ok) return emitError('tabs.show', res.error.code, res.error.message)
        const cfg = (res.data as { config: WorkspaceTabsConfigV1 }).config
        return emit('tabs.show', { config: cfg }, `Tabs preset=${cfg.presetId} rev=${cfg.revision} pinned=${cfg.pinnedRoomIds.join(',')}`)
      }
      if (sub === 'preset') {
        const presetId = positional[2] ?? 'default'
        const res = await bridge.call('workspace.tabs.save', { presetId })
        if (!res.ok) return emitError('tabs.preset', res.error.code, res.error.message)
        const cfg = (res.data as { config: WorkspaceTabsConfigV1 }).config
        return emit('tabs.preset', { config: cfg }, `Applied tabs preset ${cfg.presetId} (rev ${cfg.revision})`)
      }
      if (sub === 'reset') {
        const res = await bridge.call('workspace.tabs.reset', {})
        if (!res.ok) return emitError('tabs.reset', res.error.code, res.error.message)
        return emit('tabs.reset', res.data as Record<string, unknown>, 'Reset workspace tabs to default preset.')
      }
      return emitError('tabs', 'muweave/unknown_subcommand', `Unknown tabs subcommand: ${sub}`)
    }

    if (cmd === 'canvas') {
      const res = await bridge.call('canvas.board.get', {})
      if (!res.ok) return emitError('canvas', res.error.code, res.error.message)
      const board = (res.data as { board: CanvasBoardV1 }).board
      if (!sub || sub === 'show') {
        return emit('canvas.show', { board }, `Canvas rev=${board.revision}: ${board.nodes.length} node(s), ${board.edges.length} edge(s)`)
      }
      if (sub === 'export-mermaid') {
        const mermaid = exportCanvasMermaid(board)
        return emit('canvas.export-mermaid', { mermaid, nodeCount: board.nodes.length, edgeCount: board.edges.length }, mermaid)
      }
      return emitError('canvas', 'muweave/unknown_subcommand', `Unknown canvas subcommand: ${sub}`)
    }

    if (cmd === 'stage3d') {
      const res = await bridge.call('stage3d.scene.get', {})
      if (!res.ok) return emitError('stage3d', res.error.code, res.error.message)
      const scenes = (res.data as { scenes: Stage3dScenesV1 }).scenes
      const list = Object.values(scenes.scenes)
      if (!sub || sub === 'show') {
        return emit('stage3d.show', { scenes }, `Stage3D rev=${scenes.revision}: ${list.length} shot scene(s)`)
      }
      if (sub === 'export-prompts') {
        const prompts = list.map((s) => ({ shotRef: s.shotRef, ...compileStage3dPrompt(s) }))
        const human = prompts.length
          ? prompts.map((p) => `${p.shotRef} [${p.shotScale}]: ${p.zh}`).join('\n')
          : 'No 3D scenes saved.'
        return emit('stage3d.export-prompts', { prompts }, human)
      }
      return emitError('stage3d', 'muweave/unknown_subcommand', `Unknown stage3d subcommand: ${sub}`)
    }

    if (cmd === 'audio') {
      if (!sub || sub === 'show') {
        const episodeRef = strFlag(flags, 'episode')
        const res = await bridge.call('audio.mix.get', episodeRef ? { episodeRef } : {})
        if (!res.ok) return emitError('audio.show', res.error.code, res.error.message)
        const mix = (res.data as { mix: AudioMixConfigV1 }).mix
        return emit(
          'audio.show',
          { mix },
          `Audio Mix rev=${mix.revision} master=${mix.masterGainPct}% voice=${mix.tracks.voice.gainPct}% music=${mix.tracks.music.gainPct}% sfx=${mix.tracks.sfx.gainPct}% cues=${mix.cues.length}`,
        )
      }
      return emitError('audio', 'muweave/unknown_subcommand', `Unknown audio subcommand: ${sub}`)
    }

    if (cmd === 'export') {
      const format = sub ?? 'cut_manifest_v1'
      const fps = numFlag(flags, 'fps')
      const aspectRatio = strFlag(flags, 'aspect')
      const episodeRef = strFlag(flags, 'episode')
      const outPath = strFlag(flags, 'out')
      const bundleDir = strFlag(flags, 'bundle-dir')
      const res = await bridge.call('drama.export.manifest', {
        format,
        ...(episodeRef ? { episodeRef } : {}),
        ...(fps !== undefined ? { fps } : {}),
        ...(aspectRatio ? { aspectRatio } : {}),
      })
      if (!res.ok) return emitError('export', res.error.code, res.error.message)
      const result = res.data as DramaExportResultV1
      if (bundleDir) {
        const manifest = await readBundleManifestFromDisk(workspaceDir)
        const mediaBlobs = manifest.bindings.shotMedia
          .filter((m) => Boolean(m.sha256) && (!episodeRef || !m.episodeRef || m.episodeRef === episodeRef))
          .map((m) => ({ sha256: m.sha256!, ...(m.mime ? { mime: m.mime } : {}) }))
        let subtitlesSrt: string | undefined
        if (result.format === 'review_deck_html') {
          const srtRes = await bridge.call('drama.export.manifest', {
            format: 'srt_subtitles',
            ...(episodeRef ? { episodeRef } : {}),
            ...(fps !== undefined ? { fps } : {}),
            ...(aspectRatio ? { aspectRatio } : {}),
          })
          if (srtRes.ok) subtitlesSrt = (srtRes.data as DramaExportResultV1).content
        }
        const bundleRes = await exportDramaPortableBundle({
          workspaceDir,
          exportResult: result,
          bundleDir,
          mediaBlobs,
          ...(subtitlesSrt !== undefined ? { subtitlesSrt } : {}),
        })
        return emit(
          'export.bundle',
          {
            ...bundleRes,
            shotCount: result.shotCount,
            totalDurationMs: result.totalDurationMs,
            fps: result.fps,
          },
          `Exported portable ${result.format} bundle (${result.shotCount} shots, ${bundleRes.copiedMediaFiles.length} media files) to ${path.basename(bundleDir)}`,
        )
      }
      if (outPath) {
        await writeFile(path.resolve(outPath), result.content, 'utf8')
        return emit(
          'export',
          {
            format: result.format,
            filename: result.filename,
            shotCount: result.shotCount,
            totalDurationMs: result.totalDurationMs,
            fps: result.fps,
            written: true,
          },
          `Exported ${result.format} (${result.shotCount} shots, ${(result.totalDurationMs / 1000).toFixed(1)}s) to ${path.basename(outPath)}`,
        )
      }
      return emit('export', result as unknown as Record<string, unknown>, result.content)
    }

    if (cmd === 'adapters') {
      if (!sub || sub === 'list') {
        const res = await bridge.call('adapter.custom.list', {})
        if (!res.ok) return emitError('adapters.list', res.error.code, res.error.message)
        const data = res.data as { adapters: CustomAdapterViewV1[]; presets: unknown[] }
        const human = data.adapters.length
          ? data.adapters.map((a) => `${a.adapterId} (${a.protocol}/${a.kind}) enabled=${a.enabled} envReady=${a.envReady}`).join('\n')
          : 'No custom adapters registered.'
        return emit('adapters.list', data as unknown as Record<string, unknown>, human)
      }
      if (sub === 'add') {
        const adapterId = positional[2] ?? ''
        const res = await bridge.call('adapter.custom.save', {
          adapterId,
          title: strFlag(flags, 'title') ?? adapterId,
          protocol: strFlag(flags, 'protocol') ?? 'openai_http',
          kind: strFlag(flags, 'kind') ?? 'image',
          ...(strFlag(flags, 'stage') ? { stage: strFlag(flags, 'stage') } : {}),
          ...(strFlag(flags, 'endpoint') ? { endpointUrl: strFlag(flags, 'endpoint') } : {}),
          ...(strFlag(flags, 'binary') ? { binary: strFlag(flags, 'binary') } : {}),
          ...(strFlag(flags, 'model') ? { model: strFlag(flags, 'model') } : {}),
          ...(strFlag(flags, 'auth-env') ? { authEnvVar: strFlag(flags, 'auth-env') } : {}),
          ...(numFlag(flags, 'price') !== undefined ? { unitPriceUsd: numFlag(flags, 'price') } : {}),
          allowPrivateNetwork: flags['allow-private'] === true,
          enabled: true,
        })
        if (!res.ok) return emitError('adapters.add', res.error.code, res.error.message)
        const adapter = (res.data as { adapter: CustomAdapterViewV1 }).adapter
        return emit('adapters.add', { adapter }, `Saved custom adapter ${adapter.adapterId} (envReady=${adapter.envReady})`)
      }
      if (sub === 'remove') {
        const adapterId = positional[2] ?? ''
        const res = await bridge.call('adapter.custom.remove', { adapterId })
        if (!res.ok) return emitError('adapters.remove', res.error.code, res.error.message)
        return emit('adapters.remove', res.data as Record<string, unknown>, `Removed custom adapter ${adapterId}`)
      }
      if (sub === 'test') {
        const adapterId = positional[2] ?? ''
        const res = await bridge.call('adapter.custom.test', { adapterId })
        if (!res.ok) return emitError('adapters.test', res.error.code, res.error.message)
        const r = res.data as { ok: boolean; adapterId: string; message: string }
        return emit('adapters.test', res.data as Record<string, unknown>, `[${r.ok ? 'OK' : 'FAIL'}] ${r.adapterId}: ${r.message}`, r.ok)
      }
      return emitError('adapters', 'muweave/unknown_subcommand', `Unknown adapters subcommand: ${sub}`)
    }

    if (cmd === 'cut') {
      if (!sub || sub === 'show') {
        const episodeRef = strFlag(flags, 'episode')
        const res = await bridge.call('drama.cut.get', episodeRef ? { episodeRef } : {})
        if (!res.ok) return emitError('cut.show', res.error.code, res.error.message)
        return emit('cut.show', res.data as Record<string, unknown>, JSON.stringify(res.data, null, 2))
      }
      if (sub === 'reset') {
        const episodeRef = positional[2] ?? ''
        const res = await bridge.call('drama.cut.reset', { episodeRef })
        if (!res.ok) return emitError('cut.reset', res.error.code, res.error.message)
        return emit('cut.reset', res.data as Record<string, unknown>, `Reset cut override for ${episodeRef}`)
      }
      if (sub === 'reorder' || sub === 'trim' || sub === 'omit') {
        const episodeRef = positional[2] ?? ''
        const existingRes = await bridge.call('drama.cut.get', { episodeRef })
        const prev = existingRes.ok ? (existingRes.data as { cut: EpisodeCutOverrideV1 | null }).cut : null
        const nextPayload: Record<string, unknown> = {
          episodeRef,
          expectedRevision: prev?.revision ?? 0,
        }
        if (sub === 'reorder') {
          const orderCsv = positional[3] ?? ''
          nextPayload.shotOrder = orderCsv.split(',').map((s) => s.trim()).filter(Boolean)
        } else if (sub === 'trim') {
          const shotRef = positional[3] ?? ''
          const sec = Number(positional[4] ?? '')
          const micros = Math.round(sec * 1_000_000)
          nextPayload.durationOverridesMicros = {
            ...(prev?.durationOverridesMicros ?? {}),
            [shotRef]: micros,
          }
        } else if (sub === 'omit') {
          const shotRef = positional[3] ?? ''
          const omitted = new Set(prev?.omittedShotRefs ?? [])
          if (flags.restore === true) omitted.delete(shotRef)
          else omitted.add(shotRef)
          nextPayload.omittedShotRefs = [...omitted]
        }
        const res = await bridge.call('drama.cut.set', nextPayload)
        if (!res.ok) return emitError(`cut.${sub}`, res.error.code, res.error.message)
        const cut = (res.data as { cut: EpisodeCutOverrideV1 }).cut
        return emit(`cut.${sub}`, { cut }, `Updated cut for ${cut.episodeRef} (rev ${cut.revision})`)
      }
      return emitError('cut', 'muweave/unknown_subcommand', `Unknown cut subcommand: ${sub}`)
    }

    if (cmd === 'schedule') {
      if (!sub || sub === 'list') {
        const res = await bridge.call('schedule.list', {})
        if (!res.ok) return emitError('schedule.list', res.error.code, res.error.message)
        const data = res.data as { entries: Array<{ date: string; ref: string; label: string }> }
        const human = data.entries.length
          ? data.entries.map((e) => `${e.date}  ${e.ref}  ${e.label}`).join('\n')
          : 'Schedule board is empty.'
        return emit('schedule.list', data as unknown as Record<string, unknown>, human)
      }
      if (sub === 'plan') {
        const ref = positional[2] ?? ''
        const date = positional[3] ?? ''
        const res = await bridge.call('schedule.plan', {
          ref,
          date,
          ...(strFlag(flags, 'label') ? { label: strFlag(flags, 'label') } : {}),
          ...(strFlag(flags, 'kind') ? { kind: strFlag(flags, 'kind') } : {}),
          ...(strFlag(flags, 'note') ? { note: strFlag(flags, 'note') } : {}),
          ...(strFlag(flags, 'project') ? { projectId: strFlag(flags, 'project') } : {}),
        })
        if (!res.ok) return emitError('schedule.plan', res.error.code, res.error.message)
        return emit('schedule.plan', res.data as Record<string, unknown>, `Planned ${ref} on ${date}`)
      }
      if (sub === 'clear') {
        const ref = positional[2] ?? ''
        const res = await bridge.call('schedule.clear', { ref })
        if (!res.ok) return emitError('schedule.clear', res.error.code, res.error.message)
        return emit('schedule.clear', res.data as Record<string, unknown>, `Cleared ${ref} from schedule board`)
      }
      return emitError('schedule', 'muweave/unknown_subcommand', `Unknown schedule subcommand: ${sub}`)
    }

    if (cmd === 'diagnose') {
      const projectId = strFlag(flags, 'project')
      const res = await bridge.call('project.diagnose', projectId ? { projectId } : {})
      if (!res.ok) return emitError('diagnose', res.error.code, res.error.message)
      const data = res.data as { reports: Array<{ projectId: string; title: string; state: string; findings: unknown[] }> }
      const human = data.reports.length
        ? data.reports.map((r) => `${r.projectId} (${r.title}): ${r.state} [${r.findings.length} finding(s)]`).join('\n')
        : 'No projects registered.'
      return emit('diagnose', data as unknown as Record<string, unknown>, human)
    }

    if (cmd === 'migrate' && sub === 'report') {
      const res = await bridge.call('project.migration.report', {})
      if (!res.ok) return emitError('migrate.report', res.error.code, res.error.message)
      const rep = res.data as ProjectMigrationReportV1
      const human = [
        `Registry Migration Report (${rep.registrySchema}) — readyForV2=${rep.readyForV2}`,
        `Projects: ${rep.projectCount} (${rep.archivedCount} archived) | Corrupt backups: ${rep.corruptBackupCount} | Legacy schedule: ${rep.legacyScheduleCount} | Unclaimed bundles: ${rep.unclaimedBundleCount}`,
        ...rep.checks.map((c) => `  [${c.status.toUpperCase()}] ${c.label}: ${c.detail}`),
      ].join('\n')
      return emit('migrate.report', rep as unknown as Record<string, unknown>, human)
    }

    if (cmd === 'doctor') {
      if (flags.capabilities !== true && sub !== 'capabilities') {
        return emitError('doctor', 'muweave/missing_flag', 'Pass --capabilities to inspect capability readiness')
      }
      const [catRes, wsRes] = await Promise.all([
        bridge.call('capability.catalog', {}),
        bridge.call('bundle.status', {}),
      ])
      if (!catRes.ok) return emitError('doctor.capabilities', catRes.error.code, catRes.error.message)
      const catalog = catRes.data as CapabilityCatalogV1
      const wsSummary = wsRes.ok ? (wsRes.data as { workspace?: WorkspaceSummaryView }).workspace : undefined
      const report = runCapabilityDoctor(catalog, wsSummary)
      const human = [
        `Capability Doctor — available=${report.availableCount}, blocked=${report.blockedCount}, paidEnabled=${report.paidEnabled}`,
        ...report.capabilities.map(
          (c) => `  [${c.available ? 'READY' : c.reason ?? 'BLOCKED'}] ${c.capabilityId} (${c.owner}/${c.stage}) — ${c.remediation}`,
        ),
      ].join('\n')
      return emit('doctor.capabilities', report as unknown as Record<string, unknown>, human)
    }

    if (cmd === 'bots') {
      if (!sub || sub === 'list') {
        const res = await bridge.call('bot.roster', {})
        if (!res.ok) return emitError('bots.list', res.error.code, res.error.message)
        const data = res.data as { bots: Array<{ botId: string; role: string; state: string; revision: number }> }
        const human = data.bots.length
          ? data.bots.map((b) => `${b.botId} (${b.role}) [${b.state}] rev=${b.revision}`).join('\n')
          : 'No bots registered.'
        return emit('bots.list', data as unknown as Record<string, unknown>, human)
      }
      if (sub === 'pause' || sub === 'resume') {
        const botId = positional[2] ?? ''
        const expectedRevision = numFlag(flags, 'expected-revision')
        const res = await bridge.call('bot.pause', {
          botId,
          paused: sub === 'pause',
          ...(expectedRevision !== undefined ? { expectedRevision } : {}),
        })
        if (!res.ok) return emitError(`bots.${sub}`, res.error.code, res.error.message)
        const bot = (res.data as { bot: { botId: string; state: string; revision: number } }).bot
        return emit(`bots.${sub}`, res.data as Record<string, unknown>, `Bot ${bot.botId} is now ${bot.state} (rev ${bot.revision})`)
      }
      return emitError('bots', 'muweave/unknown_subcommand', `Unknown bots subcommand: ${sub}`)
    }

    if (cmd === 'tasks') {
      if (!sub || sub === 'list') {
        const res = await bridge.call('task.list', {})
        if (!res.ok) return emitError('tasks.list', res.error.code, res.error.message)
        const data = res.data as {
          tasks: Array<{ taskId: string; status: string; goal: string }>
          orphanedCount?: number
        }
        const human = data.tasks.length
          ? [
              `Tasks: ${data.tasks.length} (orphaned=${data.orphanedCount ?? 0})`,
              ...data.tasks.map((t) => `  ${t.taskId} [${t.status}] ${t.goal}`),
            ].join('\n')
          : `No tasks recorded (orphaned=${data.orphanedCount ?? 0}).`
        return emit('tasks.list', data as unknown as Record<string, unknown>, human)
      }
      if (sub === 'trace') {
        const taskId = positional[2] ?? ''
        const res = await bridge.call('task.trace', { taskId })
        if (!res.ok) return emitError('tasks.trace', res.error.code, res.error.message)
        const data = res.data as { task: { taskId: string; status: string }; jobs?: unknown[] }
        return emit(
          'tasks.trace',
          data as unknown as Record<string, unknown>,
          `Task ${data.task.taskId} [${data.task.status}] — ${(data.jobs ?? []).length} linked job(s)`,
        )
      }
      if (sub === 'cancel') {
        const taskId = positional[2] ?? ''
        const res = await bridge.call('task.cancel', { taskId })
        if (!res.ok) return emitError('tasks.cancel', res.error.code, res.error.message)
        const data = res.data as { cancelledTaskIds: string[]; cancelledJobIds: string[] }
        return emit(
          'tasks.cancel',
          data as unknown as Record<string, unknown>,
          `Cancelled ${data.cancelledTaskIds.length} task(s) and ${data.cancelledJobIds.length} linked job(s).`,
        )
      }
      return emitError('tasks', 'muweave/unknown_subcommand', `Unknown tasks subcommand: ${sub}`)
    }

    return emitError(cmd, 'muweave/unknown_command', `Unknown command: ${positional.join(' ')} (run "muweave --help")`)
  } finally {
    bridge.dispose?.()
  }
}

const isDirectMain =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))

if (isDirectMain) {
  runMuweaveCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
