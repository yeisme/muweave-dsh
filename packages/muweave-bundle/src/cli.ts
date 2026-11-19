#!/usr/bin/env node
import { existsSync } from 'node:fs'
import path from 'node:path'
import {
  bindBundleRef,
  BundleValidationError,
  initBundle,
  muweaveRoot,
  readBundleIndexFromDisk,
  readElementFromDisk,
  syncBundle,
  validateBundleOnDisk,
  type BindingTargetKind,
} from './compiler'

interface ParsedFlags {
  positional: string[]
  flags: Record<string, string | boolean>
}

function parseArgv(argv: readonly string[]): ParsedFlags {
  const positional: string[] = []
  const flags: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      if (eq !== -1) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1)
      } else {
        const next = argv[i + 1]
        if (next && !next.startsWith('--')) {
          flags[arg.slice(2)] = next
          i++
        } else {
          flags[arg.slice(2)] = true
        }
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

const ANSI_ESCAPE = new RegExp('\\x1b\\[[0-?]*[ -/]*[@-~]', 'g')

function cleanAgentValue(value: string): string {
  return value.replace(ANSI_ESCAPE, '').replace(/\r?\n|\r/g, '\\n')
}

function stableId(value: Record<string, unknown>): string | undefined {
  const entries = Object.entries(value)
  const idEntry = entries.find(([key, candidate]) => /(?:id|ref)$/i.test(key) && (typeof candidate === 'string' || typeof candidate === 'number'))
  return idEntry ? String(idEntry[1]) : undefined
}

function agentPrefix(key: string): { prefix: 'fact' | 'action' | 'evidence' | 'error'; path: string } {
  const normalized = key.toLowerCase()
  if (normalized === 'error') return { prefix: 'error', path: '' }
  if (normalized === 'action' || normalized === 'actions') return { prefix: 'action', path: '' }
  if (normalized === 'evidence' || normalized === 'evidences') return { prefix: 'evidence', path: '' }
  return { prefix: 'fact', path: key }
}

function arrayElementId(value: unknown): string | undefined {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (value && typeof value === 'object' && !Array.isArray(value)) return stableId(value as Record<string, unknown>)
  return undefined
}

function flattenAgentValue(
  value: unknown,
  keyPath: string,
  prefix: 'fact' | 'action' | 'evidence' | 'error',
  lines: string[],
  inheritedId?: string,
): void {
  if (value === undefined) return
  if (typeof value === 'string') {
    if (value.length > 120) {
      const ref = inheritedId ? `text:${inheritedId}` : undefined
      lines.push(`${prefix}.${keyPath}${ref ? '_ref' : '_length'}=${ref ?? value.length}`)
    } else {
      lines.push(`${prefix}.${keyPath}=${cleanAgentValue(value)}`)
    }
    return
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    lines.push(`${prefix}.${keyPath}=${String(value)}`)
    return
  }
  if (Array.isArray(value)) {
    lines.push(`${prefix}.${keyPath}_count=${value.length}`)
    const ids = value.map(arrayElementId)
    if (value.length > 0 && ids.every((id): id is string => id !== undefined)) {
      lines.push(`${prefix}.${keyPath}=${ids.map(cleanAgentValue).join(',')}`)
    }
    return
  }

  const objectValue = value as Record<string, unknown>
  const objectId = stableId(objectValue) ?? inheritedId
  for (const [key, child] of Object.entries(objectValue)) {
    const childPath = keyPath ? `${keyPath}.${key}` : key
    flattenAgentValue(child, childPath, prefix, lines, objectId)
  }
}

/** Agent facts use fact.; command actions, evidence, and failures use action., evidence., and error. respectively. */
export function renderAgentOutput(payload: Record<string, unknown>, command: string): string {
  const failed = payload.ok === false || payload.error !== undefined || payload.status === 'failed' || payload.status === 'error'
  const payloadId = stableId(payload)
  const lines = [`spec_version=1.0`, `mode=agent`, `command=${cleanAgentValue(command)}`, `status=${failed ? 'failed' : 'success'}`]
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'command' || key === 'status') continue
    const { prefix, path: keyPath } = agentPrefix(key)
    flattenAgentValue(value, keyPath, prefix, lines, payloadId)
  }
  return `${lines.join('\n')}\n`
}

