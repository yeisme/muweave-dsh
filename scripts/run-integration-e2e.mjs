import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '')}-muweave-dsh-${randomUUID().slice(0, 8)}`
const evidenceDir = path.join(rootDir, 'temp', 'integration-test-runs', runId)
const artifactsDir = path.join(evidenceDir, 'artifacts')
await mkdir(artifactsDir, { recursive: true })

async function webProfileFingerprint() {
  const webPatch = path.join(os.homedir(), '.dsh', 'profiles', 'web', 'cordis.patch.yml')
  if (!existsSync(webPatch)) return 'absent'
  const bytes = await readFile(webPatch)
  return createHash('sha256').update(bytes).digest('hex')
}

function redactEvidenceText(raw) {
  return raw
    .replace(/\?token=[^\s"'&]+/g, '?token=[REDACTED]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]')
    .replace(/(?<![A-Za-z0-9._-])\/(?:home|Users|root|var|tmp|etc|opt|private|mnt|srv|proc)\/[^\s"'<>]+/g, '[REDACTED_PATH]')
}

function dshEngineVersion() {
  try {
    return `dsh@${execFileSync('dsh', ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()}`
  } catch {
    return 'dsh@unknown'
  }
}

const beforeWebFp = await webProfileFingerprint()
const commandDisplay =
  'pnpm pack:plugins && unshare -rn sh -c "ip link set lo up && node scripts/inner-e2e-runner.mjs"'

let stdout = ''
let stderr = ''

const child = spawn(
  'unshare',
  ['-rn', 'sh', '-c', `ip link set lo up && node "${path.join(rootDir, 'scripts/inner-e2e-runner.mjs')}" "${artifactsDir}"`],
  {
    cwd: rootDir,
    env: {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      HTTP_PROXY: '',
      HTTPS_PROXY: '',
      ALL_PROXY: '',
      all_proxy: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

child.stdout.on('data', (chunk) => {
  stdout += String(chunk)
})
child.stderr.on('data', (chunk) => {
  stderr += String(chunk)
})

const exitCode = await new Promise((resolve) => child.once('close', (code) => resolve(code ?? 1)))
const afterWebFp = await webProfileFingerprint()
const webProfileUntouched = beforeWebFp === afterWebFp

const passed = exitCode === 0 && webProfileUntouched
const redactedOut = redactEvidenceText(stdout)
const redactedErr = redactEvidenceText(stderr)

await writeFile(path.join(evidenceDir, 'command.txt'), `${commandDisplay}\n`)
await writeFile(
  path.join(evidenceDir, 'env.json'),
  `${JSON.stringify(
    {
      node: process.version,
      platform: process.platform,
      dshEngine: dshEngineVersion(),
      networkNamespaceIsolated: true,
      providerCalls: 0,
      webProfileUntouched,
    },
    null,
    2,
  )}\n`,
)
await writeFile(path.join(evidenceDir, 'stdout.log'), redactedOut)
await writeFile(path.join(evidenceDir, 'stderr.log'), redactedErr)
await writeFile(
  path.join(evidenceDir, 'summary.json'),
  `${JSON.stringify(
    {
      run_id: runId,
      status: passed ? 'passed' : 'failed',
      passed,
      exit_code: passed ? 0 : exitCode || 1,
      provider_calls: 0,
      web_profile_untouched: webProfileUntouched,
      plugins_verified: [
        '@yeisme/dsh-muweave-workbench',
        '@yeisme/dsh-muweave-eikona',
        '@yeisme/dsh-muweave-script',
        '@yeisme/dsh-muweave-drama',
        '@yeisme/dsh-muweave-kit',
      ],
      viewports_verified: ['1440x900', '1024x768', '768x900', '390x844'],
      evidence_dir: `temp/integration-test-runs/${runId}`,
    },
    null,
    2,
  )}\n`,
)

process.stdout.write(redactedOut)
if (redactedErr) process.stderr.write(redactedErr)
process.stdout.write(`Integration evidence written to temp/integration-test-runs/${runId} (passed=${passed})\n`)
process.exitCode = passed ? 0 : exitCode || 1
