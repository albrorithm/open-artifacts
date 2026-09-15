import { getPrincipal } from '@/lib/auth';
import { SignIn } from '@/components/artifacts/sign-in';
import { Viewer } from '@/components/artifacts/viewer';
export const dynamic = 'force-dynamic';
export default async function RevisionPage({
  params,
}: {
  params: Promise<{ artifactId: string; revisionId: string }>;
}) {
  const { artifactId, revisionId } = await params;
  return (await getPrincipal()) ? (
    <Viewer
      key={`${artifactId}/${revisionId}`}
      artifactId={artifactId}
      revisionId={revisionId}
    />
  ) : (
    <SignIn returnTo={`/a/${artifactId}/r/${revisionId}`} />
  );
}
