import path from 'node:path';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig, defineProject, mergeConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrationsPath = path.join(import.meta.dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);

  return mergeConfig(
    {},
    defineProject({
      plugins: [
        cloudflareTest({
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        }),
      ],
      test: {
        setupFiles: ['./tests/apply-migrations.js'],
      },
    }),
  );
});
