import { useTheme } from '@quicktrimr/ui';
import { paymentStatusSchema } from '@quicktrimr/validation';
import { Text } from 'react-native';

import type { PaymentCaptureNotice as Notice } from '@quicktrimr/validation';

export function PaymentCaptureNotice({
  outcome,
  audience,
}: {
  outcome: Notice;
  audience: 'client' | 'barber';
}) {
  const { typography } = useTheme();
  const message =
    outcome === paymentStatusSchema.enum.captured
      ? 'Payment was received for this booking.'
      : audience === 'barber'
        ? 'Payment could not be collected. Wait for booking confirmation before travelling.'
        : 'Payment could not be collected. Your booking is awaiting payment confirmation.';
  return (
    <Text accessibilityLiveRegion="polite" style={typography.body}>
      {message}
    </Text>
  );
}
