import { Button, Card, Screen, spacing, useTheme } from '@quicktrimr/ui';
import { formatAudCents } from '@quicktrimr/ui/presentation';
import { paymentStatusSchema } from '@quicktrimr/validation';
import { useStripe } from '@stripe/stripe-react-native';
import { useEffect, useRef, useState } from 'react';
import { Linking, Text } from 'react-native';

import { EdgeFunctionError } from '@/lib/api/invoke-edge-function';

import { isStripeReturnUrl, stripeReturnUrl } from './stripe-return-url';

import type {
  CreatePaymentAuthorisationRequest,
  CreatePaymentAuthorisationResponse,
} from '@quicktrimr/validation';

const feedback: Readonly<Record<string, string>> = {
  card_declined: 'Your card was declined. You can try another card.',
  insufficient_funds:
    'Your card has insufficient funds. You can try another card.',
  authentication_required:
    'Your bank needs you to verify this card. Choose Continue to finish.',
  payment_method_required: 'Enter a card to authorise this request.',
  request_not_pending: 'The response window for this request has ended.',
  authorisation_window_unavailable:
    'The card hold could not cover this request and was released.',
  stripe_unavailable:
    'Stripe is temporarily unavailable. Check the authorisation status before retrying.',
};
type Authorised = Extract<
  CreatePaymentAuthorisationResponse,
  { status: 'authorised' }
>;

export function PaymentAuthorisationScreen({
  requestId,
  authorise,
}: {
  requestId: string;
  authorise: (
    input: CreatePaymentAuthorisationRequest,
  ) => Promise<CreatePaymentAuthorisationResponse>;
}) {
  const { typography } = useTheme();
  const {
    initPaymentSheet,
    presentPaymentSheet,
    handleNextAction,
    handleURLCallback,
  } = useStripe();
  const active = useRef(false);
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [hold, setHold] = useState<Authorised | null>(null);
  useEffect(() => {
    active.current = true;
    const subscription = Linking.addEventListener('url', ({ url }) => {
      if (isStripeReturnUrl(url)) handleURLCallback(url).catch(() => undefined);
    });
    return () => {
      active.current = false;
      subscription.remove();
    };
  }, [handleURLCallback]);

  async function run(operation: 'prepare' | 'verify') {
    if (inFlight.current || !active.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      let result = await authorise({ bookingRequestId: requestId, operation });
      if (result.status === paymentStatusSchema.enum.requires_authorisation) {
        if (!active.current) return;
        if (result.authenticationRequired) {
          await handleNextAction(result.clientSecret, stripeReturnUrl);
        } else {
          const setup = await initPaymentSheet({
            merchantDisplayName: 'QuickTrimr',
            paymentIntentClientSecret: result.clientSecret,
            returnURL: stripeReturnUrl,
            allowsDelayedPaymentMethods: false,
            primaryButtonLabel: 'Authorise card',
          });
          if (setup.error) throw new Error('Could not open card entry.');
          if (!active.current) return;
          await presentPaymentSheet();
        }
        result = await authorise({
          bookingRequestId: requestId,
          operation: 'verify',
        });
      }
      if (
        active.current &&
        result.status === paymentStatusSchema.enum.authorised
      )
        setHold(result);
    } catch (error) {
      const code =
        error instanceof EdgeFunctionError ? error.response.error : '';
      if (active.current)
        setMessage(
          (Object.hasOwn(feedback, code) ? feedback[code] : undefined) ??
            'Could not check the card hold. Try checking its status again.',
        );
    } finally {
      inFlight.current = false;
      if (active.current) setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Card style={{ gap: spacing.md }}>
        <Text accessibilityRole="header" style={typography.title}>
          {hold ? 'Card authorised' : 'Authorise your card'}
        </Text>
        {hold ? (
          <>
            <Text style={typography.body}>
              {formatAudCents(hold.amountCents)}
            </Text>
            <Text style={typography.body}>
              This is a temporary hold. Payment is captured after acceptance.
            </Text>
          </>
        ) : (
          <>
            <Text style={typography.body}>
              Stripe securely collects your card details for this request.
            </Text>
            {message ? (
              <Text accessibilityLiveRegion="polite" style={typography.body}>
                {message}
              </Text>
            ) : null}
            <Button
              label="Continue"
              loading={busy}
              disabled={busy}
              onPress={() => run('prepare').catch(() => undefined)}
            />
            <Button
              label="Check authorisation status"
              variant="secondary"
              disabled={busy}
              onPress={() => run('verify').catch(() => undefined)}
            />
          </>
        )}
      </Card>
    </Screen>
  );
}
