import { getPrincipal, hostingTarget, signInPath } from '@/lib/auth';
import { identityFingerprint } from '@/lib/probe-identity';
import { Button } from '@/components/ui/button';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const principal = await getPrincipal();
  const fingerprint = principal
    ? await identityFingerprint(principal.id)
    : null;
  const loginPath = signInPath('/');

  return (
    <main className="mx-auto max-w-2xl px-6 py-16 sm:py-24">
      <p className="mb-6 text-sm font-medium text-primary">Open Artifacts</p>
      <h1 className="text-3xl font-semibold tracking-tight">
        Private connection check
      </h1>
      <p className="mt-4 text-base leading-7 text-muted-foreground">
        Compare this account check code with the code returned by your MCP
        client to confirm that both connections reach the same private account.
      </p>
      <section
        className="mt-8 rounded-xl border bg-card p-6"
        aria-labelledby="connection-heading"
      >
        <h2 id="connection-heading" className="text-lg font-semibold">
          {principal ? 'Browser owner verified' : 'Owner authentication needed'}
        </h2>
        {fingerprint ? (
          <>
            <p className="mt-3 text-base text-muted-foreground">
              Your MCP client must return this same account check code through
              its own connection.
            </p>
            <p className="mt-4 break-all font-mono text-base">{fingerprint}</p>
          </>
        ) : loginPath ? (
          <>
            <p className="mt-3 text-base text-muted-foreground">
              Open the private hosted page and sign in to begin the check.
            </p>
            <Button
              className="mt-5 min-h-11 px-5 text-base"
              nativeButton={false}
              render={
                <a
                  href={loginPath}
                  target="_top"
                  aria-label="Sign in with ChatGPT"
                />
              }
            >
              Sign in with ChatGPT
            </Button>
          </>
        ) : (
          <p className="mt-3 text-base text-muted-foreground">
            Open this host through private Tailscale Serve from a device owned
            by the configured owner. Direct access and tagged client devices are
            not supported. There is no separate browser login or bearer token.
          </p>
        )}
      </section>
      <p className="mt-6 text-sm leading-6 text-muted-foreground">
        {hostingTarget === 'selfhost'
          ? 'Tailscale connection.'
          : 'GPT Sites probe.'}{' '}
        No artifacts or comments are stored by this connection check.
      </p>
    </main>
  );
}
