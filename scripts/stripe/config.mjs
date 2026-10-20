import { readFile } from 'node:fs/promises';

function value(markdown, id) {
  const row = markdown
    .split('\n')
    .find((line) => line.startsWith(`| \`${id}\` |`));
  if (!row) throw new Error(`Missing configuration: ${id}`);
  return JSON.parse(row.split('|')[2].trim().replace(/^`|`$/g, ''));
}

export function parseVerificationConfig(markdown) {
  const urls = value(markdown, 'CFG-DEV-PROVIDER-URLS');
  const returnUrl = new URL(urls.stripeReturnUrl);
  const refreshUrl = new URL(urls.stripeRefreshUrl);
  for (const url of [returnUrl, refreshUrl]) {
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Stripe verification callbacks must be local HTTP URLs.');
  }
  if (
    returnUrl.origin !== refreshUrl.origin ||
    returnUrl.pathname === refreshUrl.pathname
  )
    throw new Error(
      'Stripe verification callbacks need one origin and distinct paths.',
    );
  const availableMinutes = value(markdown, 'CFG-AVAIL-EXPIRY-MIN');
  const scheduledHours = value(markdown, 'CFG-SCHED-EXPIRY-HOURS');
  if (
    ![availableMinutes, scheduledHours].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    )
  )
    throw new Error('Invalid pending-request configuration.');
  return {
    port: Number(returnUrl.port || 80),
    returnPath: returnUrl.pathname,
    refreshPath: refreshUrl.pathname,
    pendingWindowSeconds: Math.max(
      availableMinutes * 60,
      scheduledHours * 3600,
    ),
  };
}

export async function loadVerificationConfig() {
  return parseVerificationConfig(
    await readFile(
      new URL('../../QUICKTRIMR_KNOWLEDGE_BASE.md', import.meta.url),
      'utf8',
    ),
  );
}
