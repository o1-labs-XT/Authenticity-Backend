import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    env: loadEnv(mode, process.cwd(), ''),
  },
}));
