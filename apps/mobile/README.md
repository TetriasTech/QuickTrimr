# QuickTrimr mobile

The Expo Router shell separates the unauthenticated, client and barber journeys into route groups.
On iOS and Android, Supabase Auth sessions are persisted with Expo SecureStore. After sign-in, the
app uses `create-or-sync-profile` to decide which journey or onboarding screen to open.

From the repository root:

```bash
pnpm --filter @quicktrimr/mobile start
pnpm --filter @quicktrimr/mobile ios
pnpm --filter @quicktrimr/mobile android
```

The app relies on Expo's automatic pnpm-workspace Metro configuration. Do not add legacy
`watchFolders`, `extraNodeModules` or `nodeModulesPath` overrides.

Set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY` in this app's ignored
`.env.local`, copied from `.env.example`. For the iOS simulator, the local API URL is
`http://127.0.0.1:55321`. Use the local stack's public anon key. See the
[environment contract](../../docs/architecture/environment-variables.md).

For local signup confirmation and password recovery, open Mailpit at `http://127.0.0.1:55324`
to read the code for a disposable test email. Restart the local Supabase stack after changing its
email templates. With the local stack and functions running, verify the backend flow with
`node apps/mobile/test/verify-auth-live.mjs` from the repository root.

For hosted development, enable email confirmation in Supabase Auth and install the checked-in
[confirmation](../../supabase/templates/confirmation.html) and
[recovery](../../supabase/templates/recovery.html) templates. Verify email delivery, the profile
function deployment and Auth's password-grant rate limit on that project before using it for QA.
