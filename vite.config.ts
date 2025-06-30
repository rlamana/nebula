import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import path from 'node:path'

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: 'electron/main.ts',
        onstart: () => {
          // Don't auto-start electron - let the npm script handle it
        },
        vite: {
          build: {
            sourcemap: false,
            minify: false,
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['ag-psd', 'utif', 'canvas', 'sharp'],
              output: {
                format: 'cjs'
              }
            }
          }
        }
      },
      {
        entry: 'electron/preload.ts',
        vite: {
          build: {
            sourcemap: false,
            minify: false,
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                format: 'cjs'
              }
            }
          }
        }
      }
    ])
  ],
  server: {
    open: false
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  optimizeDeps: {
    exclude: ['ag-psd', 'utif', 'canvas', 'sharp']
  }
})