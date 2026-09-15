// The build resolves this provider to Sites or local SQLite, never both.
export { storage } from '#artifact-storage';

export async function digest(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}
