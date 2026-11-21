import { fireEvent, render, screen } from '@testing-library/react-native';

import { WelcomeScreen } from '../src/brand/welcome-screen';

jest.mock('expo-image', () => ({ Image: () => null }));

test('welcome offers a direct route to either real account flow', async () => {
  const onSignIn = jest.fn(),
    onCreateAccount = jest.fn();
  await render(
    <WelcomeScreen onSignIn={onSignIn} onCreateAccount={onCreateAccount} />,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
  expect(onSignIn).toHaveBeenCalledTimes(1);
  await fireEvent.press(
    screen.getByRole('button', { name: 'Create an account' }),
  );
  expect(onCreateAccount).toHaveBeenCalledTimes(1);
});
