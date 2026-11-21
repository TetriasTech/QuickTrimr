# QuickTrimr — the modern grooming atelier

Provisional demo identity, commissioned by Andrew on 2026-11-21, independently of
backlog ticket delivery (`RULE-BRAND-01`). Andrew delegated creative direction and
confirmed there is no prior client palette to preserve. This is a working identity
for client review, with replaceable assets rather than a permanent brand decision.

The direction is quiet, precise and human: forest ink, warm ivory, a citrus note,
a geometric Q with a decisive diagonal cut, Manrope for utility and Instrument
Serif for a few editorial moments. Space and typography create hierarchy. Real
search, prices and eligibility remain authoritative; visual polish adds no fake
providers, ratings, booking outcomes, tracking or payment promises.

## Change the identity

- Palette, font roles, name, tagline and Q geometry: `packages/ui/src/theme/brand.json`.
- Colour semantics and light/dark treatment: `packages/ui/src/theme/colors.ts`.
- Type scale: `packages/ui/src/theme/typography.ts`; renderers use `useTheme()` so
  OS theme changes update both Android and iOS without stale static style colours.
- Font and photo asset references: `apps/mobile/src/brand/assets.ts`.
- Logo/icon exports: `node scripts/brand/export.mjs` after changing mark geometry.
- Original vector and exported app icon: `packages/ui/assets/brand/`.

No font, image or palette is a business config value. There is no provider-side
change or production deployment in this visual pass.

## Artwork provenance

`editorial.png` was generated with the built-in ImageGen tool for this project.
It is atmosphere artwork, never used as a real barber's profile. Generation brief:

> An intimate editorial close-up of a professional barber's hands giving an adult
> man a precise haircut in a calm contemporary home. View from behind and slightly
> to the side; short dark textured hair, faded nape, cream cape, unbranded clipper.
> Forest-green and ivory interior, window light, warm film grain. Portrait framing
> with space for crops. No typography, logos, watermarks, ratings or prices.

Typefaces are bundled locally with `@expo-google-fonts/manrope` and
`@expo-google-fonts/instrument-serif`; retained licenses are in this directory.
Sources: [Manrope](https://github.com/google/fonts/tree/main/ofl/manrope),
[Instrument Serif](https://github.com/google/fonts/tree/main/ofl/instrumentserif).

## Brand kit

| Asset | Use |
| --- | --- |
| [Primary lockup](../../packages/ui/assets/brand/wordmark.svg) · [PNG](../../packages/ui/assets/brand/wordmark.png) | Forest wordmark on a light background |
| [Inverse lockup](../../packages/ui/assets/brand/wordmark-inverse.svg) · [PNG](../../packages/ui/assets/brand/wordmark-inverse.png) | Ivory wordmark on forest |
| [Forest Q](../../packages/ui/assets/brand/mark-forest.svg) | Light surfaces, app identity |
| [Citrus Q](../../packages/ui/assets/brand/mark-citrus.svg) | Forest surfaces |
| [Transparent Q](../../packages/ui/assets/brand/mark-transparent.svg) | Launch artwork and compositions |
| [App icon](../../packages/ui/assets/brand/app-icon.png) | 1,024 px native icon |

The exported wordmarks contain outlined glyphs, so they render without installed
fonts. The app's accessible lockup uses the bundled font and the same vector mark.
Leave space around the mark; use citrus as a highlight, never small text on ivory.

| Colour | Value | Role |
| --- | --- | --- |
| Forest | `#183D32` | Primary actions, welcome, brand surfaces |
| Ivory | `#F6F5ED` | Warm canvas, inverse type |
| Citrus | `#D6EE8A` | Focused highlights on forest, dark-mode actions |
| Ink | `#152D25` | Main text on light surfaces |
| Sage | `#E8EDE1` | Quiet controls and secondary surfaces |

Body, caption, semantic status and action text are checked at WCAG AA normal-text
contrast in both themes. Content follows Dynamic Type, layouts wrap, and numeric
keyboards have a Done action on iOS. The accessible logo stays at its artwork size;
content and controls scale normally. Native selectors inherit the current accent.

## A future client revision

1. Edit palette and Q paths in `packages/ui/src/theme/brand.json`.
2. Run `node scripts/brand/export.mjs` to regenerate the marks, portable wordmarks,
   native icon and adaptive foreground. Commit the source and exports together.
3. For typography changes, replace the fonts in `apps/mobile/src/brand/assets.ts`,
   update the font roles, exporter font source and the retained licences together.
4. Run the UI contrast tests and inspect light/dark screens on a device. Adjust
   semantic mappings if a new palette needs a different foreground/background pair.

`apps/mobile/app.config.ts` derives native launch/icon colours from that same
palette. Native icon and splash changes appear in a newly built binary. Expo Go
shows the in-app identity and its own native launch shell.

This pass changes presentation in the mobile app; existing server rules, provider
configuration and the operational admin tools retain their established behavior.