function emit(payload: Record<string, unknown>, flags: Record<string, string | boolean>, command = 'muweave-bundle.unknown'): void {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
    return
  }
  if (flags.agent) {
    process.stdout.write(renderAgentOutput(payload, command))
    return
  }
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`)
}

export async function runMuweaveBundleCli(argv: readonly string[]): Promise<number> {
  const { positional, flags } = parseArgv(argv)
  const cmd = positional[0] ?? 'help'
  const workspaceDir = typeof flags.workspace === 'string' ? flags.workspace : process.cwd()

  if (cmd === 'help' || flags.help) {
    process.stdout.write(
      [
        'Usage: muweave-bundle <command> [--workspace <dir>] [--json|--agent]',
        '',
        'Commands:',
        '  init [--title <name>] [--project-id <id>]',
        '  bind <target> <ref>   (targets: eikona-run, eikona-handle, eikona-collection, eikona-batch, auctra-project, auctra-scene, scaena-episode, scaena-breakdown, scaena-edit-session)',
        '  sync                  Materialize bound upstream elements into .muweave/',
        '  inspect [element-id]  Inspect index or a single materialized element',
        '  validate              Verify schemas, sha256 digests, path-free and secret-free invariants',
        '  doctor                Check workspace markers (.muweave, .eikona, .auctra, .scaena, .pi) without writing',
      ].join('\n') + '\n',
    )
    return 0
  }

  try {
    switch (cmd) {
      case 'init': {
        const manifest = await initBundle(workspaceDir, {
          title: typeof flags.title === 'string' ? flags.title : undefined,
          projectId: typeof flags['project-id'] === 'string' ? flags['project-id'] : undefined,
        })
        emit({ ok: true, command: 'muweave-bundle.init', projectId: manifest.projectId, revision: manifest.revision }, flags, 'muweave-bundle.init')
        return 0
      }
      case 'bind': {
        const target = positional[1] as BindingTargetKind | undefined
        const ref = positional[2]
        if (!target || !ref) {
          emit({ ok: false, error: { code: 'invalid_arguments', message: 'Usage: muweave-bundle bind <target> <ref>' } }, flags, 'muweave-bundle.bind')
          return 2
        }
        const manifest = await bindBundleRef(workspaceDir, target, ref)
        emit({ ok: true, command: 'muweave-bundle.bind', target, ref, revision: manifest.revision }, flags, 'muweave-bundle.bind')
        return 0
      }
      case 'sync': {
        const index = await syncBundle({ workspaceDir })
        emit(
          {
            ok: true,
            command: 'muweave-bundle.sync',
            projectId: index.projectId,
            revision: index.revision,
            counts: index.counts,
            ownerStates: index.ownerStates,
          },
          flags,
          'muweave-bundle.sync',
        )
        return 0
      }
      case 'inspect': {
        const elementId = positional[1]
        if (elementId) {
          const element = await readElementFromDisk(workspaceDir, elementId)
          emit({ ok: true, command: 'muweave-bundle.inspect', element }, flags, 'muweave-bundle.inspect')
        } else {
          const index = await readBundleIndexFromDisk(workspaceDir)
          emit({ ok: true, command: 'muweave-bundle.inspect', index }, flags, 'muweave-bundle.inspect')
        }
        return 0
      }
      case 'validate': {
        const report = await validateBundleOnDisk(workspaceDir)
        emit({ command: 'muweave-bundle.validate', ...report }, flags, 'muweave-bundle.validate')
        return report.ok ? 0 : 1
      }
      case 'doctor': {
        const ws = path.resolve(workspaceDir)
        const markers = {
          muweave: existsSync(path.join(muweaveRoot(ws), 'bundle.v1.json')),
          eikona: existsSync(path.join(ws, '.eikona')),
          auctra: existsSync(path.join(ws, '.auctra')),
          scaena: existsSync(path.join(ws, '.scaena', 'project.json')),
          pi: existsSync(path.join(ws, '.pi')),
        }
        emit({ ok: true, command: 'muweave-bundle.doctor', markers }, flags, 'muweave-bundle.doctor')
        return 0
      }
      default:
        emit({ ok: false, error: { code: 'unknown_command', message: `Unknown command: ${cmd}` } }, flags, `muweave-bundle.${cmd}`)
        return 2
    }
  } catch (err) {
    emit(
      {
        ok: false,
        error: {
          code: err instanceof BundleValidationError ? err.code : 'execution_failed',
          message: err instanceof Error ? err.message : 'Unexpected failure',
        },
      },
      flags,
      `muweave-bundle.${cmd}`,
    )
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMuweaveBundleCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
