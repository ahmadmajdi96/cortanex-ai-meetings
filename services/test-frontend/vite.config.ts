import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [ react() ],
  server: {
    host: '0.0.0.0',
    port: 5174,
    strictPort: true,
    proxy: {
      '/api/jitsi': {
        target: 'http://token-service:3030',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/api\/jitsi/, '/v1')
      }
    }
  }
});
