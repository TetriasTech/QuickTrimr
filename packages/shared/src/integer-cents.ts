declare const integerCentsBrand: unique symbol;

export type IntegerCents = number & {
  readonly [integerCentsBrand]: 'IntegerCents';
};

export function toIntegerCents(value: number): IntegerCents {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError('Integer cents must be a safe integer');
  }

  return value as IntegerCents;
}
