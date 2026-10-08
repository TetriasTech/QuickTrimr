'use client';

// Next error boundaries need client interactivity to reset a failed render.
import { ErrorState } from '@/components/admin/states';
import { Button } from '@/components/ui/button';

export default function ErrorBoundary({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <ErrorState
        title="The workspace could not load"
        action={
          <Button variant="outline" onClick={reset}>
            Try again
          </Button>
        }
      />
    </main>
  );
}
