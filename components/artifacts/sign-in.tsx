import Link from 'next/link';
import { signInPath } from '@/lib/auth';

export function SignIn({ returnTo = '/' }: { returnTo?: string }) {
  const loginPath = signInPath(returnTo);
  return (
    <main className="sign-in">
      <Link href="/" className="wordmark">
        open-artifacts<span>.</span>
      </Link>
      <p className="eyebrow">A PRIVATE SPACE FOR WORK IN PROGRESS</p>
      <h1>
        Your work,
        <br />
        with room for notes.
      </h1>
      <p>
        {loginPath
          ? 'Sign in to open your artifact library.'
          : 'Connect through Tailscale from a device owned by the library owner.'}
      </p>
      {loginPath && (
        <a className="sign-in-button" href={loginPath} target="_top">
          Sign in with ChatGPT
        </a>
      )}
    </main>
  );
}
