import type { CapabilityAdapter, CapabilityInput } from './types'

/*
 * Capabilities whose owner CLI lacks a verified required flag (cost cap, idempotency key, submit
 * command). They stay in the catalog, greyed out with a stable reason, and never reach an owner.
 * Findings come from `<cli> <cmd> --help` on 2026-11-17; update when the owner ships the missing flag.
 */

type Base = CapabilityAdapter['descriptor']

function blocked(binary: string, reason: string, descriptor: Base): CapabilityAdapter {
  const refuse = async () => ({ ok: false as const, errorCode: 'CAPABILITY_UNAVAILABLE' as const })
  return {
    binary,
    blockedReason: reason,
    descriptor,
    estimate: refuse,
    submit: async () => ({ outcome: 'failed' }),
    poll: async () => ({ state: 'unknown', slots: [] }),
  }
}

const promptInput = (name: string, label: string) => ({ name, label, inputType: 'textarea' as const, required: true })

export const BLOCKED_ADAPTERS: readonly CapabilityAdapter[] = [
  // `scaena draw run` has --confirm but no cost cap and no idempotency key flag.
  blocked('scaena', 'NO_COST_CAP', {
    capabilityId: 'scaena.shot.draw', owner: 'scaena', kind: 'image', stage: 'storyboard',
    title: '为镜头出图', summary: 'Scaena 分镜出图；owner 的 draw run 没有费用上限参数，暂不可用。',
    costClass: 'paid', costUnit: 'usd', defaultSlots: 1, maxSlots: 4,
    inputs: [{ name: 'slot', label: '镜头格子', inputType: 'element', required: true, elementKinds: ['shot'] }],
  }),
  // `scaena video generate --max-cost-usd` is documented for Grok Imagine only; its --idempotency-key is input-bundle only.
  blocked('scaena', 'NO_COST_CAP', {
    capabilityId: 'scaena.shot.video', owner: 'scaena', kind: 'video', stage: 'storyboard',
    title: '为镜头生成视频', summary: 'Scaena 视频生成；费用上限只对部分模型生效，生成命令没有幂等键，暂不可用。',
    costClass: 'paid', costUnit: 'usd', defaultSlots: 1, maxSlots: 2,
    inputs: [promptInput('prompt', '视频描述')],
  }),
  // `sonora tts` exposes estimate/job status/job cancel only; no job-creating command exists in the help tree.
  blocked('sonora', 'NO_SUBMIT_COMMAND', {
    capabilityId: 'sonora.voice.tts', owner: 'sonora', kind: 'voice', stage: 'sound',
    title: '生成配音', summary: 'Sonora 配音；owner 目前只有 tts estimate/job status，没有提交命令，暂不可用。',
    costClass: 'paid', costUnit: 'usd', defaultSlots: 1, maxSlots: 4,
    inputs: [promptInput('text', '台词')],
  }),
  // music generate needs brief → plan → `approval issue` chain with an authorization epoch; not wired yet.
  blocked('sonora', 'ADAPTER_PENDING', {
    capabilityId: 'sonora.music.generate', owner: 'sonora', kind: 'music', stage: 'sound',
    title: '生成配乐', summary: 'Sonora 配乐需要 brief、plan、approval 三步，适配器待接。',
    costClass: 'paid', costUnit: 'usd', defaultSlots: 1, maxSlots: 2,
    inputs: [promptInput('brief', '配乐描述')],
  }),
  // `anatomia analysis start` has --source/--mode/--domain only: no cost cap, no idempotency key, needs an uploaded source ref.
  blocked('anatomia', 'NO_COST_CAP', {
    capabilityId: 'anatomia.reference.analyze', owner: 'anatomia', kind: 'analysis', stage: 'inspiration',
    title: '参考视频拆解', summary: 'Anatomia 拆解；analysis start 没有费用上限与幂等键参数，暂不可用。',
    costClass: 'unknown', costUnit: 'none', defaultSlots: 1, maxSlots: 1,
    inputs: [{ name: 'source', label: '来源视频', inputType: 'text', required: true }],
  }),
  // Auctra text generation has no cost cap by design (tracked as owner work).
  blocked('auctra', 'NO_COST_CAP', {
    capabilityId: 'auctra.text.generate', owner: 'auctra', kind: 'text', stage: 'script',
    title: '剧本文本生成', summary: 'Auctra 文本生成没有费用上限，已记为待 owner 支持。',
    costClass: 'unknown', costUnit: 'none', defaultSlots: 1, maxSlots: 1,
    inputs: [promptInput('prompt', '写作要求')],
  }),
  // Not installed on this machine; flags cannot be verified, so even when installed the adapter stays pending.
  blocked('pinax', 'ADAPTER_PENDING', {
    capabilityId: 'pinax.inbox.capture', owner: 'pinax', kind: 'capture', stage: 'inspiration',
    title: '收进灵感箱', summary: 'Pinax 收集；未安装时显示 OWNER_NOT_INSTALLED。',
    costClass: 'free', costUnit: 'none', defaultSlots: 1, maxSlots: 1,
    inputs: [promptInput('text', '要收集的内容')],
  }),
  blocked('manju-hotlist', 'ADAPTER_PENDING', {
    capabilityId: 'manju-hotlist.research.query', owner: 'manju-hotlist', kind: 'research', stage: 'inspiration',
    title: '热榜调研', summary: 'manju-hotlist 查询；未安装时显示 OWNER_NOT_INSTALLED。',
    costClass: 'free', costUnit: 'none', defaultSlots: 1, maxSlots: 1,
    inputs: [{ name: 'query', label: '关键词', inputType: 'text', required: true }],
  }),
]

export type { CapabilityInput }
