import { BOOKING_STATUS } from '../../packages/shared/src/index.ts';
import { buildSeed } from '../db/seed-data.mjs';

// Test-only projection. No database, credentials, Auth fixture fields or targets.
const bookings = buildSeed().rows.bookings.map(
  ({ id, status, gross_cents }) => ({ id, status, gross_cents }),
);
export function fixturePage(params) {
  const pageIndex = Number(params.get('page') ?? '0');
  const size = Number(params.get('size') ?? '5');
  const sort = params.get('sort') ?? 'id';
  const direction = params.get('direction') ?? 'asc';
  const status = params.get('status') ?? '';
  // Bounds are fixture transport limits, not product pagination configuration.
  if (
    !Number.isSafeInteger(pageIndex) ||
    pageIndex < 0 ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 5 ||
    !['id', 'status', 'gross_cents'].includes(sort) ||
    !['asc', 'desc'].includes(direction) ||
    (status && !BOOKING_STATUS.includes(status) && status !== 'no_matches')
  )
    return null;
  const filtered = bookings.filter((row) => !status || row.status === status);
  filtered.sort((a, b) => {
    const compare =
      typeof a[sort] === 'number'
        ? a[sort] - b[sort]
        : String(a[sort]).localeCompare(String(b[sort]));
    return (
      (direction === 'desc' ? -compare : compare) || a.id.localeCompare(b.id)
    );
  });
  return {
    rows: filtered.slice(pageIndex * size, (pageIndex + 1) * size),
    rowCount: filtered.length,
  };
}
