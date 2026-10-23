import {
  InvalidUserAttributesException,
  InvalidUserAttributesSignatureException,
} from '../client/FeedbackException';
import type { UserAttributesCanonicalArguments, UserAttributesSignature } from '../types';

/**
 * Domain tag of the payment-attribute canonical string. Signing never crosses
 * uses because the tag is part of the signed bytes.
 */
export const USER_ATTRIBUTES_SIGNATURE_VERSION = 'cpt-user-attrs-v1';

/** Grammar of an HMAC-SHA256 signature: exactly 64 hexadecimal characters. */
const SIGNATURE_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * Encodes a string as UTF-8 bytes without relying on `TextEncoder`, which is
 * not available on every React Native runtime the SDK supports.
 *
 * Lone surrogate code units become U+FFFD, matching `TextEncoder` so the
 * signed bytes match what the server's `TextEncoder` verifies.
 */
function utf8Bytes(input: string): Uint8Array {
  const bytes: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    let code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = index + 1 < input.length ? input.charCodeAt(index + 1) : 0;
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        index += 1;
      } else {
        code = 0xfffd;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd;
    }

    if (code <= 0x7f) {
      bytes.push(code);
    } else if (code <= 0x7ff) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f)
      );
    }
  }
  return Uint8Array.from(bytes);
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Bytes(message: Uint8Array): Uint8Array {
  const bitLength = message.length * 8;
  // 0x80 terminator + 8-byte big-endian length, rounded up to 64 bytes.
  const paddedLength = Math.ceil((message.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const schedule = new Uint32Array(64);

  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      schedule[index] = view.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const previous15 = schedule[index - 15];
      const previous2 = schedule[index - 2];
      const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3);
      const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10);
      schedule[index] = (schedule[index - 16] + sigma0 + schedule[index - 7] + sigma1) >>> 0;
    }

    let a = hash[0];
    let b = hash[1];
    let c = hash[2];
    let d = hash[3];
    let e = hash[4];
    let f = hash[5];
    let g = hash[6];
    let h = hash[7];

    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choose + SHA256_CONSTANTS[index] + schedule[index]) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash[0] = (hash[0] + a) >>> 0;
    hash[1] = (hash[1] + b) >>> 0;
    hash[2] = (hash[2] + c) >>> 0;
    hash[3] = (hash[3] + d) >>> 0;
    hash[4] = (hash[4] + e) >>> 0;
    hash[5] = (hash[5] + f) >>> 0;
    hash[6] = (hash[6] + g) >>> 0;
    hash[7] = (hash[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  for (let index = 0; index < 8; index += 1) {
    digestView.setUint32(index * 4, hash[index]);
  }
  return digest;
}

function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Computes an HMAC-SHA256 signature and returns it as lowercase hexadecimal.
 *
 * Pure TypeScript and synchronous, so it works on React Native, Expo, and
 * Node without `crypto.subtle` or native modules.
 *
 * @param secret - Per-app SDK signing secret.
 * @param message - Exact canonical string to authenticate.
 * @returns 64-character lowercase hexadecimal signature.
 */
export function hmacSha256Hex(secret: string, message: string): string {
  const blockSize = 64;
  let key = utf8Bytes(secret);
  if (key.length > blockSize) {
    key = sha256Bytes(key);
  }

  const messageBytes = utf8Bytes(message);
  const paddedKey = new Uint8Array(blockSize);
  paddedKey.set(key);

  const inner = new Uint8Array(blockSize + messageBytes.length);
  const outer = new Uint8Array(blockSize + 32);
  for (let index = 0; index < blockSize; index += 1) {
    inner[index] = paddedKey[index] ^ 0x36;
    outer[index] = paddedKey[index] ^ 0x5c;
  }
  inner.set(messageBytes, blockSize);
  outer.set(sha256Bytes(inner), blockSize);

  return toHex(sha256Bytes(outer));
}

/**
 * Renders a number exactly like the server's `toFixed(2)` canonicalization:
 * two fraction digits, then trailing zeros and a trailing decimal point are
 * stripped (`1200.00` → `1200`, `99.50` → `99.5`).
 *
 * Rounding follows ECMA-262 `Number.prototype.toFixed` on the exact binary
 * double, so a value stored slightly below a half-way point rounds down just
 * as it does on the server.
 */
export function canonicalNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new InvalidUserAttributesException('mrr must be a finite number.');
  }
  return value
    .toFixed(2)
    .replace(/(\.\d*?)0+$/, '$1')
    .replace(/\.$/, '');
}

