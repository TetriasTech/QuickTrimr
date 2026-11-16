import { AdminLoginForm } from '@/features/auth/auth-forms';
import { adminWorkspaceIdentity } from '@/workspace-contract';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12 sm:px-10">
      <p className="text-sm font-semibold text-primary">
        {adminWorkspaceIdentity.product} Admin
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-tight">
        Admin sign in
      </h1>
      {reason === 'expired' && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          Your session ended. Sign in to continue.
        </p>
      )}
      <AdminLoginForm />
    </main>
  );
}
