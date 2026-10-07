import { SHARED_ENUMS } from '../../packages/shared/src/index.ts';

export const coreTables = [
  'profiles',
  'client_profiles',
  'barber_profiles',
  'client_addresses',
  'service_categories',
  'barber_services',
  'available_now_sessions',
  'booking_requests',
  'bookings',
  'booking_services',
  'booking_status_history',
  'payments',
  'barber_earnings',
  'payout_batches',
  'payout_batch_items',
  'disputes',
  'reviews',
  'notifications',
  'audit_logs',
  'barber_reliability_events',
  'barber_reliability_state',
];

export const appendOnlyTables = [
  'booking_status_history',
  'audit_logs',
  'barber_reliability_events',
];

// SQL names are the stable IDs without their namespace, not a second status list.
export const postgresEnumNames = Object.fromEntries(
  Object.keys(SHARED_ENUMS).map((id) => [
    id,
    id.slice('ENUM-'.length).toLowerCase().replaceAll('-', '_'),
  ]),
);

// Read only committed enum declarations, not arbitrary SQL. PostgreSQL catalogs
// are the separate live authority; this check catches drift in credential-free CI.
export function migrationEnumValues(sql) {
  return Object.fromEntries(
    [
      ...sql.matchAll(/create type public\.([a-z_]+) as enum\s*\(([^;]+)\);/gi),
    ].map(([, name, labels]) => [
      name,
      [...labels.matchAll(/'((?:''|[^'])*)'/g)].map(([, value]) =>
        value.replaceAll("''", "'"),
      ),
    ]),
  );
}
