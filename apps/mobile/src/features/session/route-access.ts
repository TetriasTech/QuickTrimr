import type { UserRole } from '@quicktrimr/shared';

type JourneyRole = Extract<UserRole, 'client' | 'barber'>;

export type AppSession =
  | { status: 'signed-out' }
  | {
      status: 'signed-in';
      role: JourneyRole;
      onboardingComplete: boolean;
    };

export type RouteAccess = {
  auth: boolean;
  onboarding: boolean;
  client: boolean;
  barber: boolean;
  modals: boolean;
};

export function getRouteAccess(session: AppSession): RouteAccess {
  if (session.status === 'signed-out') {
    return {
      auth: true,
      onboarding: false,
      client: false,
      barber: false,
      modals: false,
    };
  }

  const ready = session.onboardingComplete;

  return {
    auth: false,
    onboarding: !ready,
    client: ready && session.role === 'client',
    barber: ready && session.role === 'barber',
    modals: ready,
  };
}
