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
  bookings: {
    all: rootKeys.bookings,
    lists: () => [...rootKeys.bookings, 'list'] as const,
    detail: (bookingId: string) => [...rootKeys.bookings, 'detail', bookingId] as const,
    eta: (bookingId: string) => [...rootKeys.bookings, 'detail', bookingId, 'eta'] as const,
  },
  bookingRequests: {
    all: rootKeys.bookingRequests,
    detail: (requestId: string) =>
      [...rootKeys.bookingRequests, 'detail', requestId] as const,
  },
  discovery: {
    all: rootKeys.discovery,
    results: (filters: DiscoveryKeyFilters) =>
      [...rootKeys.discovery, 'results', stableFilters(filters)] as const,
  },
  platformConfig: {
    all: rootKeys.platformConfig,
    scheduling: () => [...rootKeys.platformConfig, 'scheduling'] as const,
  },
} as const;
