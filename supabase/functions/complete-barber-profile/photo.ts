import { barberPhotoLimits } from '@quicktrimr/shared';
import { decode, encode } from 'jpeg-js';

export const photoBucket = 'barber-avatars';
export const photoObject = (userId: string, id: string) =>
  `${photoBucket}/${userId}/${id}.jpg`;

async function boundedJpeg(request: Request) {
  if (request.headers.get('content-type') !== 'image/jpeg' || !request.body)
    return null;
  const { maxBytes } = barberPhotoLimits;
  if (Number(request.headers.get('content-length')) > maxBytes) return null;
  const buffer = new Uint8Array(maxBytes);
  const reader = request.body.getReader();
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (length + chunk.value.byteLength > maxBytes) {
        await reader.cancel();
        return null;
      }
      buffer.set(chunk.value, length);
      length += chunk.value.byteLength;
    }
    return buffer.subarray(0, length);
  } finally {
    reader.releaseLock();
  }
}

export async function normalizeBarberPhoto(request: Request) {
  const bytes = await boundedJpeg(request);
  if (!bytes) return null;
  try {
    const { maxBytes, maxPixelsPerSide } = barberPhotoLimits;
    const decoded = decode(bytes, {
      useTArray: true,
      tolerantDecoding: false,
      maxResolutionInMP: maxPixelsPerSide ** 2 / 1_000_000,
      maxMemoryUsageInMB: 64,
    });
    if (Math.max(decoded.width, decoded.height) > maxPixelsPerSide) return null;
    // Re-encode pixels without EXIF/comment data, which can contain a GPS point.
    const normalized = new Uint8Array(
      encode(
        {
          data: decoded.data,
          width: decoded.width,
          height: decoded.height,
        },
        85,
      ).data,
    );
    if (normalized.byteLength > maxBytes) return null;
    const digest = await crypto.subtle.digest('SHA-256', normalized);
    const id = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    return { id, bytes: normalized };
  } catch {
    return null;
  }
}
