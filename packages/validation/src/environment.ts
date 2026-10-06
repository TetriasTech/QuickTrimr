import { z } from 'zod';

const environmentValue = z.string().trim().min(1);
const environmentUrl = z.url({ protocol: /^https?$/ });

/** Pure validation shared by the app-specific, static public environment readers. */
export function requireEnvironmentValue(
  value: string | undefined,
  name: string,
): string {
  const result = environmentValue.safeParse(value);
  if (!result.success) throw new Error(`Missing environment variable: ${name}`);
  return result.data;
}

export function requireEnvironmentUrl(
  value: string | undefined,
  name: string,
): string {
  const result = environmentUrl.safeParse(requireEnvironmentValue(value, name));
  // Never include the supplied value or a validation-library error in diagnostics.
  if (!result.success) throw new Error(`Invalid environment URL: ${name}`);
  return result.data;
}
