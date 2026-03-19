import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // 🔥 匹配你的路徑 /botagents/
  base: '/botagents/',
  server: {
    port: 3000,
    open: '/botagents/',  // 自動開啟正確路徑
    hmr: {
      // 本地開發 HMR
      host: 'localhost',
      port: 3000,
      clientPort: 3000
    },
    watch: {
      usePolling: true
    }
  },
  preview: {
    port: 3000,
    open: '/botagents/'
  }
})
