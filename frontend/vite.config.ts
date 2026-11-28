import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

const previewSecurityHeaders = {
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
}

// Vite dev injects an inline React Fast Refresh preamble and uses WebSocket HMR.
const devSecurityHeaders = {
  ...previewSecurityHeaders,
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ws: http://127.0.0.1:8080 http://localhost:8080; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
}

const apiProxy = {
  '/api': {
    target: 'http://127.0.0.1:8080',
    changeOrigin: true,
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    sourcemap: false,
  },
  server: {
    headers: devSecurityHeaders,
    proxy: apiProxy,
  },
  preview: {
    headers: previewSecurityHeaders,
    proxy: apiProxy,
  },
})
