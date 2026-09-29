# UI

Shared, typed UI primitives live here. Feature-specific components remain in their app and
compose these primitives.

Import components and theme tokens from the package entry point:

```tsx
import { Button, Screen, StatusBadge, useTheme } from '@quicktrimr/ui';
```

The package exports `Button`, `TextInput`, `Screen`, `Card`, `Badge`, `StatusBadge`, `Avatar`,
`LoadingState`, `EmptyState`, `ErrorState`, `BottomSheet`, and `ConfirmDialog`. Visual values live
only under `src/theme`; feature code composes the primitives instead of introducing a second
palette or spacing scale.

Run its checks from the repository root:

```bash
pnpm --filter @quicktrimr/ui typecheck
pnpm --filter @quicktrimr/ui test
```
