import type { ReactNode } from 'react';

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions}
    </header>
  );
}
export function DetailPanel({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
const navigation = [
  ['/', 'Overview'],
  ['/clients', 'Clients'],
  ['/barbers', 'Barbers'],
  ['/bookings', 'Bookings'],
  ['/payments', 'Payments'],
  ['/payouts', 'Payouts'],
  ['/service-categories', 'Services'],
  ['/audit-logs', 'Audit logs'],
] as const;
// Presentation, NOT an auth boundary. Server layouts await requireAdmin before
// supplying identity/children. Native anchors do not prefetch private data.
export function AdminShell({
  adminUserId,
  children,
}: {
  adminUserId: string;
  children: ReactNode;
}) {
  return (
    <div
      data-admin-shell
      className="min-h-screen lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]"
    >
      <aside className="border-b bg-white px-5 py-6 lg:border-r lg:border-b-0">
        <p className="text-xl font-bold text-primary">
          QuickTrimr
          <span className="mt-1 block text-xs font-medium tracking-widest text-muted-foreground uppercase">
            Operations
          </span>
        </p>
        <nav
          aria-label="Admin navigation"
          className="mt-6 flex flex-wrap gap-1 lg:flex-col"
        >
          {navigation.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {label}
            </a>
          ))}
        </nav>
        <p className="mt-6 text-xs text-muted-foreground">
          Tools for marketplace operations.
        </p>
      </aside>
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-6 py-4">
          <span className="text-sm font-semibold">Admin workspace</span>
          <span className="max-w-full truncate text-xs text-muted-foreground">
            Account: {adminUserId}
          </span>
        </header>
        <main className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
