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
  connect: boolean;
  services: boolean;
  availability: boolean;
};

export function getRouteAccess(session: AppSession): RouteAccess {
  if (session.status === 'signed-out') {
    return {
      auth: true,
      onboarding: false,
      client: false,
      barber: false,
      modals: false,
      connect: false,
      services: false,
      availability: false,
    };
  }

  const ready = session.onboardingComplete;

  return {
    auth: false,
    onboarding: !ready,
    client: ready && session.role === 'client',
    barber: ready && session.role === 'barber',
    modals: ready,
    connect: session.role === 'barber',
    services: session.role === 'barber',
    availability: session.role === 'barber',
  };
}
