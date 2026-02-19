import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  root: 'app/static',
  resolve: {
    dedupe: ['three']
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8000'
    }
  },
  build: {
    outDir: '../../dist',
    emptyOutDir: true,
    commonjsOptions: {
      transformMixedEsModules: true
    }
  }
})