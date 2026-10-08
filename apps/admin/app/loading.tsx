import { LoadingState } from '@/components/admin/states';

export default function Loading() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <LoadingState label="Loading admin workspace…" />
    </main>
  );
}
