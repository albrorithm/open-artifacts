export async function identityFingerprint(userId: string): Promise<string> {
  const input = new TextEncoder().encode(
    `open-artifacts:identity-probe:v1:${userId}`,
  );
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}
