import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import {
  GenerationLauncher,
  closeGeneration,
  createFallbackTranslator,
  type MuweaveRpcClient,
} from '../packages/dsh-muweave-core/src/client/index'

afterEach(() => {
  closeGeneration()
  cleanup()
})

function makeMockRpc() {
  let botState: 'active' | 'paused' = 'active'
  let botRevision = 3
  let taskStatus = 'running'

  const call = vi.fn(async (action: string, payload: Record<string, unknown> = {}) => {
    if (action === 'job.list') return { ok: true as const, generation: 1, data: { jobs: [] } }
    if (action === 'capability.catalog') return { ok: true as const, generation: 1, data: { paidEnabled: false, capabilities: [] } }
    if (action === 'budget.status') return { ok: true as const, generation: 1, data: { paidEnabled: false, day: '2026-11-27', lines: [], unknownCostJobs: 0 } }
    if (action === 'bot.roster') {
      return {
        ok: true as const,
        generation: 1,
        data: {
          bots: [
            {
              botId: 'muweave-manager',
              role: 'manager',
              state: botState,
              capabilityGrants: ['eikona.image.generate', 'sonora.sfx.generate'],
              budgetEnvelope: { unit: 'usd', amount: 10 },
              revision: botRevision,
            },
          ],
        },
      }
    }
    if (action === 'bot.pause') {
      botState = payload.paused ? 'paused' : 'active'
      botRevision += 1
      return { ok: true as const, generation: 2, data: { bot: { botId: payload.botId, state: botState, revision: botRevision } } }
    }
    if (action === 'task.list') {
      return {
        ok: true as const,
        generation: 1,
        data: {
          orphanedCount: 1,
          tasks: [
            {
              taskId: 'task_demo_01',
              workspaceId: 'ws_1',
              rootTaskId: 'task_demo_01',
              assignedTo: { botId: 'worker-a' },
              goal: '生成雨夜关键帧',
              status: taskStatus,
              depth: 1,
              traceId: 'trace_demo_01',
              revision: 1,
            },
          ],
        },
      }
    }
    if (action === 'task.trace') {
      return {
        ok: true as const,
        generation: 1,
        data: {
          task: { taskId: 'task_demo_01', traceId: 'trace_demo_01', status: taskStatus },
          jobs: [{ jobId: 'job_linked_1', capabilityId: 'eikona.image.generate', status: 'running' }],
          events: [{ event: 'task.delegated', status: 'assigned' }],
        },
      }
    }
    if (action === 'task.cancel') {
      taskStatus = 'cancelled'
      return {
        ok: true as const,
        generation: 2,
        data: {
          task: { taskId: 'task_demo_01', status: 'cancelled' },
          cancelledTaskIds: ['task_demo_01'],
          cancelledJobIds: ['job_linked_1'],
        },
      }
    }
    return { ok: true as const, generation: 1, data: {} }
  })

  const rpc: MuweaveRpcClient = {
    call: call as MuweaveRpcClient['call'],
    resolveMediaUrl: vi.fn(async () => undefined),
    generation: () => 1,
  }
  return { rpc, call }
}

describe('OrchestrationPanel inside GenerationDrawer', () => {
  it('switches to orchestration tab, toggles bot.pause with expectedRevision, expands task.trace, and cascades task.cancel', async () => {
    const { rpc, call } = makeMockRpc()
    const t = createFallbackTranslator('zh')
    render(<GenerationLauncher rpc={rpc} t={t} />)

    // Open GenerationDrawer
    const openBtn = document.querySelector<HTMLButtonElement>('[data-muweave-generate-open="true"]')
    expect(openBtn).toBeTruthy()
    fireEvent.click(openBtn!)

    // Switch to 编排与断路器 tab
    const orchTab = await waitFor(() => {
      const el = document.querySelector<HTMLButtonElement>('[data-generation-drawer-tab="orchestration"]')
      expect(el).toBeTruthy()
      return el!
    })
    fireEvent.click(orchTab)

    // Bot roster + orphaned warning loaded
    await waitFor(() => {
      expect(document.querySelector('[data-orchestration-bots="true"]')?.textContent).toContain('muweave-manager')
      expect(document.querySelector('[data-orphaned-task-count="1"]')).toBeTruthy()
    })

    // Toggle bot.pause with expectedRevision: 3
    const pauseBtn = document.querySelector<HTMLButtonElement>('[data-bot-toggle-pause="muweave-manager"]')!
    fireEvent.click(pauseBtn)
    await waitFor(() => {
      expect(call).toHaveBeenCalledWith(
        'bot.pause',
        expect.objectContaining({
          botId: 'muweave-manager',
          paused: true,
          expectedRevision: 3,
          idempotencyKey: expect.any(String),
        }),
      )
    })

    // Expand task.trace
    const traceBtn = document.querySelector<HTMLButtonElement>('[data-task-trace-btn="task_demo_01"]')!
    fireEvent.click(traceBtn)
    await waitFor(() => {
      const tracePanel = document.querySelector('[data-task-trace-panel="task_demo_01"]')
      expect(tracePanel?.textContent).toContain('job_linked_1')
      expect(tracePanel?.textContent).toContain('trace_demo_01')
    })

    // Trigger task.cancel cascade and verify receipt
    const cancelBtn = document.querySelector<HTMLButtonElement>('[data-task-cancel-btn="task_demo_01"]')!
    fireEvent.click(cancelBtn)
    await waitFor(() => {
      expect(call).toHaveBeenCalledWith('task.cancel', { taskId: 'task_demo_01' })
      expect(document.querySelector('[data-orchestration-receipt="true"]')?.textContent).toContain('1')
    })
  })
})
