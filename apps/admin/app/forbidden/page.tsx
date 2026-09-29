import Link from 'next/link';

export default function ForbiddenPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-16">
      <h1 className="text-3xl font-semibold">Admin access required</h1>
      <p className="mt-4 text-muted-foreground">
        This workspace is restricted to authorised administrators.
      </p>
      <Link
        href="/login"
        className="mt-6 inline-block underline underline-offset-4"
      >
        Return to sign-in information
      </Link>
    </main>
  );
}
