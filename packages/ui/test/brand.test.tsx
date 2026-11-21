import { render, screen } from '@testing-library/react-native';
import { useColorScheme } from 'react-native';

import { BrandLockup, Button, palettes } from '../src';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

function luminance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((v) => {
      const c = parseInt(v, 16) / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (values[1]! + 0.05) / (values[0]! + 0.05);
}

test.each(['light', 'dark'] as const)(
  '%s text combinations meet WCAG AA normal-text contrast',
  (scheme) => {
    const p = palettes[scheme];
    for (const foreground of [
      'text',
      'textMuted',
      'accent',
      'danger',
      'warning',
      'success',
    ] as const)
      for (const background of [
        'background',
        'surface',
        'surfaceMuted',
      ] as const)
        expect(
          {
            pair: `${foreground}/${background}`,
            ratio: contrast(p[foreground], p[background]),
          }.ratio,
        ).toBeGreaterThanOrEqual(4.5);
    for (const surface of [p.background, p.surface]) {
      expect(contrast(p.inputBorder, surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(p.accent, surface)).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(p.onDanger, p.danger)).toBeGreaterThanOrEqual(4.5);
  },
);

test('shared controls and the wordmark update with the system appearance', async () => {
  jest.mocked(useColorScheme).mockReturnValue('light');
  const { rerender } = await render(
    <>
      <BrandLockup />
      <Button label="Continue" />
    </>,
  );
  expect(screen.getByText('QuickTrimr')).toHaveStyle({
    color: palettes.light.text,
  });
  expect(screen.getByRole('button', { name: 'Continue' })).toHaveStyle({
    backgroundColor: palettes.light.accent,
  });
  jest.mocked(useColorScheme).mockReturnValue('dark');
  await rerender(
    <>
      <BrandLockup />
      <Button label="Continue" />
    </>,
  );
  expect(screen.getByText('QuickTrimr')).toHaveStyle({
    color: palettes.dark.text,
  });
  expect(screen.getByRole('button', { name: 'Continue' })).toHaveStyle({
    backgroundColor: palettes.dark.accent,
  });
});

test('choice buttons preserve selection and disabled accessibility states', async () => {
  await render(
    <Button
      label="Scheduled"
      accessibilityState={{ selected: true }}
      disabled
    />,
  );
  const button = screen.getByRole('button', { name: 'Scheduled' });
  expect(button).toBeSelected();
  expect(button).toBeDisabled();
});
