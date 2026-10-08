import {
  formatAudCents,
  getStatusPresentation,
  type StatusKind,
} from '@quicktrimr/ui/presentation';

import type { IntegerCents } from '@quicktrimr/shared';

export function Money({ amount }: { amount: IntegerCents }) {
  return (
    <span className="font-mono tabular-nums whitespace-nowrap">
      {formatAudCents(amount)}
    </span>
  );
}
export function StatusBadge({
  kind,
  status,
}: {
  kind: StatusKind;
  status: string;
}) {
  const { label, tone } = getStatusPresentation(kind, status);
  return (
    <span
      className="status-badge inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold"
      data-tone={tone}
    >
      {label}
    </span>
  );
}
