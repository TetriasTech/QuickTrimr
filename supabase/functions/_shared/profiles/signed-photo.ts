import { barberPhotoLimits } from '@quicktrimr/shared';
import {
  barberPhotoIdSchema,
  postgresUuidSchema,
} from '@quicktrimr/validation';

export async function signBarberPhoto({
  baseUrl,
  serviceRoleKey,
  userId,
  photoId,
  fetcher = fetch,
}: {
  baseUrl: URL;
  serviceRoleKey: string;
  userId: string;
  photoId: unknown;
  fetcher?: typeof fetch;
}) {
  if (photoId === null) return null;
  const path = `/object/sign/barber-avatars/${postgresUuidSchema.parse(userId)}/${barberPhotoIdSchema.parse(photoId)}.jpg`;
  const response = await fetcher(new URL(`/storage/v1${path}`, baseUrl), {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: barberPhotoLimits.signedUrlSeconds }),
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });
  const result: unknown = await response.json();
  if (
    !response.ok ||
    !result ||
    typeof result !== 'object' ||
    !('signedURL' in result) ||
    typeof result.signedURL !== 'string' ||
    !result.signedURL.startsWith(`${path}?token=`)
  )
    throw new Error('Photo signing failed.');
  return `/storage/v1${result.signedURL}`;
}
