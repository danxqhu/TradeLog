import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api/market/events': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // SSE 需要关闭缓冲和超时
        configure: (proxy) => {
          proxy.on('proxyRes', (proxyRes) => {
            proxyRes.headers['cache-control'] = 'no-cache'
            proxyRes.headers['x-accel-buffering'] = 'no'
          })
        },
        timeout: 0,
      },
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // echarts + zrender 体积最大，单独拆一个 chunk，只让追资金 K 线图页面去加载
        manualChunks(id) {
          if (
            id.includes('node_modules/echarts') ||
            id.includes('node_modules/zrender') ||
            id.includes('node_modules/echarts-for-react')
          ) return 'echarts'
        },
      },
    },
  },
})
