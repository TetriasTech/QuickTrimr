import { Button } from '@/components/ui/button';
import { adminWorkspaceIdentity } from '@/workspace-contract';

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-12 sm:px-10">
      <p className="text-sm font-bold tracking-widest text-primary">
        {adminWorkspaceIdentity.product} / ADMIN
      </p>
      <section aria-labelledby="access-heading" className="mt-10 max-w-xl">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Foundation preview
        </p>
        <h1
          id="access-heading"
          className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl"
        >
          A secure start.
          <br />
          Operations come next.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
          Admin sign-in is not available yet. This shell does not connect to
          customer, booking or payment data.
        </p>
        <div className="mt-8 rounded-md border bg-white p-5">
          <h2 className="font-semibold">Access is closed by default</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            The server denies dashboard access until verified admin
            authentication is implemented. There is no preview account or
            bypass.
          </p>
        </div>
        <form action="/" method="get" className="mt-8">
          <Button type="submit">Check dashboard access</Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          Until sign-in is ready, this returns you here.
        </p>
      </section>
      <p className="mt-16 text-xs text-muted-foreground">
        QuickTrimr · Web-only administration
      </p>
    </main>
  );
}
