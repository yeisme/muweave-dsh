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

function emit(payload: Record<string, unknown>, flags: Record<string, string | boolean>): void {
  if (flags.json) {
    process.stdout.write(`${JSON.stringify(payload)}\n`)
    return
  }
  if (flags.agent) {
    const lines = Object.entries(payload).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    process.stdout.write(`${lines.join('\n')}\n`)
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
        emit({ ok: true, command: 'muweave-bundle.init', projectId: manifest.projectId, revision: manifest.revision }, flags)
        return 0
      }
      case 'bind': {
        const target = positional[1] as BindingTargetKind | undefined
        const ref = positional[2]
        if (!target || !ref) {
          emit({ ok: false, error: { code: 'invalid_arguments', message: 'Usage: muweave-bundle bind <target> <ref>' } }, flags)
          return 2
        }
        const manifest = await bindBundleRef(workspaceDir, target, ref)
        emit({ ok: true, command: 'muweave-bundle.bind', target, ref, revision: manifest.revision }, flags)
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
        )
        return 0
      }
      case 'inspect': {
        const elementId = positional[1]
        if (elementId) {
          const element = await readElementFromDisk(workspaceDir, elementId)
          emit({ ok: true, command: 'muweave-bundle.inspect', element }, flags)
        } else {
          const index = await readBundleIndexFromDisk(workspaceDir)
          emit({ ok: true, command: 'muweave-bundle.inspect', index }, flags)
        }
        return 0
      }
      case 'validate': {
        const report = await validateBundleOnDisk(workspaceDir)
        emit({ command: 'muweave-bundle.validate', ...report }, flags)
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
        emit({ ok: true, command: 'muweave-bundle.doctor', markers }, flags)
        return 0
      }
      default:
        emit({ ok: false, error: { code: 'unknown_command', message: `Unknown command: ${cmd}` } }, flags)
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
    )
    return 1
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runMuweaveBundleCli(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
