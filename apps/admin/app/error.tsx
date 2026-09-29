'use client';

// Next error boundaries need client interactivity to reset a failed render.
import { Button } from '@/components/ui/button';

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-semibold">The workspace could not load</h1>
      <p role="alert" className="my-4 text-muted-foreground">
        Please try again. No operational details are shown here.
      </p>
      <Button variant="outline" onClick={reset}>
        Try again
      </Button>
    </main>
  );
}
