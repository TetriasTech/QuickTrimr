'use server';

import { authEmailSchema, authPasswordSchema } from '@quicktrimr/validation';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import {
  adminCookieOptions,
  adminSessionOperation,
  createAdminProvider,
  isAdminCookie,
} from './provider';

type State = { error: string } | null;

const signInFailure = {
  error: 'Sign-in failed. Check your credentials and try again.',
};
const signOutFailure = { error: 'Could not sign out. Try again.' };

async function openActionProvider() {
  const store = await cookies();
  const provider = createAdminProvider({
    getAll: () => store.getAll(),
    setAll(values) {
      for (const { name, value, options } of values)
        store.set(name, value, options);
    },
  });

  return {
    provider,
    clear() {
      for (const { name } of store
        .getAll()
        .filter(({ name }) => isAdminCookie(name))) {
        store.set(name, '', { ...adminCookieOptions, maxAge: 0 });
      }
    },
  };
}

export async function signInAdmin(
  _previous: State,
  formData: FormData,
): Promise<State> {
  const email = authEmailSchema.safeParse(formData.get('email'));
  const password = authPasswordSchema.safeParse(formData.get('password'));
  if (!email.success || !password.success) return signInFailure;

  let action: Awaited<ReturnType<typeof openActionProvider>> | undefined;
  let authenticated = false;
  let granted = false;
  try {
    action = await openActionProvider();
    const result = await action.provider.auth.signInWithPassword({
      email: email.data,
      password: password.data,
    });
    if (result.error || !result.data.session) return signInFailure;
    authenticated = true;
    granted =
      (await adminSessionOperation(action.provider, 'open')).status ===
      'active';
  } catch {
    // The same safe form response covers provider outages and denied accounts.
    granted = false;
  }
  if (!granted) {
    if (action && authenticated) {
      try {
        await action.provider.auth.signOut({ scope: 'local' });
      } catch {
        // No dashboard grant exists. Clear any cookies even if Auth is offline.
      } finally {
        action.clear();
      }
    }
    return signInFailure;
  }
  redirect('/');
}

export async function signOutAdmin(): Promise<State> {
  try {
    const action = await openActionProvider();
    await adminSessionOperation(action.provider, 'close');
    // The recorded close denies reuse of the dashboard session even if the
    // provider fails to revoke its refresh token after this database commit.
    try {
      await action.provider.auth.signOut({ scope: 'local' });
    } finally {
      action.clear();
    }
  } catch {
    return signOutFailure;
  }
  redirect('/login');
}