function canonicalField<T>(value: T | null | undefined, render: (value: T) => string): string {
  if (value === undefined) return 'unset';
  if (value === null) return 'null';
  return render(value);
}

/**
 * Assembles the newline-delimited canonical string that is HMAC-signed for
 * `PUT /api/v1/public/apps/{appKey}/user`:
 *
 * ```
 * cpt-user-attrs-v1
 * <appKey>
 * <userToken>
 * <isPaying: true|false|unset>
 * <plan: value|null|unset>
 * <mrr: canonicalNumber|null|unset>
 * <currency: valueAsSent|unset>
 * <timestamp: epochSeconds>
 * ```
 *
 * Values are rendered exactly as they are sent in the JSON body: absent is
 * `unset`, explicit `null` is `null`, and strings keep their raw bytes.
 */
export function buildUserAttributesCanonicalString(
  arguments_: UserAttributesCanonicalArguments
): string {
  if (!Number.isInteger(arguments_.timestamp) || arguments_.timestamp < 0) {
    throw new InvalidUserAttributesException(
      'The signature timestamp must be a nonnegative integer number of epoch seconds.'
    );
  }

  return [
    USER_ATTRIBUTES_SIGNATURE_VERSION,
    arguments_.appKey,
    arguments_.userToken,
    canonicalField(arguments_.isPaying, (value) => (value ? 'true' : 'false')),
    canonicalField(arguments_.plan, (value) => String(value)),
    canonicalField(arguments_.mrr, canonicalNumber),
    canonicalField(arguments_.currency, (value) => String(value)),
    String(arguments_.timestamp),
  ].join('\n');
}

/**
 * Signs the canonical string with the configured secret.
 *
 * @internal Exposed through {@link hmacSha256Hex} for hosts that need to sign
 * on their own backend and hand the result to a
 * {@link UserAttributesSigner} provider.
 */
export function signUserAttributes(
  secret: string,
  arguments_: UserAttributesCanonicalArguments
): UserAttributesSignature {
  return {
    signature: hmacSha256Hex(secret, buildUserAttributesCanonicalString(arguments_)),
    timestamp: arguments_.timestamp,
  };
}

/**
 * Validates a signature produced by a host-supplied {@link UserAttributesSigner}.
 *
 * A backend signer can return a malformed hex string, a fractional timestamp,
 * or a timestamp that differs from the one embedded in the canonical string it
 * signed. Each case would spend a request the server must reject with
 * `invalid_signature` or desynchronize the signature from the payload, so it
 * fails locally before the request is built.
 *
 * @internal
 */
export function assertValidUserAttributesSignature(
  result: UserAttributesSignature | null | undefined,
  expectedTimestamp: number
): asserts result is UserAttributesSignature {
  if (
    !result ||
    typeof result.signature !== 'string' ||
    !SIGNATURE_PATTERN.test(result.signature)
  ) {
    throw new InvalidUserAttributesSignatureException(
      'The userAttributesSigner must return a 64-character hexadecimal HMAC-SHA256 signature.'
    );
  }
  if (!Number.isInteger(result.timestamp) || result.timestamp < 0) {
    throw new InvalidUserAttributesSignatureException(
      'The userAttributesSigner must return a nonnegative integer timestamp in epoch seconds.'
    );
  }
  if (result.timestamp !== expectedTimestamp) {
    throw new InvalidUserAttributesSignatureException(
      'The userAttributesSigner timestamp must match the timestamp embedded in the canonical string.'
    );
  }
}
