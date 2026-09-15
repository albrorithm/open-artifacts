import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  authenticationRequired,
  hostingTarget,
  getPrincipal,
  requestOriginAllowed,
} from '@/lib/auth';
import { identityFingerprint } from '@/lib/probe-identity';
import { registerArtifactTools } from '@/lib/artifacts/mcp';
import { readTailscaleConfig } from '@/lib/auth/tailscale';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  if (!requestOriginAllowed(request)) {
    return Response.json(
      { error: 'Origin not allowed' },
      {
        status: 403,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  const principal = await getPrincipal();
  if (!principal) return authenticationRequired();

  let parsedBody: unknown;
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Missing request body.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        return Response.json(
          { error: 'Request is too large.' },
          { status: 413, headers: { 'Cache-Control': 'no-store' } },
        );
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    parsedBody = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return Response.json(
      { error: 'Invalid JSON request.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const server = new McpServer({
    name:
      hostingTarget === 'selfhost' ? 'open-artifacts' : 'open-artifacts-probe',
    version: '1.0.0',
  });
  server.registerTool(
    'probe_identity',
    {
      description:
        'Return an opaque account fingerprint to compare MCP and browser identity. Stores no data.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const result = {
        identity_fingerprint: await identityFingerprint(principal.id),
        phase:
          hostingTarget === 'selfhost'
            ? 'artifact-library'
            : 'authentication-probe',
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    },
  );
  if (hostingTarget === 'selfhost')
    registerArtifactTools(
      server,
      principal.id,
      readTailscaleConfig(process.env).origin,
    );

  // Each request gets its own transport and identity. No account state is
  // retained between requests in either runtime.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request, { parsedBody });
    response.headers.set('Cache-Control', 'no-store');
    return response;
  } finally {
    await server.close();
  }
}

export function GET(): Response {
  return new Response(null, {
    status: 405,
    headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
  });
}

export const DELETE = GET;
