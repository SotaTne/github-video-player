import { createRequire } from 'node:module';
import { defineConfig } from 'vitest/config';

const requireFromSolidModule = createRequire(import.meta.resolve('@wxt-dev/module-solid'));
const solid = requireFromSolidModule('vite-plugin-solid');

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: 'happy-dom',
    globals: true,
    passWithNoTests: true,
    setupFiles: ['./test/setup.ts'],
  },
  resolve: {
    conditions: ['development', 'browser'],
  },
});
