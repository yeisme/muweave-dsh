// Shared helpers for the fake owner CLIs. Offline only: no network, no provider, no shell.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { deflateSync } from 'node:zlib'

export function out(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`)
}

export function reject(message) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'FAKE_OWNER_UNSUPPORTED', message } })}\n`)
  process.exit(2)
}

export function flag(args, name) {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** Small solid-colour PNG (32x48) whose colour depends on `seed`, so each candidate differs. */
export function tinyPng(seed) {
  const w = 32
  const h = 48
  const rgb = [(seed * 67 + 40) % 256, (seed * 131 + 90) % 256, (seed * 29 + 150) % 256]
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y += 1) {
    const row = y * (w * 3 + 1)
    for (let x = 0; x < w; x += 1) {
      const shade = (x + y) % 8 === 0 ? 24 : 0
      for (let c = 0; c < 3; c += 1) raw[row + 1 + x * 3 + c] = Math.min(255, rgb[c] + shade)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

export const sha256Of = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`

export function stateFile(owner, id) {
  const dir = path.join(process.cwd(), `fake-${owner}-out`)
  mkdirSync(dir, { recursive: true })
  return { dir, file: path.join(dir, `${id.replace(/[^A-Za-z0-9_-]/g, '_')}.json`) }
}

export const saveState = (owner, id, state) => writeFileSync(stateFile(owner, id).file, JSON.stringify(state))

export function loadState(owner, id) {
  try {
    return JSON.parse(readFileSync(stateFile(owner, id).file, 'utf8'))
  } catch {
    return undefined
  }
}
