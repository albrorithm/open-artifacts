import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parseEnv } from 'node:util';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readTailscaleConfig } from '../lib/auth/tailscale';
import { registerArtifactTools } from '../lib/artifacts/mcp';
import { identityFingerprint } from '../lib/probe-identity';

// Local stdio uses the OS user's access to the server settings and data.
// It opens no network listener and does not manufacture proxy headers.
async function main() {
  const [, , flag, configFile, ...extra] = process.argv;
  if (
    flag !== '--config' ||
    !configFile ||
    !isAbsolute(configFile) ||
    extra.length
  )
    throw new Error('Use --config with an absolute self-hosted settings file.');
  const settings = parseEnv(readFileSync(configFile, 'utf8'));
  const config = readTailscaleConfig(settings);
  const dataDirectory = settings.OPEN_ARTIFACTS_DATA_DIR;
  if (!dataDirectory || !isAbsolute(dataDirectory))
    throw new Error(
      'Set an absolute private data directory in the settings file.',
    );
  process.umask(0o077);
  process.env.OPEN_ARTIFACTS_DATA_DIR = dataDirectory;
  const owner = `tailscale:${config.ownerLogin}`;
  const server = new McpServer({ name: 'open-artifacts', version: '1.0.0' });
  server.registerTool(
    'probe_identity',
    {
      description:
        'Check the local MCP connection and return an opaque fingerprint for the configured library owner.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const result = {
        identity_fingerprint: await identityFingerprint(owner),
        phase: 'artifact-library',
        connection: 'local-stdio',
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
  registerArtifactTools(server, owner, config.origin);
  await server.connect(new StdioServerTransport());
}

main().catch(() => {
  console.error(
    'Cannot start local Open Artifacts MCP. Check the private settings file, owner, origin, and data directory.',
  );
  process.exitCode = 1;
});
