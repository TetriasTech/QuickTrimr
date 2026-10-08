# UI

Shared, typed UI primitives live here. Feature-specific components remain in their app and
compose these primitives.

These components are React Native primitives. Web/server workspace probes can import
`UI_PACKAGE_NAME` from `@quicktrimr/ui/metadata` without pulling in native components or their
types. The Next.js admin's web adapters live in `apps/admin/src/components/admin`.

`@quicktrimr/ui/presentation` is a native-free, pure subpath. It exports the single
`formatAudCents(IntegerCents)` display formatter and exhaustive booking/payment/earning/payout/
dispute status presentation metadata. Formatting preserves exact signed cents at safe-integer
limits using BigInt; fractional/non-finite/unsafe inputs throw. It does not calculate business
amounts or decide status transitions. The native booking badge imports the same metadata, keeping
its existing component props, labels and public exports. Importing this subpath in Next does not
load React Native or native controls.

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
