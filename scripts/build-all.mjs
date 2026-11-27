import { build } from 'esbuild'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgsDir = path.join(rootDir, 'packages')

/**
 * Strictly verified DSH browser seed modules (dsh-plugin-development).
 * Client lazy-CJS bundles MUST externalize React and DSH seed modules so no duplicate React or
 * Node built-in ever enters window.__ModuleLoader__.
 */
export const DSH_BROWSER_SEED_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-layout',
]

const NODE_EXTERNALS = [
  '@deepseek-ai/*',
]

const aliasMap = {
  '@yeisme/muweave-bundle/consumer': path.join(pkgsDir, 'muweave-bundle/src/consumer.ts'),
  '@yeisme/muweave-bundle': path.join(pkgsDir, 'muweave-bundle/src/index.ts'),
  '@yeisme/dsh-muweave-core/client': path.join(pkgsDir, 'dsh-muweave-core/src/client/index.tsx'),
  '@yeisme/dsh-muweave-core/protocol': path.join(pkgsDir, 'dsh-muweave-core/src/protocol.ts'),
  '@yeisme/dsh-muweave-core': path.join(pkgsDir, 'dsh-muweave-core/src/index.ts'),
}

async function buildBundlePackage() {
  const outDir = path.join(pkgsDir, 'muweave-bundle/lib')
  await mkdir(outDir, { recursive: true })
  await build({
    entryPoints: {
      index: path.join(pkgsDir, 'muweave-bundle/src/index.ts'),
      cli: path.join(pkgsDir, 'muweave-bundle/src/cli.ts'),
    },
    outdir: outDir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: true,
  })
  await chmod(path.join(outDir, 'cli.js'), 0o755)

  // Pure browser-safe consumer bundle
  await build({
    entryPoints: {
      consumer: path.join(pkgsDir, 'muweave-bundle/src/consumer.ts'),
    },
    outdir: outDir,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    target: 'es2022',
    sourcemap: true,
  })
}

async function buildCorePackage() {
  const outDir = path.join(pkgsDir, 'dsh-muweave-core/lib')
  await mkdir(outDir, { recursive: true })
  const suppressNestedBundleCliAutoExec = {
    name: 'suppress-nested-bundle-cli-auto-exec',
    setup(b) {
      b.onLoad({ filter: /packages[\\/]muweave-bundle[\\/]src[\\/]cli\.ts$/ }, async (args) => {
        const src = await readFile(args.path, 'utf8')
        return {
          contents: src.replace(/if\s*\(\s*import\.meta\.url\s*===[\s\S]*$/, ''),
          loader: 'ts',
        }
      })
    },
  }
  await build({
    entryPoints: {
      index: path.join(pkgsDir, 'dsh-muweave-core/src/index.ts'),
      protocol: path.join(pkgsDir, 'dsh-muweave-core/src/protocol.ts'),
      cli: path.join(pkgsDir, 'dsh-muweave-core/src/cli.ts'),
      mcp: path.join(pkgsDir, 'dsh-muweave-core/src/mcp/server.ts'),
    },
    outdir: outDir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    alias: aliasMap,
    external: NODE_EXTERNALS,
    plugins: [suppressNestedBundleCliAutoExec],
    sourcemap: true,
  })
  await chmod(path.join(outDir, 'cli.js'), 0o755)
  await build({
    entryPoints: {
      client: path.join(pkgsDir, 'dsh-muweave-core/src/client/index.tsx'),
    },
    outdir: outDir,
    bundle: true,
    platform: 'browser',
    format: 'esm',
    jsx: 'automatic',
    target: 'es2022',
    alias: aliasMap,
    external: DSH_BROWSER_SEED_EXTERNALS,
    sourcemap: true,
  })
}

const PLUGINS = [
  { dir: 'dsh-muweave-workbench', id: '@yeisme/dsh-muweave-workbench' },
  { dir: 'dsh-muweave-eikona', id: '@yeisme/dsh-muweave-eikona' },
  { dir: 'dsh-muweave-script', id: '@yeisme/dsh-muweave-script' },
  { dir: 'dsh-muweave-drama', id: '@yeisme/dsh-muweave-drama' },
  { dir: 'dsh-muweave-kit', id: '@yeisme/dsh-muweave-kit' },
  { dir: 'dsh-muweave-schedule', id: '@yeisme/dsh-muweave-schedule' },
]

async function buildDshPlugin(plugin) {
  const pkgRoot = path.join(pkgsDir, plugin.dir)
  const outDir = path.join(pkgRoot, 'lib')
  await mkdir(outDir, { recursive: true })

  // 1. Self-contained Node ESM host bundle (bundles @yeisme/* internal workspace deps cleanly so
  //    standalone `.tgz` installation in any DSH profile needs zero external workspace symlinks!)
  await build({
    entryPoints: {
      index: path.join(pkgRoot, 'src/index.ts'),
    },
    outdir: outDir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    alias: aliasMap,
    external: NODE_EXTERNALS,
    sourcemap: true,
  })

  // 2. Lazy-CJS browser client bundle wrapped in window.__ModuleLoader__.load(...)
  const clientBuild = await build({
    entryPoints: [path.join(pkgRoot, 'src/client.tsx')],
    bundle: true,
    platform: 'browser',
    format: 'cjs',
    jsx: 'automatic',
    target: 'es2022',
    alias: aliasMap,
    external: DSH_BROWSER_SEED_EXTERNALS,
    write: false,
  })

  const rawCjs = clientBuild.outputFiles[0].text
  const wrapped = `window.__ModuleLoader__.load({id:${JSON.stringify(plugin.id)},factory:(require)=>{var module={exports:{}};var exports=module.exports;\n${rawCjs}\nreturn module.exports;}});\n`
  await writeFile(path.join(outDir, 'client.js'), wrapped, 'utf8')
}

await buildBundlePackage()
await buildCorePackage()
for (const plugin of PLUGINS) {
  await buildDshPlugin(plugin)
}
process.stdout.write(`Built 2 core packages + ${PLUGINS.length} DSH plugins successfully.\n`)
