import { deflateSync } from 'node:zlib'
import { putCasBlob } from '@yeisme/muweave-bundle'
import { inputText, sha256Hex, type CapabilityAdapter, type SlotUpdate } from './types'

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]!
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
  }
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length, false)
  for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)), false)
  return out
}

function makeDeterministicPng(seedHex: string): Uint8Array {
  const r = parseInt(seedHex.slice(0, 2), 16) || 48
  const g = parseInt(seedHex.slice(2, 4), 16) || 96
  const b = parseInt(seedHex.slice(4, 6), 16) || 144

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, 2, false)
  ihdrView.setUint32(4, 2, false)
  ihdr[8] = 8
  ihdr[9] = 6

  const raw = new Uint8Array(18)
  for (let row = 0; row < 2; row += 1) {
    const base = row * 9
    raw[base] = 0
    for (let col = 0; col < 2; col += 1) {
      const px = base + 1 + col * 4
      raw[px] = (r + row * 12) & 0xff
      raw[px + 1] = (g + col * 12) & 0xff
      raw[px + 2] = b
      raw[px + 3] = 255
    }
  }
  const idat = deflateSync(raw)
  const parts = [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))]
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}

const previewRuns = new Map<string, SlotUpdate[]>()

/**
 * Opt-in zero-cost local PNG preview adapter.
 * Activated ONLY when `process.env.MUWEAVE_LOCAL_PREVIEW_ADAPTER === '1'`.
 */
export const LOCAL_PREVIEW_ADAPTER: CapabilityAdapter = {
  binary: 'builtin',
  descriptor: {
    capabilityId: 'demo.image.preview',
    owner: 'eikona',
    kind: 'image',
    stage: 'visual',
    title: '本地零费预览图 (Demo)',
    summary: '离线生成确定性本地 PNG 占位图并写入 CAS，零外部调用、零费用，用于体验完整生成与绑镜流程。',
    costClass: 'free',
    costUnit: 'none',
    defaultSlots: 2,
    maxSlots: 4,
    inputs: [
      { name: 'prompt', label: '画面描述', inputType: 'textarea', required: true },
    ],
  },
  async estimate(_ctx, input, slots) {
    const prompt = inputText(input, 'prompt')
    if (!prompt) return { ok: false, errorCode: 'ESTIMATE_FAILED' }
    return {
      ok: true,
      value: {
        costClass: 'free',
        estimate: { unit: 'none', amount: 0 },
        suggestedCeiling: { unit: 'none', amount: 0 },
        slots,
        planLines: [`${slots} × 1024x1024 demo.image.preview (free local PNG)`],
      },
    }
  },
  async submit(ctx, req) {
    const prompt = inputText(req.input, 'prompt')
    const ownerJobRef = `preview_${sha256Hex(`${req.idempotencyKey}:${prompt}`).slice(0, 16)}`
    const updates: SlotUpdate[] = []
    for (let index = 0; index < req.slots; index += 1) {
      const seed = sha256Hex(`${ownerJobRef}:slot_${index + 1}:${prompt}`)
      const pngBytes = makeDeterministicPng(seed)
      const blob = await putCasBlob(ctx.cwd, pngBytes, 'image/png', 'demo-preview')
      updates.push({
        index,
        status: 'done',
        ownerRef: `${ownerJobRef}:slot_${index + 1}`,
        label: `Preview #${index + 1}`,
        mime: 'image/png',
        sha256: blob.blobDigest,
      })
    }
    previewRuns.set(ownerJobRef, updates)
    return { outcome: 'submitted', ownerJobRef }
  },
  async poll(_ctx, ownerJobRef, slotCount) {
    const slots = previewRuns.get(ownerJobRef)
    if (!slots) {
      return {
        state: 'done',
        actualCost: { unit: 'none', amount: 0 },
        slots: Array.from({ length: slotCount }, (_, index) => ({
          index,
          status: 'skipped' as const,
        })),
      }
    }
    return {
      state: 'done',
      actualCost: { unit: 'none', amount: 0 },
      slots,
    }
  },
  async cancel(_ctx, ownerJobRef) {
    previewRuns.delete(ownerJobRef)
    return true
  },
  async review() {
    return true
  },
}
