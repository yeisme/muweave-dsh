import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const rootDir = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: '@yeisme/muweave-bundle/consumer', replacement: path.join(rootDir, 'packages/muweave-bundle/src/consumer.ts') },
      { find: '@yeisme/muweave-bundle', replacement: path.join(rootDir, 'packages/muweave-bundle/src/index.ts') },
      { find: '@yeisme/dsh-muweave-core/client', replacement: path.join(rootDir, 'packages/dsh-muweave-core/src/client/index.tsx') },
      { find: '@yeisme/dsh-muweave-core/protocol', replacement: path.join(rootDir, 'packages/dsh-muweave-core/src/protocol.ts') },
      { find: '@yeisme/dsh-muweave-core', replacement: path.join(rootDir, 'packages/dsh-muweave-core/src/index.ts') },
      { find: '@yeisme/dsh-muweave-workbench/client', replacement: path.join(rootDir, 'packages/dsh-muweave-workbench/src/client.tsx') },
      { find: '@yeisme/dsh-muweave-workbench', replacement: path.join(rootDir, 'packages/dsh-muweave-workbench/src/index.ts') },
      { find: '@yeisme/dsh-muweave-eikona/client', replacement: path.join(rootDir, 'packages/dsh-muweave-eikona/src/client.tsx') },
      { find: '@yeisme/dsh-muweave-eikona', replacement: path.join(rootDir, 'packages/dsh-muweave-eikona/src/index.ts') },
      { find: '@yeisme/dsh-muweave-script/client', replacement: path.join(rootDir, 'packages/dsh-muweave-script/src/client.tsx') },
      { find: '@yeisme/dsh-muweave-script', replacement: path.join(rootDir, 'packages/dsh-muweave-script/src/index.ts') },
      { find: '@yeisme/dsh-muweave-drama/client', replacement: path.join(rootDir, 'packages/dsh-muweave-drama/src/client.tsx') },
      { find: '@yeisme/dsh-muweave-drama', replacement: path.join(rootDir, 'packages/dsh-muweave-drama/src/index.ts') },
      { find: '@yeisme/dsh-muweave-kit/client', replacement: path.join(rootDir, 'packages/dsh-muweave-kit/src/client.tsx') },
      { find: '@yeisme/dsh-muweave-schedule/client', replacement: path.join(rootDir, 'packages/dsh-muweave-schedule/src/client.tsx') },
      { find: '@yeisme/dsh-muweave-schedule', replacement: path.join(rootDir, 'packages/dsh-muweave-schedule/src/index.ts') },
      { find: '@yeisme/dsh-muweave-kit', replacement: path.join(rootDir, 'packages/dsh-muweave-kit/src/index.ts') },
    ],
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}', 'packages/*/tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: false,
  },
})
