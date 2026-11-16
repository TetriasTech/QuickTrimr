'use client';

// Pending and error feedback need form interactivity. Authentication stays on the server.
import { useActionState } from 'react';

import { Button } from '@/components/ui/button';
import { signInAdmin, signOutAdmin } from '@/lib/auth/actions';

const fieldClass =
  'w-full rounded-md border bg-background px-3 py-2 outline-offset-4 focus-visible:outline-ring';

export function AdminLoginForm() {
  const [state, action, pending] = useActionState(signInAdmin, null);
  return (
    <form action={action} className="mt-8 space-y-5">
      <div className="space-y-2">
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className={fieldClass}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={fieldClass}
        />
      </div>
      {state && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}

export function AdminSignOutForm() {
  const [state, action, pending] = useActionState(signOutAdmin, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      {state && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Signing out…' : 'Sign out'}
      </Button>
    </form>
  );
}
