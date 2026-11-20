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

// One bounded Storage request for an entire discovery page; no per-barber I/O.
export async function signBarberPhotos({
  baseUrl,
  serviceRoleKey,
  photos,
  fetcher = fetch,
}: {
  baseUrl: URL;
  serviceRoleKey: string;
  photos: { userId: string; photoId: unknown }[];
  fetcher?: typeof fetch;
}) {
  const paths = photos.map((p) =>
    p.photoId === null
      ? null
      : `${postgresUuidSchema.parse(p.userId)}/${barberPhotoIdSchema.parse(p.photoId)}.jpg`,
  );
  const requested = Array.from(
    new Set(paths.filter((p): p is string => p !== null)),
  );
  if (!requested.length) return paths.map(() => null);
  const response = await fetcher(
    new URL('/storage/v1/object/sign/barber-avatars', baseUrl),
    {
      method: 'POST',
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        paths: requested,
        expiresIn: barberPhotoLimits.signedUrlSeconds,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    },
  );
  const value: unknown = await response.json();
  if (
    !response.ok ||
    !Array.isArray(value) ||
    value.length !== requested.length
  )
    throw new Error('Photo batch signing failed.');
  const urls = new Map<string, string>();
  for (const row of value) {
    if (
      !row ||
      typeof row !== 'object' ||
      typeof row.path !== 'string' ||
      !requested.includes(row.path) ||
      urls.has(row.path) ||
      (row.error !== undefined && row.error !== null) ||
      typeof row.signedURL !== 'string' ||
      !row.signedURL.startsWith(
        `/object/sign/barber-avatars/${row.path}?token=`,
      )
    )
      throw new Error('Photo batch signing failed.');
    urls.set(row.path, `/storage/v1${row.signedURL}`);
  }
  return paths.map((path) => (path === null ? null : urls.get(path)!));
}
