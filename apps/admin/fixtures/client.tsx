// Isolated browser fixture entry, never imported by Next app routes or production.
import { BOOKING_STATUS, toIntegerCents } from '@quicktrimr/shared';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import {
  AdminShell,
  ConfirmDialog,
  DataTable,
  DetailPanel,
  EmptyState,
  ErrorState,
  LoadingState,
  Money,
  PageHeader,
  StatusBadge,
} from '../src/components/admin';
import { Button } from '../src/components/ui/button';

import type { TableQuery } from '../src/components/admin';
import type { BookingStatus, IntegerCents } from '@quicktrimr/shared';
import type { ColumnDef } from '@tanstack/react-table';

type Row = { id: string; status: BookingStatus; gross_cents: IntegerCents };
const columns: ColumnDef<Row>[] = [
  {
    accessorKey: 'id',
    header: 'Booking',
    cell: ({ row }) => (
      <span className="font-mono text-xs">{row.original.id.slice(0, 8)}</span>
    ),
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <StatusBadge kind="booking" status={row.original.status} />
    ),
  },
  {
    accessorKey: 'gross_cents',
    header: 'Amount',
    cell: ({ row }) => <Money amount={row.original.gross_cents} />,
  },
];
function FixtureApp() {
  const [query, setQuery] = useState<TableQuery>({
    pagination: { pageIndex: 0, pageSize: 5 },
    sorting: [],
    columnFilters: [],
  });
  const [result, setResult] = useState<{
    rows: Row[];
    rowCount: number;
    phase: 'ready' | 'loading' | 'error';
  }>({ rows: [], rowCount: 0, phase: 'loading' });
  const [open, setOpen] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({
      page: String(query.pagination.pageIndex),
      size: String(query.pagination.pageSize),
      sort: query.sorting[0]?.id ?? 'id',
      direction: query.sorting[0]?.desc ? 'desc' : 'asc',
      status: String(query.columnFilters[0]?.value ?? ''),
    });
    async function load() {
      setResult({ rows: [], rowCount: 0, phase: 'loading' });
      try {
        const response = await fetch(`/api/bookings?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Fixture load failed');
        const page = (await response.json()) as {
          rows: Row[];
          rowCount: number;
        };
        if (!controller.signal.aborted) setResult({ ...page, phase: 'ready' });
      } catch {
        if (!controller.signal.aborted)
          setResult({ rows: [], rowCount: 0, phase: 'error' });
      }
    }
    load().catch(() => setResult({ rows: [], rowCount: 0, phase: 'error' }));
    return () => controller.abort();
  }, [query]);
  return (
    <AdminShell adminUserId="fixture-admin — not signed in">
      <PageHeader
        title="Component workspace"
        description="Synthetic fixtures only. No customer data, login or financial action."
        actions={
          <Button onClick={() => setOpen(true)}>Open confirmation</Button>
        }
      />
      <DetailPanel title="Seed booking cases">
        <DataTable
          caption="Bookings"
          columns={columns}
          rows={result.rows}
          rowCount={result.rowCount}
          query={query}
          getRowId={(row) => row.id}
          onQueryChange={setQuery}
          phase={result.phase}
          filters={
            <label className="flex items-center gap-3 text-sm">
              Booking status
              <select
                aria-label="Booking status"
                className="rounded-md border bg-white p-2"
                value={String(query.columnFilters[0]?.value ?? '')}
                onChange={(event) =>
                  setQuery({
                    ...query,
                    pagination: { ...query.pagination, pageIndex: 0 },
                    columnFilters: event.target.value
                      ? [{ id: 'status', value: event.target.value }]
                      : [],
                  })
                }
              >
                <option value="">All statuses</option>
                {BOOKING_STATUS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
                <option value="no_matches">No matching fixture</option>
              </select>
            </label>
          }
        />
      </DetailPanel>
      <div className="grid gap-4 md:grid-cols-3">
        <LoadingState label="Loading example" />
        <EmptyState
          title="Empty example"
          description="Choose another filter."
        />
        <ErrorState title="Error example" />
      </div>
      <DetailPanel title="Money examples">
        <div className="flex gap-4">
          <Money amount={toIntegerCents(0)} />
          <Money amount={toIntegerCents(4501)} />
          <Money amount={toIntegerCents(-1)} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Presentation samples, not a balance or bank transfer.
        </p>
      </DetailPanel>
      {confirmed && (
        <p role="status">Fixture confirmed. No financial action performed.</p>
      )}
      <ConfirmDialog
        open={open}
        title="Confirm fixture action"
        consequence="This tests reason and confirmation UI. It does not issue a refund."
        financialImpact={
          <span>
            Illustrative amount: <Money amount={toIntegerCents(4500)} />
          </span>
        }
        onCancel={() => setOpen(false)}
        onConfirm={async ({ reason }) => {
          const response = await fetch('/api/confirm', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reason }),
          });
          if (!response.ok) throw new Error('Synthetic unavailable diagnostic');
          setConfirmed(true);
          setOpen(false);
        }}
      />
    </AdminShell>
  );
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<FixtureApp />);
