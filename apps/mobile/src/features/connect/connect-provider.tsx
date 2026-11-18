import { useQuery } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState, Platform } from 'react-native';

import { queryKeys } from '@/lib/query/query-keys';

import { connectApi } from './connect-api';
import { runConnectOnboarding } from './connect-flow';

import type { SupabaseClient } from '@supabase/supabase-js';

function useConnectController(supabase: SupabaseClient, userId: string) {
  const [api] = useState(() => connectApi(supabase, userId));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(false);
  const running = useRef(false);
  const browserHasRun = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const status = useQuery({
    queryKey: queryKeys.onboarding.connectStatus(userId),
    queryFn: ({ signal }) => api.refresh(signal),
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const refetch = status.refetch;

  // Ready before a cold callback route's passive effect requests a fresh link.
  useLayoutEffect(() => {
    const controller = new AbortController();
    lifetime.current = controller;
    return () => {
      controller.abort();
      if (running.current && Platform.OS === 'ios')
        WebBrowser.dismissAuthSession();
    };
  }, []);

  async function refresh() {
    const result = await refetch({ throwOnError: true });
    if (!result.data) throw new Error('Status unavailable.');
    return result.data;
  }

  async function start() {
    const signal = lifetime.current?.signal;
    if (running.current || !signal || signal.aborted) return;
    running.current = true;
    setBusy(true);
    setError(false);
    setNotice('');
    try {
      const callbackUrl = Linking.createURL('connect');
      const result = await runConnectOnboarding({
        createLink: () => api.createLink(signal),
        refresh,
        callbackUrl,
        signal,
        openBrowser: (url) => {
          browserHasRun.current = true;
          return WebBrowser.openAuthSessionAsync(url, callbackUrl);
        },
      });
      if (!signal.aborted)
        setNotice(
          result === 'renewal_needed'
            ? 'That Stripe link expired. Continue setup to request another link.'
            : 'Stripe status checked. You can continue setup whenever needed.',
        );
    } catch {
      if (!signal.aborted) setError(true);
    } finally {
      running.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  function checkStatus() {
    if (running.current) return;
    setError(false);
    setNotice('');
    refresh().catch(() => undefined);
  }

  // App foregrounding outside a browser session also picks up webhook changes.
  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active' && !running.current)
        refetch().catch(() => undefined);
    });
    return () => listener.remove();
  }, [refetch]);

  return {
    status,
    busy,
    notice,
    error,
    start,
    checkStatus,
    callback(action: string | undefined) {
      // Warm browser sessions consume their own redirect. A cold return still
      // needs a server refresh; an expired link receives a newly issued URL.
      if (running.current || browserHasRun.current) return;
      if (action === 'refresh') start().catch(() => undefined);
      else checkStatus();
    },
  };
}

const ConnectContext = createContext<ReturnType<
  typeof useConnectController
> | null>(null);

export function ConnectProvider({
  supabase,
  userId,
  children,
}: {
  supabase: SupabaseClient;
  userId: string;
  children: ReactNode;
}) {
  const value = useConnectController(supabase, userId);
  return (
    <ConnectContext.Provider value={value}>{children}</ConnectContext.Provider>
  );
}

export function useConnect() {
  const value = useContext(ConnectContext);
  if (!value) throw new Error('Connect requires a signed-in barber.');
  return value;
}
