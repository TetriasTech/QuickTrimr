import { z } from 'zod';

export function requestPaymentSweep({
  supabaseUrl,
  serviceRoleKey,
}: {
  supabaseUrl: string;
  serviceRoleKey: string;
}) {
  const url = new URL(
    '/functions/v1/capture-authorised-payment/sweep',
    supabaseUrl,
  );
  return async (requestId: string) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + serviceRoleKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ requestId }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return false;
    return z
      .strictObject({ captured: z.boolean() })
      .parse(await response.json()).captured;
  };
}
