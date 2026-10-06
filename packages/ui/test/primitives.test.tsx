import { BOOKING_STATUS } from '@quicktrimr/shared';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  BOOKING_STATUS_PRESENTATION,
  Avatar,
  Badge,
  BottomSheet,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  StatusBadge,
  TextInput,
  UNKNOWN_BOOKING_STATUS_PRESENTATION,
} from '../src';

import type { PropsWithChildren } from 'react';

function SafeAreaTestProvider({ children }: PropsWithChildren) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { height: 844, width: 390, x: 0, y: 0 },
        insets: { bottom: 34, left: 0, right: 0, top: 47 },
      }}
    >
      {children}
    </SafeAreaProvider>
  );
}

test('Button renders and a loading button cannot be pressed', async () => {
  const onPress = jest.fn();
  await render(<Button label="Save" loading onPress={onPress} />);

  const button = screen.getByRole('button', { name: 'Save' });
  expect(button).toBeDisabled();
  expect(button).toBeBusy();
  expect(screen.getByTestId('button-loading-indicator')).toBeOnTheScreen();
  await fireEvent.press(button);
  expect(onPress).not.toHaveBeenCalled();
});

test('TextInput renders its label, value and accessible error', async () => {
  const onChangeText = jest.fn();
  await render(
    <TextInput
      error="Enter a valid display name"
      label="Display name"
      onChangeText={onChangeText}
      value="Andrew"
    />,
  );

  await fireEvent.changeText(screen.getByLabelText('Display name'), 'Tony');
  expect(onChangeText).toHaveBeenCalledWith('Tony');
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Enter a valid display name',
  );
});

test('Screen renders content inside its safe-area and keyboard wrapper', async () => {
  await render(
    <SafeAreaTestProvider>
      <Screen scroll testID="screen">
        <Text>Safe content</Text>
      </Screen>
    </SafeAreaTestProvider>,
  );

  expect(screen.getByTestId('screen')).toBeOnTheScreen();
  expect(screen.getByText('Safe content')).toBeOnTheScreen();
});

test('Card composes arbitrary children', async () => {
  await render(
    <Card testID="card" variant="outlined">
      <Text>Card content</Text>
    </Card>,
  );

  expect(screen.getByTestId('card')).toBeOnTheScreen();
  expect(screen.getByText('Card content')).toBeOnTheScreen();
});

test('Badge renders its label and tone', async () => {
  await render(<Badge label="Verified" tone="success" />);
  expect(screen.getByText('Verified')).toBeOnTheScreen();
});

test('StatusBadge covers every shared booking status and has an unknown fallback', async () => {
  expect(Object.keys(BOOKING_STATUS_PRESENTATION).sort()).toEqual(
    [...BOOKING_STATUS].sort(),
  );

  for (const status of BOOKING_STATUS) {
    const { unmount } = await render(<StatusBadge status={status} />);
    expect(
      screen.getByText(BOOKING_STATUS_PRESENTATION[status].label),
    ).toBeOnTheScreen();
    await unmount();
  }

  await render(<StatusBadge status="future_status" />);
  expect(
    screen.getByText(UNKNOWN_BOOKING_STATUS_PRESENTATION.label),
  ).toBeOnTheScreen();
});

test('Avatar renders initials when no image source exists', async () => {
  await render(
    <Avatar accessibilityLabel="Andrew profile photo" initials="AG" />,
  );
  expect(
    screen.getByRole('image', { name: 'Andrew profile photo' }),
  ).toBeOnTheScreen();
  expect(screen.getByText('AG')).toBeOnTheScreen();
});

test('LoadingState exposes an accessible progress state', async () => {
  await render(<LoadingState message="Loading bookings" />);
  expect(
    screen.getByRole('progressbar', { name: 'Loading bookings' }),
  ).toBeOnTheScreen();
});

test('EmptyState wires its optional action', async () => {
  const onPress = jest.fn();
  await render(
    <EmptyState
      action={{ label: 'Find a barber', onPress }}
      message="No barbers match these filters."
    />,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Find a barber' }));
  expect(onPress).toHaveBeenCalledTimes(1);
});

test('ErrorState wires its retry callback', async () => {
  const onRetry = jest.fn();
  await render(
    <ErrorState message="Bookings could not be loaded." onRetry={onRetry} />,
  );

  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('BottomSheet renders presented content and wires dismissal', async () => {
  const onDismiss = jest.fn();
  await render(
    <BottomSheet isPresented onDismiss={onDismiss} testID="bottom-sheet">
      <View>
        <Text>Sheet content</Text>
      </View>
    </BottomSheet>,
  );

  const sheet = screen.getByTestId('bottom-sheet');
  expect(screen.getByText('Sheet content')).toBeOnTheScreen();
  await fireEvent(sheet, 'dismiss');
  expect(onDismiss).toHaveBeenCalledTimes(1);
});

test('ConfirmDialog includes the consequence and a destructive confirmation', async () => {
  const onCancel = jest.fn();
  const onConfirm = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);

  await render(
    <ConfirmDialog
      confirmLabel="Cancel booking"
      consequence="You will receive a partial refund."
      destructive
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="Cancel this booking?"
      visible
    />,
  );

  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  const call = alert.mock.calls[0];
  if (!call) throw new Error('Expected the confirmation alert to be shown');
  const [, message, buttons] = call;
  expect(message).toBe('You will receive a partial refund.');
  expect(buttons?.[1]).toMatchObject({
    text: 'Cancel booking',
    style: 'destructive',
  });
  buttons?.[1]?.onPress?.();
  expect(onConfirm).toHaveBeenCalledTimes(1);

  alert.mockRestore();
});
