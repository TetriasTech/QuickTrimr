export default function Loading() {
  return (
    <main
      className="mx-auto max-w-xl px-6 py-16"
      role="status"
      aria-live="polite"
    >
      <p className="text-muted-foreground">Loading admin workspace…</p>
    </main>
  );
}
