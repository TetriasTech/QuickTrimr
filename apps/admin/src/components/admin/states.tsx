import type { ReactNode } from 'react';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="rounded-xl border bg-muted/40 p-6 text-muted-foreground"
    >
      {label}
    </div>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-dashed p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      {description && (
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </section>
  );
}
export function ErrorState({
  title = 'Could not load',
  action,
}: {
  title?: string;
  action?: ReactNode;
}) {
  return (
    <section role="alert" className="rounded-xl border p-6">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Please try again. No operational details are shown here.
      </p>
      {action && <div className="mt-4">{action}</div>}
    </section>
  );
}
