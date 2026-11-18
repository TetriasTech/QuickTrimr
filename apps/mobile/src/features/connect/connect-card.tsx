import {
  Badge,
  Button,
  Card,
  ErrorState,
  LoadingState,
  colors,
  spacing,
  typography,
} from '@quicktrimr/ui';
import { Text, View } from 'react-native';

import {
  connectIncompleteWarning,
  connectNeedsWarning,
  connectStatusCopy,
} from './connect-presentation';
import { useConnect } from './connect-provider';

export function ConnectCard() {
  const flow = useConnect();
  const { status } = flow;
  const accountStatus = status.data?.accountStatus;
  const copy = accountStatus ? connectStatusCopy[accountStatus] : null;
  const busy = flow.busy || status.isFetching;
  return (
    <Card variant="outlined" style={{ gap: spacing.md }}>
      <Text accessibilityRole="header" style={typography.headline}>
        Payments with Stripe
      </Text>
      {copy ? (
        <View style={{ gap: spacing.sm }} accessibilityLiveRegion="polite">
          <Badge
            label={status.isError ? `Last checked: ${copy.label}` : copy.label}
            tone={status.isError ? 'neutral' : copy.tone}
          />
          {!status.isError && (
            <Text style={typography.body}>{copy.message}</Text>
          )}
        </View>
      ) : null}
      {connectNeedsWarning(accountStatus, status.isError) ? (
        <Text accessibilityRole="alert" style={{ color: colors.warning }}>
          {status.isError && accountStatus === 'verified'
            ? 'Stripe readiness could not be confirmed. QuickTrimr must confirm verification before you receive paid bookings.'
            : connectIncompleteWarning}
        </Text>
      ) : null}
      {status.isFetching ? (
        <LoadingState message="Checking Stripe status…" />
      ) : null}
      {status.isError ? (
        <ErrorState
          message="Could not check Stripe status. Your saved progress is unchanged."
          onRetry={flow.checkStatus}
        />
      ) : null}
      {flow.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger }}>
          Could not open or finish Stripe setup. Try again when you are ready.
        </Text>
      ) : null}
      {flow.notice ? (
        <Text accessibilityLiveRegion="polite" style={typography.body}>
          {flow.notice}
        </Text>
      ) : null}
      {copy?.action && !status.isError ? (
        <Button
          label={copy.action}
          loading={flow.busy}
          disabled={busy}
          onPress={() => {
            flow.start().catch(() => undefined);
          }}
        />
      ) : null}
      {!status.isError ? (
        <Button
          label="Check Stripe status"
          variant="secondary"
          disabled={busy}
          onPress={flow.checkStatus}
        />
      ) : null}
    </Card>
  );
}
