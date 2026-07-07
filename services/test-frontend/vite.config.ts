import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const allowedHosts = (process.env.VITE_ALLOWED_HOSTS || '.trycloudflare.com,70.30.221.109')
  .split(',')
  .map(host => host.trim())
  .filter(Boolean);

export default defineConfig({
  plugins: [ react() ],
  server: {
    allowedHosts,
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
