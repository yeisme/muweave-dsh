import { execFileSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workDir = path.join(rootDir, '.work')
await mkdir(workDir, { recursive: true })

execFileSync('node', [path.join(rootDir, 'scripts/build-all.mjs')], { cwd: rootDir, stdio: 'inherit' })

const pluginDirs = [
  'dsh-muweave-workbench',
  'dsh-muweave-eikona',
  'dsh-muweave-script',
  'dsh-muweave-drama',
  'dsh-muweave-kit',
  'dsh-muweave-schedule',
]

for (const dir of pluginDirs) {
  const pkgRoot = path.join(rootDir, 'packages', dir)
  const pkgJson = JSON.parse(await readFile(path.join(pkgRoot, 'package.json'), 'utf8'))
  const slug = pkgJson.name.replace(/^@/, '').replace(/\//g, '-')
  const outTgz = path.join(workDir, `${slug}-${pkgJson.version}.tgz`)
  execFileSync('pnpm', ['pack', '--out', outTgz], { cwd: pkgRoot, stdio: 'inherit' })
  process.stdout.write(`Packed ${outTgz}\n`)
}
