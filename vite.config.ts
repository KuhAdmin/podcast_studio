import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiTarget = `http://localhost:${process.env.PORT ?? 3001}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 6173,
    strictPort: true,
    proxy: {
      '/api': apiTarget,
      '/files': apiTarget,
    },
  },
  build: { outDir: '../dist', emptyOutDir: true },
});
