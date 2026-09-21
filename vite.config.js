import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { pdfLabPwa } from './pwa/vitePlugin.js'

export default defineConfig({
  // Every production build (plain `vite build` included) emits dist/sw.js with a
  // content-hashed precache inventory and a manifest whose id matches `base`.
  plugins: [react(), pdfLabPwa()],
  server: {
    port: 3000,
    host: '0.0.0.0',
    allowedHosts: ['.e2b.app']
  },
  preview: {
    allowedHosts: ['.e2b.app']
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util']
  }
})
