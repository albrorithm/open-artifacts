import { getPrincipal } from '@/lib/auth';
import { Library } from '@/components/artifacts/library';
import { SignIn } from '@/components/artifacts/sign-in';

export const dynamic = 'force-dynamic';
export default async function Home() {
  return (await getPrincipal()) ? <Library /> : <SignIn />;
}
