import { defineConfig } from 'vite';
import { swPlugin } from './scripts/sw-plugin.mjs';

export default defineConfig({
  base: './',
  plugins: [swPlugin()],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  test: { environment: 'node', include: ['tests/**/*.test.js'], testTimeout: 60000 },
});
