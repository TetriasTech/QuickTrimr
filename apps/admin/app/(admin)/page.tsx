import { requireAdmin } from '@/lib/auth/require-admin';

export default async function AdminPage() {
  // Layouts and pages can render independently. Verify here BEFORE any future fetch.
  await requireAdmin();
  return (
    <section aria-labelledby="admin-heading">
      <h1 id="admin-heading" className="text-3xl font-semibold">
        Admin workspace
      </h1>
      <p className="mt-4 text-muted-foreground">No operational screens yet.</p>
      <p className="mt-2 text-muted-foreground">
        The admin layout and tools will arrive in later tickets.
      </p>
    </section>
  );
}
