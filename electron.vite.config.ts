import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve('src/shared')

function flowTokens() {
  return {
    name: 'flow-tokens',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?')[0]?.replace(/\\/g, '/')
      if (!file?.includes('/@xyflow/react/dist/style.css')) return null
      const tokenized = code
        .replace(/rgba?\([^)]*\)/g, 'var(--line)')
        .replace(/hsla?\([^)]*\)/g, 'var(--line)')
        .replace(/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g, 'var(--line)')
      return { code: tokenized, map: null }
    },
  }
}

const testClock =
  process.env.BRANCHLOG_ENABLE_TEST_CLOCK === '1' ||
  process.env.npm_lifecycle_event === 'test' ||
  process.env.npm_lifecycle_event === 'test:e2e'

export default defineConfig(({ command }) => {
  const define = {
    __BRANCHLOG_TEST_CLOCK__: command === 'serve' || testClock ? 'true' : 'false',
  }
  return {
    main: {
      define,
      plugins: [externalizeDepsPlugin()],
      resolve: { alias: { '@shared': shared } },
    },
    preload: {
      define,
      plugins: [externalizeDepsPlugin()],
      resolve: { alias: { '@shared': shared } },
      build: {
        lib: {
          entry: resolve('src/preload/index.ts'),
          formats: ['cjs'],
          fileName: () => 'index.js',
        },
      },
    },
    renderer: {
      define,
      plugins: [flowTokens(), react(), tailwindcss()],
      resolve: { alias: { '@shared': shared } },
      build: {
        sourcemap: process.env.BRANCHLOG_SOURCEMAP === '1',
      },
    },
  }
})
