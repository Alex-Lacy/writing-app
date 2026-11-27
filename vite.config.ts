import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build:single` makes one self-contained HTML file you can double-click or send to someone.
export default defineConfig(({ mode }) => ({
  base: './',
  // Shown in Sync, so we can tell which version a device is running.
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')) },
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  build: mode === 'single' ? { outDir: 'dist-single' } : {},
  test: { include: ['src/**/*.test.ts'] },
}) as any)
