import { toIntegerCents } from '../src/index.ts';
import type { IntegerCents } from '../src/index.ts';

const converted: IntegerCents = toIntegerCents(4_500);

// @ts-expect-error A plain number must be explicitly converted to integer cents.
const rawNumber: IntegerCents = 4_500;

function requiresIntegerCents(value: IntegerCents): IntegerCents {
  return value;
}

requiresIntegerCents(converted);

// @ts-expect-error A plain number must be explicitly converted to integer cents.
requiresIntegerCents(4_500);
