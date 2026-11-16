// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/button';

import ErrorBoundary from '../app/error';
import { GET as forbiddenResponse } from '../app/forbidden/route';
import Loading from '../app/loading';
import LoginPage from '../app/login/page';

afterEach(cleanup);
vi.mock('@/lib/auth/actions', () => ({
  signInAdmin: vi.fn(),
  signOutAdmin: vi.fn(),
}));

it('renders the public sign-in form with a password input and expiry status', async () => {
  render(
    await LoginPage({ searchParams: Promise.resolve({ reason: 'expired' }) }),
  );
  expect(screen.getByRole('status').textContent).toContain(
    'Your session ended.',
  );
  expect(screen.getByLabelText('Password').getAttribute('type')).toBe(
    'password',
  );
  const button = screen.getByRole('button', { name: 'Sign in' });
  expect(button.getAttribute('data-slot')).toBe('button');
  expect(button.closest('form')).toBeTruthy();
});

it('provides a safe return path for a non-admin with an actual 403 status', async () => {
  const response = forbiddenResponse();
  expect(response.status).toBe(403);
  expect(await response.text()).toContain('href="/login"');
});

it('announces loading without rendering private placeholder content', () => {
  render(<Loading />);
  expect(screen.getByRole('status').textContent).toBe(
    'Loading admin workspace…',
  );
});

it('shows a generic error, hides raw error details, and retries through the boundary callback', () => {
  const reset = vi.fn();
  render(
    <ErrorBoundary
      error={new Error('sensitive backend diagnostic')}
      reset={reset}
    />,
  );
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(screen.queryByText(/sensitive backend diagnostic/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(reset).toHaveBeenCalledOnce();
});

it('preserves native disabled button semantics', () => {
  const action = vi.fn();
  render(
    <Button disabled onClick={action}>
      Unavailable
    </Button>,
  );
  fireEvent.click(screen.getByRole('button'));
  expect(action).not.toHaveBeenCalled();
});
