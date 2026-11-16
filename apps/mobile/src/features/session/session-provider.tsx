import { skipToken, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  type PropsWithChildren,
  use,
  useEffect,
  useState,
} from 'react';
import { AppState } from 'react-native';

import { queryKeys } from '@/lib/query/query-keys';
import { useBookingDraftStore } from '@/stores/booking-draft-store';

import { loadProfile } from './load-profile';

import type { AppSession } from './route-access';
import type { Session, SupabaseClient } from '@supabase/supabase-js';

type SessionState =
  AppSession | { status: 'loading' } | { status: 'profile-error' };

type SessionContextValue = {
  supabase: SupabaseClient;
  state: SessionState;
  retry: () => void;
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({
  supabase,
  children,
}: PropsWithChildren<{ supabase: SupabaseClient }>) {
  const [session, setSession] = useState<Session | null | undefined>();
  const queryClient = useQueryClient();

  useEffect(() => {
    let previousUserId: string | undefined;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, value) => {
      if (previousUserId && previousUserId !== value?.user.id) {
        queryClient.clear();
        useBookingDraftStore.getState().resetDraft();
      }
      previousUserId = value?.user.id;
      setSession(value);
    });
    const appState = AppState.addEventListener('change', (state) => {
      const refresh =
        state === 'active'
          ? supabase.auth.startAutoRefresh()
          : supabase.auth.stopAutoRefresh();
      // The client reports refresh failures via the session and profile checks.
      refresh.catch(() => undefined);
    });

    return () => {
      subscription.unsubscribe();
      appState.remove();
      supabase.auth.stopAutoRefresh().catch(() => undefined);
    };
  }, [queryClient, supabase]);

  const profile = useQuery({
    queryKey: queryKeys.session.profile(session?.user.id ?? null),
    queryFn: session
      ? ({ signal }) => loadProfile(supabase, session.user.id, signal)
      : skipToken,
    retry: false,
  });

  let state: SessionState;
  if (session === undefined) state = { status: 'loading' };
  else if (!session) state = { status: 'signed-out' };
  else if (profile.isError) state = { status: 'profile-error' };
  else if (!profile.data) state = { status: 'loading' };
  else state = { status: 'signed-in', ...profile.data };

  return (
    <SessionContext
      value={{
        supabase,
        state,
        retry: () => {
          profile.refetch().catch(() => undefined);
        },
      }}
    >
      {children}
    </SessionContext>
  );
}

export function useMobileSession() {
  const value = use(SessionContext);
  if (!value) throw new Error('SessionProvider is required.');
  return value;
}
