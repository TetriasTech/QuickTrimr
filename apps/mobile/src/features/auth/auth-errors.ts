import type { AuthError } from '@supabase/supabase-js';

export function authFailure(error: Pick<AuthError, 'code' | 'status'>) {
  if (error.status === 429) return 'too_many_attempts';
  switch (error.code) {
    case 'invalid_credentials':
    case 'user_not_found':
      return 'invalid_credentials';
    case 'email_not_confirmed':
      return 'email_not_confirmed';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'too_many_attempts';
    case 'otp_expired':
      return 'invalid_code';
    case 'weak_password':
      return 'weak_password';
    case 'same_password':
      return 'same_password';
    default:
      return 'unavailable';
  }
}

export const authMessages = {
  invalid_credentials: 'The email or password is incorrect.',
  email_not_confirmed: 'Confirm your email before signing in.',
  too_many_attempts: 'Too many attempts. Wait a moment and try again.',
  invalid_code:
    'The code is incorrect or expired. Check your email or request a new code.',
  weak_password: 'Choose a stronger password and try again.',
  same_password: 'Choose a password you have not used for this account.',
  unavailable: 'We could not complete the request. Try again.',
} satisfies Record<ReturnType<typeof authFailure>, string>;
