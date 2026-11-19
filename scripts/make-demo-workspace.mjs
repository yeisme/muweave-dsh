/**
 * Materialize a demo workspace so the MuWeave suite can be opened with real-looking data.
 *
 *   node scripts/make-demo-workspace.mjs --dir ~/workplace/muweave-demo
 *
 * Writes only inside the target directory (`.muweave/`, `.auctra/`, `.scaena/`, `.pi/`, PLAN.md)
 * and never runs an owner CLI: upstream payloads are injected, like the e2e fixture.
 */

import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { prepareFixtureWorkspace } from './fixture-workspace.mjs'

const args = process.argv.slice(2)
const dirFlag = args.indexOf('--dir')
const target = resolve(dirFlag >= 0 ? (args[dirFlag + 1] ?? '') : `${homedir()}/workplace/muweave-demo`)
if (!target || target === resolve('/')) {
  process.stderr.write('usage: node scripts/make-demo-workspace.mjs --dir <workspace-dir>\n')
  process.exit(2)
}

const ws = await prepareFixtureWorkspace({ dir: target })
process.stdout.write(`Demo .muweave/ workspace ready at ${ws}\n`)
process.stdout.write(`Start a preview with:\n  MUWEAVE_WORKSPACE_DIR=${ws} dsh --profile muweave-lan web --port 4283 --no-open\n`)
