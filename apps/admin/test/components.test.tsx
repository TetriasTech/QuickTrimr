// @vitest-environment jsdom
import { SHARED_ENUMS, toIntegerCents } from '@quicktrimr/shared';
import {
  formatAudCents,
  getStatusPresentation,
  STATUS_PRESENTATION,
} from '@quicktrimr/ui/presentation';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

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
} from '@/components/admin';

import type { TableQuery } from '@/components/admin';
import type { IntegerCents } from '@quicktrimr/shared';
import type { ColumnDef } from '@tanstack/react-table';

afterEach(cleanup);
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
const families = {
  booking: 'ENUM-BOOKING-STATUS',
  payment: 'ENUM-PAYMENT-STATUS',
  earning: 'ENUM-EARNING-STATUS',
  payout: 'ENUM-PAYOUT-STATUS',
  dispute: 'ENUM-DISPUTE-STATUS',
} as const;
for (const [kind, id] of Object.entries(families) as [
  keyof typeof families,
  (typeof families)[keyof typeof families],
][]) {
  it(`StatusBadge ${kind} covers every shared value and safe unknowns`, () => {
    expect(Object.keys(STATUS_PRESENTATION[kind]).sort()).toEqual(
      [...SHARED_ENUMS[id]].sort(),
    );
    for (const value of [
      ...SHARED_ENUMS[id],
      'future_status',
      '__proto__',
      'constructor',
      'toString',
    ]) {
      const { unmount } = render(<StatusBadge kind={kind} status={value} />);
      expect(
        screen.getByText(getStatusPresentation(kind, value).label),
      ).toBeTruthy();
      if (!Object.hasOwn(STATUS_PRESENTATION[kind], value))
        expect(screen.getByText('Unknown status')).toBeTruthy();
      unmount();
    }
  });
}
it('formats exact signed integer AUD cents including both safe-integer limits; fractions fail', () => {
  for (const [value, text] of [
    [0, 'A$0.00'],
    [100, 'A$1.00'],
    [4501, 'A$45.01'],
    [-1, '-A$0.01'],
    [Number.MAX_SAFE_INTEGER, 'A$90,071,992,547,409.91'],
    [Number.MIN_SAFE_INTEGER, '-A$90,071,992,547,409.91'],
  ] as const) {
    expect(formatAudCents(toIntegerCents(value))).toBe(text);
    const { unmount } = render(<Money amount={toIntegerCents(value)} />);
    expect(screen.getByText(text)).toBeTruthy();
    unmount();
  }
  for (const value of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
    expect(() => formatAudCents(value as IntegerCents)).toThrow();
});
it('renders shell, page header, details, loading, error and actionable empty states', () => {
  render(
    <AdminShell adminUserId="verified-fixture-id">
      <PageHeader
        title="Bookings"
        description="Synthetic cases"
        actions={<button>Action</button>}
      />
      <DetailPanel title="Details">Data</DetailPanel>
      <LoadingState />
      <ErrorState action={<button>Retry</button>} />
      <EmptyState
        title="No bookings"
        description="Choose another filter"
        action={<button>Clear filter</button>}
      />
    </AdminShell>,
  );
  expect(screen.getByRole('navigation').querySelectorAll('a')).toHaveLength(8);
  expect(screen.getByText(/verified-fixture-id/)).toBeTruthy();
  expect(screen.getByRole('main')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Bookings' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Details' })).toBeTruthy();
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Clear filter' })).toBeTruthy();
});
type Row = { id: string; status: string };
const columns: ColumnDef<Row>[] = [{ accessorKey: 'status', header: 'Status' }];
const query: TableQuery = {
  pagination: { pageIndex: 1, pageSize: 2 },
  sorting: [{ id: 'status', desc: false }],
  columnFilters: [{ id: 'status', value: 'not-in-page' }],
};
const rows = [
  { id: 'z', status: 'Zulu' },
  { id: 'a', status: 'Alpha' },
];
it('renders ONLY the supplied page without client filtering/sorting; next/sort emit controlled state', () => {
  const change = vi.fn();
  render(
    <DataTable
      caption="Bookings"
      rows={rows}
      columns={columns}
      rowCount={5}
      query={query}
      onQueryChange={change}
      getRowId={(r) => r.id}
    />,
  );
  expect(
    screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent),
  ).toEqual(['Zulu', 'Alpha']);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(change.mock.lastCall?.[0].pagination.pageIndex).toBe(2);
  expect(screen.getAllByRole('row')).toHaveLength(3); // No speculative local page movement.
  fireEvent.click(screen.getByRole('button', { name: /Status/ }));
  expect(change.mock.lastCall?.[0].pagination.pageIndex).toBe(0);
  expect(change.mock.lastCall?.[0].sorting).toEqual([
    { id: 'status', desc: true },
  ]);
});
it('table column filtering emits intent and resets page without filtering current rows', () => {
  const change = vi.fn();
  const filterColumns: ColumnDef<Row>[] = [
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <button onClick={() => column.setFilterValue('Alpha')}>
          Filter status
        </button>
      ),
      enableSorting: false,
    },
  ];
  render(
    <DataTable
      caption="Bookings"
      rows={rows}
      columns={filterColumns}
      rowCount={5}
      query={query}
      onQueryChange={change}
      getRowId={(r) => r.id}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Filter status' }));
  expect(change.mock.lastCall?.[0].pagination.pageIndex).toBe(0);
  expect(change.mock.lastCall?.[0].columnFilters).toEqual([
    { id: 'status', value: 'Alpha' },
  ]);
  expect(screen.getByText('Zulu')).toBeTruthy();
});
it('table terminal/empty/loading/error/invalid pages hide stale data and disable inappropriate controls', () => {
  const props = {
    caption: 'Bookings',
    columns,
    rows: rows.slice(0, 1),
    rowCount: 5,
    query: { ...query, pagination: { pageIndex: 2, pageSize: 2 } },
    onQueryChange: vi.fn(),
    getRowId: (r: Row) => r.id,
  };
  const { rerender } = render(<DataTable {...props} />);
  expect(
    (screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(<DataTable {...props} phase="loading" />);
  expect(screen.queryByText('Zulu')).toBeNull();
  expect(
    (screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  rerender(
    <DataTable {...props} phase="error" retryAction={<button>Retry</button>} />,
  );
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Zulu')).toBeNull();
  rerender(<DataTable {...props} rows={[]} rowCount={0} />);
  expect(screen.getByText('No records')).toBeTruthy();
  rerender(
    <DataTable
      {...props}
      query={{ ...query, pagination: { pageIndex: 0, pageSize: 0 } }}
    />,
  );
  expect(screen.getByText('Invalid table page')).toBeTruthy();
  expect(screen.queryByText('Zulu')).toBeNull();
});
it('dialog blocks crafted whitespace submit and duplicate pending submits, emits reason only and hides rejection diagnostics', async () => {
  const pending = Promise.withResolvers<void>();
  const confirm = vi.fn(() => pending.promise);
  const cancel = vi.fn();
  render(
    <ConfirmDialog
      open
      title="Confirm"
      consequence="No real action"
      financialImpact={<Money amount={toIntegerCents(4500)} />}
      onConfirm={confirm}
      onCancel={cancel}
    />,
  );
  const modal = screen.getByRole('dialog');
  const form = modal.querySelector('form')!;
  const reason = screen.getByRole('textbox');
  fireEvent.change(reason, { target: { value: '   ' } });
  fireEvent.submit(form);
  expect(confirm).not.toHaveBeenCalled();
  fireEvent.change(reason, { target: { value: '  fixture reason  ' } });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(confirm).toHaveBeenCalledExactlyOnceWith({ reason: 'fixture reason' });
  expect(
    (within(modal).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  fireEvent(modal, new Event('cancel', { cancelable: true }));
  expect(cancel).not.toHaveBeenCalled();
  await act(async () =>
    pending.reject(new Error('sensitive provider diagnostic')),
  );
  expect(screen.getByRole('alert').textContent).toBe(
    'Could not confirm. Please try again.',
  );
  expect(screen.queryByText(/sensitive provider/)).toBeNull();
  confirm.mockResolvedValue();
  fireEvent.submit(form);
  await act(async () => {});
  expect(confirm).toHaveBeenCalledTimes(2);
});
it('dialog optional reason, cancellation and reopen reset are controlled by the caller', async () => {
  const confirm = vi.fn(async () => {}),
    cancel = vi.fn();
  const props = {
    title: 'Confirm',
    consequence: 'Fixture',
    financialImpact: 'No action',
    onConfirm: confirm,
    onCancel: cancel,
    requireReason: false,
  };
  const { rerender } = render(<ConfirmDialog {...props} open />);
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
  await act(async () => {});
  expect(confirm).toHaveBeenCalledExactlyOnceWith({ reason: '' });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancel).toHaveBeenCalledOnce();
  fireEvent.change(screen.getByRole('textbox'), {
    target: { value: 'previous' },
  });
  rerender(<ConfirmDialog {...props} open={false} />);
  rerender(<ConfirmDialog {...props} open />);
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('');
});
