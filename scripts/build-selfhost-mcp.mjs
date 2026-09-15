import { build } from 'vite';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
await build({
  configFile: false,
  root: fileURLToPath(root),
  resolve: {
    alias: {
      '#artifact-storage': fileURLToPath(
        new URL('lib/artifacts/storage-node.ts', root),
      ),
    },
  },
  ssr: { noExternal: true },
  build: {
    ssr: fileURLToPath(new URL('scripts/mcp-stdio.ts', root)),
    outDir: fileURLToPath(new URL('dist/standalone/mcp', root)),
    emptyOutDir: true,
    rolldownOptions: { output: { entryFileNames: 'server.mjs', format: 'es' } },
  },
});
