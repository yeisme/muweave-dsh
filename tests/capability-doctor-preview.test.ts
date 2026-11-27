import { afterEach, describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { casBlobPath, muweaveRoot, readBundleManifestFromDisk, type CliRunner } from '@yeisme/muweave-bundle'
import { containsHostPath, findPlaintextCredential } from '@yeisme/muweave-bundle/consumer'
import {
  CreatorHostService,
  createMuweaveMcpServer,
  LOCAL_PREVIEW_ADAPTER,
  runCapabilityDoctor,
  runMuweaveCli,
  seedDemoWorkspace,
  type CapabilityCatalogV1,
  type JobRecordV1,
} from '@yeisme/dsh-muweave-core'

const OFFLINE_RUNNER: CliRunner = async () => ({ exitCode: 1, stdout: '', stderr: 'not installed' })

async function execCli(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ''
  let stderr = ''
  const code = await runMuweaveCli(argv, {
    stdout: (s) => { stdout += s },
    stderr: (s) => { stderr += s },
  })
  return { code, stdout, stderr }
}

const origPreviewEnv = process.env.MUWEAVE_LOCAL_PREVIEW_ADAPTER
afterEach(() => {
  if (origPreviewEnv === undefined) delete process.env.MUWEAVE_LOCAL_PREVIEW_ADAPTER
  else process.env.MUWEAVE_LOCAL_PREVIEW_ADAPTER = origPreviewEnv
})

describe('v6 Capability Doctor, Opt-In Local Preview Adapter, CLI Bots/Tasks & MCP Orchestration', () => {
  it('runCapabilityDoctor produces actionable remediation per blocked reason with zero host paths', () => {
    const mockCatalog: CapabilityCatalogV1 = {
      paidEnabled: false,
      capabilities: [
        {
          capabilityId: 'eikona.image.generate',
          owner: 'eikona',
          kind: 'image',
          stage: 'visual',
          title: 'Generate Image',
          summary: 'Image gen',
          costClass: 'paid',
          costUnit: 'usd',
          available: true,
          defaultSlots: 4,
          maxSlots: 8,
          inputs: [],
        },
        {
          capabilityId: 'scaena.video.generate',
          owner: 'scaena',
          kind: 'video',
          stage: 'storyboard',
          title: 'Generate Video',
          summary: 'Video gen',
          costClass: 'paid',
          costUnit: 'usd',
          available: false,
          unavailableReason: 'NO_COST_CAP',
          defaultSlots: 1,
          maxSlots: 2,
          inputs: [],
        },
        {
          capabilityId: 'sonora.sfx.generate',
          owner: 'sonora',
          kind: 'sfx',
          stage: 'sound',
          title: 'Generate SFX',
          summary: 'SFX gen',
          costClass: 'paid',
          costUnit: 'usd',
          available: false,
          unavailableReason: 'OWNER_NOT_INSTALLED',
          defaultSlots: 2,
          maxSlots: 4,
          inputs: [],
        },
      ],
    }

    const report = runCapabilityDoctor(mockCatalog)
    expect(report.ok).toBe(true)
    expect(report.availableCount).toBe(1)
    expect(report.blockedCount).toBe(2)
    expect(report.paidEnabled).toBe(false)
    expect(report.capabilities[1]?.reason).toBe('NO_COST_CAP')
    expect(report.capabilities[1]?.remediation).toContain('cost-cap')
    expect(report.capabilities[2]?.reason).toBe('OWNER_NOT_INSTALLED')
    expect(report.capabilities[2]?.remediation).toContain('MUWEAVE_LOCAL_PREVIEW_ADAPTER=1')
    expect(containsHostPath(report)).toBe(false)
    expect(findPlaintextCredential(report)).toBeUndefined()
  })

  it('LOCAL_PREVIEW_ADAPTER is absent by default and completes a full zero-cost CAS loop when MUWEAVE_LOCAL_PREVIEW_ADAPTER=1', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-preview-adapter-'))
    const dataDir = path.join(ws, 'plugin-data')
    try {
      await seedDemoWorkspace(ws, { pluginDataDir: dataDir })

      // 1. OFF by default
      delete process.env.MUWEAVE_LOCAL_PREVIEW_ADAPTER
      const svcOff = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: dataDir, runner: OFFLINE_RUNNER })
      const catOff = await svcOff.handleRpcAction('capability.catalog', {})
      expect(catOff.ok).toBe(true)
      const capsOff = (catOff as { ok: true; data: CapabilityCatalogV1 }).data.capabilities
      expect(capsOff.some((c) => c.capabilityId === LOCAL_PREVIEW_ADAPTER.descriptor.capabilityId)).toBe(false)
      svcOff.dispose()

      // 2. ON via MUWEAVE_LOCAL_PREVIEW_ADAPTER=1
      process.env.MUWEAVE_LOCAL_PREVIEW_ADAPTER = '1'
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: dataDir, runner: OFFLINE_RUNNER })
      const catOn = await svc.handleRpcAction('capability.catalog', {})
      expect(catOn.ok).toBe(true)
      const capsOn = (catOn as { ok: true; data: CapabilityCatalogV1 }).data.capabilities
      const previewCap = capsOn.find((c) => c.capabilityId === 'demo.image.preview')
      expect(previewCap?.available).toBe(true)
      expect(previewCap?.costClass).toBe('free')
      expect(previewCap?.costUnit).toBe('none')

      // Estimate
      const estRes = await svc.handleRpcAction('capability.estimate', {
        capabilityId: 'demo.image.preview',
        input: { prompt: '雨夜怀表特写镜头' },
        slots: 2,
        anchor: { episodeRef: 'ep_01', sceneRef: 'scene_03', shotRef: 'shot_05' },
      })
      expect(estRes.ok).toBe(true)
      const estimate = (estRes as { ok: true; data: { estimate: { estimateId: string; planLines: string[] } } }).data.estimate
      expect(estimate.planLines[0]).toBe('2 × 1024x1024 demo.image.preview (free local PNG)')

      // Request
      const reqRes = await svc.handleRpcAction('job.request', {
        estimateId: estimate.estimateId,
        idempotencyKey: 'preview_demo_1',
        requestedBy: 'ui',
      })
      expect(reqRes.ok).toBe(true)
      const job = (reqRes as { ok: true; data: { job: JobRecordV1 } }).data.job
      expect(job.status).toBe('waiting_approval')

      // Approve (free job works even with paidEnabled=false!)
      const appRes = await svc.handleRpcAction('job.approve', {
        jobId: job.jobId,
        ceiling: { unit: 'none', amount: 0 },
      })
      expect(appRes.ok).toBe(true)

      // Poll engine once to collect completed preview slots
      await (svc as unknown as { capabilities: { engine: { tick(): Promise<void> } } }).capabilities.engine.tick()
      const pollRes = await svc.handleRpcAction('job.get', { jobId: job.jobId })
      expect(pollRes.ok).toBe(true)
      const polledJob = (pollRes as { ok: true; data: { job: JobRecordV1 } }).data.job
      expect(polledJob.status).toBe('waiting_for_human')
      const slot0 = polledJob.slots[0]!
      expect(slot0.status).toBe('done')
      expect(slot0.mime).toBe('image/png')
      expect(slot0.sha256).toMatch(/^sha256:[0-9a-f]{64}$/)
      expect(existsSync(casBlobPath(muweaveRoot(ws), slot0.sha256!))).toBe(true)

      // Accept slot + linkToShot -> linked to shot_05 in manifest.bindings.shotMedia
      const revRes = await svc.handleRpcAction('job.slot.review', {
        jobId: job.jobId,
        slotId: slot0.slotId,
        decision: 'accept',
        linkToShot: true,
      })
      expect(revRes.ok).toBe(true)
      const manifest = await readBundleManifestFromDisk(ws)
      expect(manifest.bindings.shotMedia.some((m) => m.shotRef === 'shot_05' && m.sha256 === slot0.sha256)).toBe(true)

      svc.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })

  it('supports CLI doctor --capabilities, bots list/pause/resume, tasks list/trace/cancel, and MCP orchestration tools/resource', async () => {
    const ws = await mkdtemp(path.join(tmpdir(), 'muweave-v6-orch-'))
    const dataDir = path.join(ws, 'plugin-data')
    const baseFlags = ['--workspace', ws, '--data-dir', dataDir]
    try {
      await seedDemoWorkspace(ws, { pluginDataDir: dataDir })

      // 1. CLI doctor --capabilities --agent
      const docAgent = await execCli(['doctor', '--capabilities', ...baseFlags, '--agent'])
      expect(docAgent.code).toBe(0)
      expect(docAgent.stdout).toContain('spec_version=1.0')
      expect(docAgent.stdout).toContain('command=doctor.capabilities')
      expect(containsHostPath(docAgent.stdout)).toBe(false)

      // 2. CLI bots list / pause / resume
      const botsList = await execCli(['bots', 'list', ...baseFlags, '--json'])
      expect(botsList.code).toBe(0)
      const botsData = JSON.parse(botsList.stdout) as { bots: Array<{ botId: string; state: string; revision: number }> }
      expect(botsData.bots[0]?.botId).toBe('muweave-manager')
      expect(botsData.bots[0]?.state).toBe('active')

      const botsPause = await execCli(['bots', 'pause', 'muweave-manager', '--expected-revision', '1', ...baseFlags, '--json'])
      expect(botsPause.code).toBe(0)
      expect(JSON.parse(botsPause.stdout).bot.state).toBe('paused')

      const botsResume = await execCli(['bots', 'resume', 'muweave-manager', '--expected-revision', '2', ...baseFlags, '--json'])
      expect(botsResume.code).toBe(0)
      expect(JSON.parse(botsResume.stdout).bot.state).toBe('active')

      // 3. Create a task via host, then inspect/cancel via CLI + MCP
      const svc = new CreatorHostService({ defaultWorkspaceDir: ws, pluginDataDir: dataDir, runner: OFFLINE_RUNNER })
      const wsList = await svc.handleRpcAction('workspace.list', {})
      const wsId = (wsList as { ok: true; data: { workspaces: Array<{ workspaceId: string }> } }).data.workspaces[0]!.workspaceId
      const t1 = await svc.handleRpcAction('task.create', { workspaceId: wsId, idempotencyKey: 'v6_t1', goal: 'Render shot 05' })
      const taskId1 = (t1 as { ok: true; data: { task: { taskId: string } } }).data.task.taskId
      const t2 = await svc.handleRpcAction('task.create', { workspaceId: wsId, idempotencyKey: 'v6_t2', goal: 'Render shot 06' })
      const taskId2 = (t2 as { ok: true; data: { task: { taskId: string } } }).data.task.taskId
      svc.dispose()

      const tasksList = await execCli(['tasks', 'list', ...baseFlags, '--json'])
      expect(tasksList.code).toBe(0)
      expect(JSON.parse(tasksList.stdout).tasks).toHaveLength(2)

      const tasksTrace = await execCli(['tasks', 'trace', taskId1, ...baseFlags, '--json'])
      expect(tasksTrace.code).toBe(0)
      expect(JSON.parse(tasksTrace.stdout).task.taskId).toBe(taskId1)

      const tasksCancel = await execCli(['tasks', 'cancel', taskId1, ...baseFlags, '--json'])
      expect(tasksCancel.code).toBe(0)
      expect(JSON.parse(tasksCancel.stdout).cancelledTaskIds).toContain(taskId1)

      // 4. MCP orchestration tools & resource
      const mcp = createMuweaveMcpServer({ defaultWorkspaceDir: ws, pluginDataDir: dataDir })
      const orchStatus = await mcp.handleJsonRpc({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'muweave_orchestration_status', arguments: {} },
      })
      const orchParsed = JSON.parse((orchStatus?.result as { content: Array<{ text: string }> }).content[0]!.text) as {
        bots: unknown[]
        pausedCount: number
        activeTaskCount: number
        orphanedCount: number
      }
      expect(orchParsed.bots.length).toBeGreaterThanOrEqual(1)
      expect(orchParsed.pausedCount).toBe(0)
      expect(orchParsed.activeTaskCount).toBe(1)

      const mcpCancel = await mcp.handleJsonRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'muweave_task_trace_or_cancel', arguments: { action: 'cancel', taskId: taskId2 } },
      })
      const mcpCancelParsed = JSON.parse((mcpCancel?.result as { content: Array<{ text: string }> }).content[0]!.text) as {
        cancelledTaskIds: string[]
        cancelledJobIds: string[]
      }
      expect(mcpCancelParsed.cancelledTaskIds).toContain(taskId2)
      expect(Array.isArray(mcpCancelParsed.cancelledJobIds)).toBe(true)

      const resRead = await mcp.handleJsonRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'resources/read',
        params: { uri: 'muweave://orchestration/tasks' },
      })
      const resText = (resRead?.result as { contents: Array<{ text: string }> }).contents[0]!.text
      expect(JSON.parse(resText)).toHaveProperty('bots')
      expect(containsHostPath(resText)).toBe(false)
      expect(findPlaintextCredential(resText)).toBeUndefined()

      mcp.dispose()
    } finally {
      await rm(ws, { recursive: true, force: true })
    }
  })
})
