// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import LoginPage from '../app/login/page';
import ForbiddenPage from '../app/forbidden/page';
import Loading from '../app/loading';
import ErrorBoundary from '../app/error';
import { Button } from '@/components/ui/button';

afterEach(cleanup);

it('renders honest public copy and a native shadcn form action without claiming sign-in works', () => {
  render(<LoginPage />);
  expect(screen.getByText(/Admin sign-in is not available yet/)).toBeTruthy();
  const button = screen.getByRole('button', { name: 'Check dashboard access' });
  expect(button.getAttribute('data-slot')).toBe('button');
  expect(button.closest('form')?.getAttribute('action')).toBe('/');
});

it('provides a safe return path for a non-admin', () => {
  render(<ForbiddenPage />);
  expect(screen.getByRole('link').getAttribute('href')).toBe('/login');
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
