// Opt-in documentation/test examples: keep expanded fixtures out of root imports.
import { CONTRACT_EXAMPLES } from './examples.ts';
import { FOUNDATION_CONTRACT_EXAMPLES } from './foundation-examples.ts';

export const ALL_CONTRACT_EXAMPLES = {
  ...CONTRACT_EXAMPLES,
  ...FOUNDATION_CONTRACT_EXAMPLES,
} as const;
