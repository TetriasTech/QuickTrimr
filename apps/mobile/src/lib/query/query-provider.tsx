import { QueryClientProvider, focusManager } from '@tanstack/react-query';
import { type PropsWithChildren, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { createQueryClient } from './query-client';

export function MobileQueryProvider({ children }: PropsWithChildren) {
  const [queryClient] = useState(createQueryClient);

  useEffect(() => {
    focusManager.setFocused(AppState.currentState === 'active');

    const subscription = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
    });

    return () => {
      subscription.remove();
      focusManager.setFocused(undefined);
    };
  }, []);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
