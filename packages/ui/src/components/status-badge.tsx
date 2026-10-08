import { getBookingStatusPresentation } from '../presentation/status';

import { Badge } from './badge';

export {
  BOOKING_STATUS_PRESENTATION,
  UNKNOWN_BOOKING_STATUS_PRESENTATION,
  getBookingStatusPresentation,
} from '../presentation/status';
export type { BookingStatusPresentation } from '../presentation/status';

export interface StatusBadgeProps {
  status: string;
  testID?: string;
}

export function StatusBadge({ status, testID }: StatusBadgeProps) {
  const presentation = getBookingStatusPresentation(status);
  return (
    <Badge
      label={presentation.label}
      tone={presentation.tone}
      {...(testID === undefined ? {} : { testID })}
    />
  );
}
