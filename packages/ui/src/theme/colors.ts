import brand from './brand.json';

const p = brand.palette;
export const palettes = {
  light: {
    text: p.ink,
    textMuted: p.muted,
    background: p.ivory,
    surface: p.paper,
    surfaceMuted: p.sage,
    border: p.line,
    inputBorder: p.inputLine,
    accent: p.forest,
    onAccent: p.ivory,
    danger: '#B43432',
    onDanger: '#FFFFFF',
    warning: '#885A15',
    success: '#285C40',
    transparent: 'transparent',
  },
  dark: {
    text: p.ivory,
    textMuted: p.nightMuted,
    background: p.night,
    surface: p.nightSurface,
    surfaceMuted: p.nightRaised,
    border: p.nightLine,
    inputBorder: p.nightInputLine,
    accent: p.citrus,
    onAccent: p.ink,
    danger: '#FFAAA2',
    onDanger: '#3D0906',
    warning: '#F0CD8B',
    success: '#A5D6A8',
    transparent: 'transparent',
  },
} as const;
export type ThemeColors = {
  readonly [Key in keyof typeof palettes.light]: string;
};
// Static metadata/test callers use the light palette. Renderers use useTheme().
export const colors = palettes.light;
