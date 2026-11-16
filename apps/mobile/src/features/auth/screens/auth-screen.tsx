import { USER_ROLE_VALUE } from '@quicktrimr/shared';
import {
  Button,
  Screen,
  TextInput,
  colors,
  spacing,
  typography,
} from '@quicktrimr/ui';
import {
  authCodeSchema,
  authEmailSchema,
  authPasswordSchema,
  type CreateOrSyncProfileRequest,
} from '@quicktrimr/validation';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { authFailure, authMessages } from '@/features/auth/auth-errors';
import { useMobileSession } from '@/features/session/session-provider';
import { createRecoverySupabase } from '@/lib/api/supabase';

import type { SupabaseClient } from '@supabase/supabase-js';

type Mode =
  | 'sign-in'
  | 'sign-up'
  | 'confirm-email'
  | 'forgot-password'
  | 'verify-reset'
  | 'new-password';

const titles: Record<Mode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create an account',
  'confirm-email': 'Confirm your email',
  'forgot-password': 'Reset your password',
  'verify-reset': 'Verify your reset code',
  'new-password': 'Choose a new password',
};

const actions: Record<Mode, string> = {
  'sign-in': 'Sign in',
  'sign-up': 'Create account',
  'confirm-email': 'Confirm email',
  'forgot-password': 'Send reset code',
  'verify-reset': 'Verify code',
  'new-password': 'Save password',
};

