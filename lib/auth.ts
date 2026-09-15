import { headers } from 'next/headers';
import { getChatGPTUser, chatGPTSignInPath } from '@/app/chatgpt-auth';
import {
  authenticateTailscale,
  isAllowedOrigin,
  readTailscaleConfig,
  type OwnerPrincipal,
} from '@/lib/auth/tailscale';

// Fixed by the build target, never selected from caller-provided headers.
export const hostingTarget = __OPEN_ARTIFACTS_TARGET__;

export async function getPrincipal(): Promise<OwnerPrincipal | null> {
  if (hostingTarget === 'selfhost') {
    return authenticateTailscale(
      await headers(),
      readTailscaleConfig(process.env),
    );
  }

  // Sites' private dispatcher owns this boundary. Its local simulator is only
  // for local tests and is not evidence of working production OAuth.
  const user = await getChatGPTUser();
  return user ? { id: user.userId, provider: 'sites', role: 'owner' } : null;
}

export function requestOriginAllowed(request: Request): boolean {
  const expectedOrigin =
    hostingTarget === 'selfhost'
      ? readTailscaleConfig(process.env).origin
      : new URL(request.url).origin;
  return isAllowedOrigin(request.headers, expectedOrigin);
}

export function signInPath(returnTo: string): string | null {
  return hostingTarget === 'sites' ? chatGPTSignInPath(returnTo) : null;
}

export function authenticationRequired(): Response {
  const responseHeaders: Record<string, string> = {
    'Cache-Control': 'no-store',
  };
  // Tailnet network identity is not a Bearer/OAuth implementation.
  if (hostingTarget === 'sites') responseHeaders['WWW-Authenticate'] = 'Bearer';
  return Response.json(
    {
      error:
        hostingTarget === 'selfhost'
          ? 'Owner authentication required through private Tailscale Serve.'
          : 'Authentication required',
    },
    { status: 401, headers: responseHeaders },
  );
}
