import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// /api is the separate server in ../server. In development it is proxied there; in production the client calls VITE_API_URL.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const target = env.VITE_DEV_API_TARGET || 'http://localhost:8787'
  return {
    plugins: [react()],
    server: { proxy: { '/api': { target, changeOrigin: true } } },
    preview: { proxy: { '/api': { target, changeOrigin: true } } },
  }
})
