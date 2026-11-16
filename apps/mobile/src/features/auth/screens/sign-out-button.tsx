import { Button, colors, typography } from '@quicktrimr/ui';
import { useMutation } from '@tanstack/react-query';
import { Text } from 'react-native';

import { useMobileSession } from '@/features/session/session-provider';

export function SignOutButton() {
  const { supabase } = useMobileSession();
  const signOut = useMutation({
    async mutationFn() {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    },
  });

  return (
    <>
      {signOut.isError && (
        <Text
          accessibilityRole="alert"
          style={{ ...typography.body, color: colors.danger }}
        >
          Could not sign out. Try again.
        </Text>
      )}
      <Button
        label="Sign out"
        variant="secondary"
        loading={signOut.isPending}
        onPress={() => signOut.mutate()}
      />
    </>
  );
}