export function AuthScreen() {
  const { supabase } = useMobileSession();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [role, setRole] = useState<CreateOrSyncProfileRequest['role']>();
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const submitting = useRef(false);
  const recovery = useRef<SupabaseClient | null>(null);

  const showPassword = ['sign-in', 'sign-up', 'new-password'].includes(mode);
  const showCode = mode === 'confirm-email' || mode === 'verify-reset';

  function transition(next: Mode, message = '') {
    setMode(next);
    setPassword('');
    setCode('');
    setError('');
    setStatus(message);
    setNeedsConfirmation(false);
    if (next !== 'new-password') recovery.current = null;
  }

  async function submit() {
    if (submitting.current) return;
    setError('');
    setStatus('');
    const validatedEmail = authEmailSchema.safeParse(email);
    if (mode !== 'new-password' && !validatedEmail.success) {
      setError('Enter a valid email address.');
      return;
    }
    if (showPassword && !authPasswordSchema.safeParse(password).success) {
      setError('Enter a password.');
      return;
    }
    const validatedCode = authCodeSchema.safeParse(code);
    if (showCode && !validatedCode.success) {
      setError('Enter the code from your email.');
      return;
    }
    if (mode === 'sign-up' && !role) {
      setError('Choose Client or Barber.');
      return;
    }

    submitting.current = true;
    setBusy(true);
    try {
      const address = validatedEmail.data ?? '';
      const token = validatedCode.data ?? '';
      switch (mode) {
        case 'sign-in': {
          const { error: failure } = await supabase.auth.signInWithPassword({
            email: address,
            password,
          });
          if (failure) {
            const reason = authFailure(failure);
            setNeedsConfirmation(reason === 'email_not_confirmed');
            setError(authMessages[reason]);
          }
          break;
        }
        case 'sign-up': {
          const result = await supabase.auth.signUp({
            email: address,
            password,
            options: { data: { signup_role: role } },
          });
          if (result.error) setError(authMessages[authFailure(result.error)]);
          else if (!result.data.session)
            transition(
              'confirm-email',
              'Enter the confirmation code sent to your email.',
            );
          break;
        }
        case 'confirm-email': {
          const result = await supabase.auth.verifyOtp({
            email: address,
            token,
            type: 'signup',
          });
          if (result.error) setError(authMessages[authFailure(result.error)]);
          break;
        }
        case 'forgot-password': {
          const { error: failure } =
            await supabase.auth.resetPasswordForEmail(address);
          if (failure && failure.code !== 'user_not_found')
            setError(authMessages[authFailure(failure)]);
          else
            transition(
              'verify-reset',
              'If there is an account for this email, you’ll receive a reset code.',
            );
          break;
        }
        case 'verify-reset': {
          const client = createRecoverySupabase();
          const result = await client.auth.verifyOtp({
            email: address,
            token,
            type: 'recovery',
          });
          if (result.error || !result.data.session)
            setError(
              result.error
                ? authMessages[authFailure(result.error)]
                : authMessages.unavailable,
            );
          else {
            recovery.current = client;
            transition('new-password');
          }
          break;
        }
        case 'new-password': {
          const client = recovery.current;
          if (!client) {
            transition('forgot-password');
            break;
          }
          const result = await client.auth.updateUser({ password });
          if (result.error) setError(authMessages[authFailure(result.error)]);
          else {
            await client.auth.signOut({ scope: 'local' });
            transition(
              'sign-in',
              'Password updated. Sign in with your new password.',
            );
          }
          break;
        }
      }
    } catch {
      setError(authMessages.unavailable);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function resendConfirmation() {
    if (submitting.current) return;
    const address = authEmailSchema.safeParse(email);
    if (!address.success) {
      setError('Enter a valid email address.');
      return;
    }
    submitting.current = true;
    setBusy(true);
    setStatus('');
    setError('');
    try {
      const result = await supabase.auth.resend({
        type: 'signup',
        email: address.data,
      });
      if (result.error && authFailure(result.error) === 'too_many_attempts')
        setError(authMessages.too_many_attempts);
      else setStatus('If confirmation is required, you’ll receive a new code.');
    } catch {
      setError(authMessages.unavailable);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Screen
      scroll
      contentContainerStyle={{ gap: spacing.lg, padding: spacing.lg }}
    >
      <View style={{ gap: spacing.xs }}>
        <Text style={typography.subhead}>QuickTrimr</Text>
        <Text accessibilityRole="header" style={typography.title}>
          {titles[mode]}
        </Text>
      </View>
      {mode !== 'new-password' && (
        <TextInput
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          editable={!busy}
        />
      )}
      {showPassword && (
        <TextInput
          label={mode === 'new-password' ? 'New password' : 'Password'}
          value={password}
          onChangeText={setPassword}
          autoComplete={
            mode === 'sign-in' ? 'current-password' : 'new-password'
          }
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />
      )}
      {showCode && (
        <TextInput
          label="Email code"
          value={code}
          onChangeText={setCode}
          autoComplete="one-time-code"
          keyboardType="number-pad"
          editable={!busy}
        />
      )}
      {mode === 'sign-up' && (
        <View style={{ gap: spacing.sm }}>
          <Text style={typography.subhead}>Account type</Text>
          <Button
            label={
              role === USER_ROLE_VALUE.CLIENT ? 'Client selected' : 'Client'
            }
            variant={role === USER_ROLE_VALUE.CLIENT ? 'primary' : 'secondary'}
            disabled={busy}
            onPress={() => setRole(USER_ROLE_VALUE.CLIENT)}
          />
          <Button
            label={
              role === USER_ROLE_VALUE.BARBER ? 'Barber selected' : 'Barber'
            }
            variant={role === USER_ROLE_VALUE.BARBER ? 'primary' : 'secondary'}
            disabled={busy}
            onPress={() => setRole(USER_ROLE_VALUE.BARBER)}
          />
        </View>
      )}
      {error ? (
        <Text
          accessibilityRole="alert"
          style={{ ...typography.body, color: colors.danger }}
        >
          {error}
        </Text>
      ) : null}
      {status ? (
        <Text accessibilityLiveRegion="polite" style={typography.body}>
          {status}
        </Text>
      ) : null}
      <Button
        label={actions[mode]}
        loading={busy}
        onPress={() => submit().catch(() => setError(authMessages.unavailable))}
      />
      {mode === 'confirm-email' && (
        <Button
          label="Send a new confirmation code"
          variant="secondary"
          disabled={busy}
          onPress={() =>
            resendConfirmation().catch(() => setError(authMessages.unavailable))
          }
        />
      )}
      {mode === 'sign-in' ? (
        <>
          {needsConfirmation && (
            <Button
              label="Confirm email"
              variant="secondary"
              disabled={busy}
              onPress={() => transition('confirm-email')}
            />
          )}
          <Button
            label="Forgot password?"
            variant="ghost"
            disabled={busy}
            onPress={() => transition('forgot-password')}
          />
          <Button
            label="Create an account"
            variant="secondary"
            disabled={busy}
            onPress={() => transition('sign-up')}
          />
        </>
      ) : (
        <Button
          label="Back to sign in"
          variant="ghost"
          disabled={busy}
          onPress={() => transition('sign-in')}
        />
      )}
      {mode === 'verify-reset' && (
        <Button
          label="Request a new reset code"
          variant="secondary"
          disabled={busy}
          onPress={() => transition('forgot-password')}
        />
      )}
    </Screen>
  );
}
