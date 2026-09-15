import { getPrincipal } from '@/lib/auth';
import { SignIn } from '@/components/artifacts/sign-in';
import { Viewer } from '@/components/artifacts/viewer';
export const dynamic = 'force-dynamic';
export default async function ArtifactPage({
  params,
}: {
  params: Promise<{ artifactId: string }>;
}) {
  const { artifactId } = await params;
  return (await getPrincipal()) ? (
    <Viewer key={artifactId} artifactId={artifactId} />
  ) : (
    <SignIn returnTo={`/a/${artifactId}`} />
  );
}
