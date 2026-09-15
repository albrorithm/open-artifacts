import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

export default defineConfig(async () => {
  const target = process.env.OPEN_ARTIFACTS_TARGET ?? 'sites';
  if (target !== 'sites' && target !== 'selfhost') {
    throw new Error('OPEN_ARTIFACTS_TARGET must be sites or selfhost.');
  }
  const common = {
    resolve: {
      alias: {
        '#artifact-storage': fileURLToPath(
          new URL(
            target === 'selfhost'
              ? './lib/artifacts/storage-node.ts'
              : './lib/artifacts/storage-sites.ts',
            import.meta.url,
          ),
        ),
      },
    },
    define: { __OPEN_ARTIFACTS_TARGET__: JSON.stringify(target) },
    css: { postcss: { plugins: [tailwindcss()] } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
  };

  if (target === 'selfhost') {
    return {
      ...common,
      plugins: [vinext({ nextConfig: { output: 'standalone' } })],
    };
  }

  // Keep platform imports and bindings out of the Node build. Wrangler
  // snapshots its log path while the Cloudflare plugin is imported.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';
  const { sites } = await import('@openai/sites-vite-plugin');
  const { cloudflare } = await import('@cloudflare/vite-plugin');
  const { default: hostingConfig } = await import('./.openai/hosting.json');
  const { d1, r2 } = hostingConfig;

  const localBindingConfig = {
    main: 'vinext/server/fetch-handler',
    compatibility_flags: ['nodejs_compat'],
    d1_databases: d1
      ? [
          {
            binding: d1,
            database_name: 'site-creator-d1',
            database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
          },
        ]
      : [],
    r2_buckets: r2 ? [{ binding: r2, bucket_name: 'site-creator-r2' }] : [],
  };

  return {
    ...common,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
