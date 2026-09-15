export interface TailscaleConfig {
  ownerLogin: string;
  origin: string;
}

export interface OwnerPrincipal {
  id: string;
  provider: 'sites' | 'tailscale';
  role: 'owner';
}

/** Deployment settings are server-only. Never include their values in errors. */
export function readTailscaleConfig(
  env: Record<string, string | undefined>,
): TailscaleConfig {
  const ownerLogin = env.OPEN_ARTIFACTS_OWNER_LOGIN;
  if (!ownerLogin || ownerLogin.length > 1024 || /[\s,]/u.test(ownerLogin)) {
    throw new Error('Set OPEN_ARTIFACTS_OWNER_LOGIN to one exact owner login.');
  }

  const origin = env.OPEN_ARTIFACTS_ORIGIN;
  let url: URL;
  try {
    url = new URL(origin ?? '');
  } catch {
    throw new Error('Set OPEN_ARTIFACTS_ORIGIN to the private HTTPS origin.');
  }
  if (url.protocol !== 'https:' || url.origin !== origin) {
    throw new Error(
      'OPEN_ARTIFACTS_ORIGIN must be a canonical HTTPS origin without a path or credentials.',
    );
  }
  return { ownerLogin, origin };
}

/**
 * Trust ONLY behind Tailscale Serve on a loopback-only backend. Serve removes
 * caller-supplied identity headers and inserts its authenticated user login.
 * Other local processes on the backend host remain inside this trust boundary.
 */
export function authenticateTailscale(
  headers: Pick<Headers, 'get'>,
  config: TailscaleConfig,
): OwnerPrincipal | null {
  const login = headers.get('tailscale-user-login');
  if (!login || login !== config.ownerLogin) return null;

  // User-owned clients only. Tagged sources have no user login; app capability
  // headers, bearer tokens, Sites headers, and profile fields are not fallbacks.
  return { id: `tailscale:${login}`, provider: 'tailscale', role: 'owner' };
}

export function isAllowedOrigin(
  headers: Pick<Headers, 'get'>,
  expectedOrigin: string,
): boolean {
  const origin = headers.get('origin');
  // Native MCP clients need not send Origin. Browser null/cross-origin values
  // are rejected, including opaque-origin artifact frames.
  return origin === null || origin === expectedOrigin;
}
