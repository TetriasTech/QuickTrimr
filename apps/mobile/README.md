# QuickTrimr mobile

The Expo Router shell separates the unauthenticated, client and barber journeys into route groups.
Real authentication and persisted sessions arrive in `P1-T01`; until then, the root navigator uses
the immutable placeholder session in `src/features/session/placeholder-session.ts`.

From the repository root:

```bash
pnpm --filter @quicktrimr/mobile start
pnpm --filter @quicktrimr/mobile ios
pnpm --filter @quicktrimr/mobile android
```

The app relies on Expo's automatic pnpm-workspace Metro configuration. Do not add legacy
`watchFolders`, `extraNodeModules` or `nodeModulesPath` overrides.

The shell needs no credentials. Future integrations use `mobileEnv` in `src/lib/env.ts` and
public values from this app's `.env.local`, copied from `.env.example`. Do not read the process
environment in screens or copy backend/operator configuration here. See the
[environment contract](../../docs/architecture/environment-variables.md).
