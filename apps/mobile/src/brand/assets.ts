import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif/400Regular';
import { InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif/400Regular_Italic';
import { Manrope_400Regular } from '@expo-google-fonts/manrope/400Regular';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';

// Per-weight imports keep unused font families and weights out of the bundle.
export const brandFonts = {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_700Bold,
  InstrumentSerif_400Regular,
  InstrumentSerif_400Regular_Italic,
} as const;
