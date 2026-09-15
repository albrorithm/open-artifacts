import {
  getPrincipal,
  requestOriginAllowed,
  authenticationRequired,
} from '@/lib/auth';
import { commandSchema } from '@/lib/artifacts/contracts';
import { AppError, executeCommand } from '@/lib/artifacts/service';

export const dynamic = 'force-dynamic';
const response = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });

export async function POST(request: Request) {
  if (!request.headers.get('origin') || !requestOriginAllowed(request))
    return response({ error: 'Origin not allowed.' }, 403);
  const principal = await getPrincipal();
  if (!principal) return authenticationRequired();
  if (
    !request.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    return response({ error: 'Use application/json.' }, 415);
  try {
    const reader = request.body?.getReader();
    if (!reader) return response({ error: 'Request body required.' }, 400);
    const decoder = new TextDecoder();
    let body = '';
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1_000_000) {
        await reader.cancel();
        return response({ error: 'Request is too large.' }, 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      return response({ error: 'Invalid JSON.' }, 400);
    }
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success)
      return response(
        {
          error: 'Invalid request.',
          fields: parsed.error.issues.map((i) => ({
            path: i.path.join('.'),
            message: i.message,
          })),
        },
        400,
      );
    return response(await executeCommand(principal.id, parsed.data));
  } catch (error) {
    if (error instanceof AppError)
      return response({ error: error.message }, error.status);
    // Keep identities, payloads, SQL and private binding values out of logs.
    console.error('Artifact operation failed.');
    return response(
      {
        error:
          'Storage is temporarily unavailable. Your input has been kept; please retry.',
      },
      503,
    );
  }
}
