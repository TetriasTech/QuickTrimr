import { discoverySortKeySchema } from '@quicktrimr/validation';

const encoder = new TextEncoder();
const encode = (v: Uint8Array) =>
  btoa(String.fromCharCode(...v))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
const decode = (v: string) =>
  Uint8Array.from(atob(v.replaceAll('-', '+').replaceAll('_', '/')), (c) =>
    c.charCodeAt(0),
  );

// AES-256-GCM, random 96-bit nonce, authenticated query/client binding. These
// are protocol sizes, not product bounds. There is no client-readable sort key.
export async function createDiscoveryCursorCodec(secret: string) {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = decode(secret);
  } catch {
    throw new Error('Invalid discovery cursor configuration.');
  }
  if (bytes.length !== 32)
    throw new Error('Invalid discovery cursor configuration.');
  const key = await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
  return {
    async seal(sortKey: unknown, binding: string) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const plaintext = encoder.encode(
        JSON.stringify(discoverySortKeySchema.parse(sortKey)),
      );
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: encoder.encode(binding) },
        key,
        plaintext,
      );
      return `v1.${encode(iv)}.${encode(new Uint8Array(ciphertext))}`;
    },
    async open(cursor: string, binding: string) {
      try {
        // Bound ciphertext framing before decoding/allocating. A sort key's fixed
        // schema fits comfortably inside this protocol envelope.
        if (
          cursor.length > 4096 ||
          !/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor)
        )
          throw new Error();
        const [, ivText, ciphertextText] = cursor.split('.');
        const iv = decode(ivText!);
        if (iv.length !== 12) throw new Error();
        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv, additionalData: encoder.encode(binding) },
          key,
          decode(ciphertextText!),
        );
        return discoverySortKeySchema.parse(
          JSON.parse(new TextDecoder().decode(plaintext)),
        );
      } catch {
        throw new Error('Invalid discovery cursor.');
      }
    },
  };
}
