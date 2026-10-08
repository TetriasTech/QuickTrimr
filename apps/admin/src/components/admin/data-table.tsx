'use client';

// Client interactivity emits query intent; callers fetch one authorised server
// page. No client sorting/filtering/pagination row models are installed here.
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';

import { Button } from '@/components/ui/button';

import { EmptyState, ErrorState, LoadingState } from './states';

import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
} from '@tanstack/react-table';
import type { ReactNode } from 'react';

export type TableQuery = {
  pagination: PaginationState;
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
};
export type DataTableProps<T> = {
  caption: string;
  columns: ColumnDef<T>[];
  rows: T[];
  rowCount: number;
  query: TableQuery;
  onQueryChange: (next: TableQuery) => void;
  getRowId: (row: T) => string;
  phase?: 'ready' | 'loading' | 'error';
  filters?: ReactNode;
  emptyAction?: ReactNode;
  retryAction?: ReactNode;
};
export function DataTable<T>({
  caption,
  columns,
  rows,
  rowCount,
  query,
  onQueryChange,
  getRowId,
  phase = 'ready',
  filters,
  emptyAction,
  retryAction,
}: DataTableProps<T>) {
  'use no memo'; // TanStack v8 closures are not React-Compiler compatible.
  // eslint-disable-next-line react-hooks/incompatible-library -- Function opts out of Compiler; controlled v8 closures are intentionally not memoized. Revisit on a compatible Table upgrade.
  const table = useReactTable({
    data: rows,
    columns,
    getRowId,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    rowCount,
    state: query,
    onPaginationChange: (update) =>
      onQueryChange({
        ...query,
        pagination:
          typeof update === 'function' ? update(query.pagination) : update,
      }),
    onSortingChange: (update) =>
      onQueryChange({
        ...query,
        pagination: { ...query.pagination, pageIndex: 0 },
        sorting: typeof update === 'function' ? update(query.sorting) : update,
      }),
    onColumnFiltersChange: (update) =>
      onQueryChange({
        ...query,
        pagination: { ...query.pagination, pageIndex: 0 },
        columnFilters:
          typeof update === 'function' ? update(query.columnFilters) : update,
      }),
  });
  const valid =
    Number.isSafeInteger(rowCount) &&
    rowCount >= 0 &&
    Number.isSafeInteger(query.pagination.pageSize) &&
    query.pagination.pageSize > 0 &&
    Number.isSafeInteger(query.pagination.pageIndex) &&
    query.pagination.pageIndex >= 0 &&
    rows.length <= query.pagination.pageSize &&
    rows.length <= rowCount;
  if (!valid) return <ErrorState title="Invalid table page" />;
  return (
    <section aria-label={caption} className="space-y-4">
      {filters}
      {phase === 'loading' ? (
        <LoadingState label={`Loading ${caption.toLowerCase()}…`} />
      ) : phase === 'error' ? (
        <ErrorState action={retryAction} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No records"
          description="Adjust the filters or return to a previous page."
          action={
            emptyAction ?? (
              <Button
                variant="outline"
                onClick={() =>
                  onQueryChange({
                    ...query,
                    pagination: { ...query.pagination, pageIndex: 0 },
                    columnFilters: [],
                  })
                }
              >
                Reset view
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead className="bg-muted/50">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th
                      key={header.id}
                      scope="col"
                      className="px-4 py-3 font-semibold"
                      aria-sort={
                        header.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : 'none'
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <button
                          type="button"
                          className="rounded focus-visible:outline-2 focus-visible:outline-ring"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                          <span aria-hidden="true">
                            {' '}
                            {header.column.getIsSorted() === 'asc'
                              ? '↑'
                              : header.column.getIsSorted() === 'desc'
                                ? '↓'
                                : '↕'}
                          </span>
                        </button>
                      ) : (
                        flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} data-table-row className="border-t">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3">
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <p role="status" aria-live="polite" className="text-muted-foreground">
          {rowCount === 0
            ? 'No pages'
            : `Page ${query.pagination.pageIndex + 1} of ${table.getPageCount()}`}{' '}
          · {rowCount} records
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={phase !== 'ready' || !table.getCanPreviousPage()}
            onClick={() => table.previousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={phase !== 'ready' || !table.getCanNextPage()}
            onClick={() => table.nextPage()}
          >
            Next
          </Button>
        </div>
      </footer>
    </section>
  );
}
