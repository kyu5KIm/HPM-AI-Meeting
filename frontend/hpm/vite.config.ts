import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export default defineConfig({
  cacheDir: join(tmpdir(), 'hpm-vite-cache', String(process.pid)),
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
