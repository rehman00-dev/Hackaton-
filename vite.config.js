import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    watch: {
      ignored: ['**/dist.zip'],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      }
    }
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.replace(/\\/g, '/');
          if (!normalizedId.includes('/node_modules/')) return undefined;
          if (/\/node_modules\/(recharts|d3-[^/]+|victory-vendor)\//.test(normalizedId)) return 'charts';
          if (/\/node_modules\/(motion|framer-motion)\//.test(normalizedId)) return 'motion';
          if (normalizedId.includes('/node_modules/lucide-react/')) return 'icons';
          if (/\/node_modules\/(react|react-dom|scheduler)\//.test(normalizedId)) return 'react-vendor';
          return undefined;
        }
      }
    }
  }
});
