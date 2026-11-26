import type { CreateBookingRequestRequest } from '@quicktrimr/validation';

export type DiscoveryKeyFilters = Readonly<
  Record<string, boolean | number | string | null | readonly string[]>
>;

const rootKeys = {
  bookings: ['bookings'],
  bookingRequests: ['booking-requests'],
  discovery: ['discovery'],
  platformConfig: ['platform-config'],
} as const;

function stableFilters(filters: DiscoveryKeyFilters): DiscoveryKeyFilters {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(filters)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [
          key,
          Array.isArray(value) ? Object.freeze([...value]) : value,
        ]),
    ),
  );
}

/**
 * Every server-state query key starts here. Feature code imports a named factory
 * instead of assembling arrays that can drift away from mutation invalidation.
 */
export const queryKeys = {
  availability: {
    state: (userId: string) => ['availability', userId, 'state'] as const,
  },
  publicProfiles: {
    detail: (userId: string, barberId: string, serviceCategoryId?: string) =>
      [
        'public-profiles',
        userId,
        barberId.toLowerCase(),
        ...(serviceCategoryId ? [serviceCategoryId.toLowerCase()] : []),
      ] as const,
  },
  session: {
    profile: (userId: string | null) => ['session', 'profile', userId] as const,
  },
  onboarding: {
    barberServices: (userId: string) =>
      ['onboarding', 'barber-services', userId] as const,
    connectStatus: (userId: string) =>
      ['onboarding', 'connect-status', userId] as const,
    clientProfile: (userId: string) =>
      ['onboarding', 'client-profile', userId] as const,
    barberProfile: (userId: string) =>
      ['onboarding', 'barber-profile', userId] as const,
    barberAreaLookup: (userId: string, query: string) =>
      ['onboarding', 'barber-area-lookup', userId, query] as const,
  },
  addresses: {
    list: (userId: string) => ['addresses', userId, 'list'] as const,
    search: (userId: string, query: string) =>
      ['addresses', userId, 'search', query] as const,
  },
  bookings: {
    all: rootKeys.bookings,
    barberStatus: (userId: string, bookingId: string) =>
      [...rootKeys.bookings, userId, 'barber-status', bookingId] as const,
    lists: () => [...rootKeys.bookings, 'list'] as const,
    detail: (bookingId: string) =>
      [...rootKeys.bookings, 'detail', bookingId] as const,
    eta: (bookingId: string) =>
      [...rootKeys.bookings, 'detail', bookingId, 'eta'] as const,
  },
  bookingRequests: {
    all: rootKeys.bookingRequests,
    barberInbox: (userId: string) =>
      [...rootKeys.bookingRequests, userId, 'inbox'] as const,
    detail: (requestId: string) =>
      [...rootKeys.bookingRequests, 'detail', requestId] as const,
    review: (userId: string, input: CreateBookingRequestRequest) =>
      [
        ...rootKeys.bookingRequests,
        userId,
        'review',
        input.bookingType,
        input.barberId,
        input.serviceCategoryId,
        input.clientAddressId,
        input.scheduledFor ?? null,
      ] as const,
    status: (
      userId: string,
      requestId: string | null,
      activeAvailableNow: boolean,
    ) =>
      [
        ...rootKeys.bookingRequests,
        userId,
        'status',
        requestId,
        activeAvailableNow,
      ] as const,
  },
  discovery: {
    all: rootKeys.discovery,
    inputs: (userId: string, addressId: string | null) =>
      ['discovery-inputs', userId, addressId] as const,
    categories: (userId: string) => ['discovery-categories', userId] as const,
    results: (filters: DiscoveryKeyFilters) =>
      [...rootKeys.discovery, 'results', stableFilters(filters)] as const,
  },
  platformConfig: {
    all: rootKeys.platformConfig,
    scheduling: () => [...rootKeys.platformConfig, 'scheduling'] as const,
  },
} as const;
