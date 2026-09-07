import { defineConfig } from 'vitest/config';
import path from 'node:path';

// The engine tests import relatively and never needed this. `lib/compute.ts`
// is imported by React components as well as by tests, so it uses the `@/`
// alias tsconfig defines — which vitest has to be told about separately.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    include: ['lib/**/*.test.ts'],
  },
});
