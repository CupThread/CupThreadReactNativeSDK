import test from 'node:test';
import assert from 'node:assert/strict';
import { generateUUID } from '../src/utils/formatters';
import { UserTokenStore } from '../src/client/UserTokenStore';

// ---------------------------------------------------------------------------
// Issue #25 — generateUUID must never fall back to Math.random for identity
// ---------------------------------------------------------------------------

const V4_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The `crypto` global is defined as a getter in some runtimes, so replacement
 * goes through defineProperty and restores the original descriptor afterwards.
 */
const originalCryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

function withCryptoGlobal(cryptoLike: unknown, run: () => void): void {
  Object.defineProperty(globalThis, 'crypto', {
    value: cryptoLike,
    configurable: true,
    writable: true,
  });
  try {
    run();
  } finally {
    if (originalCryptoDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalCryptoDescriptor);
    } else {
      delete (globalThis as any).crypto;
    }
  }
}

/** Counts Math.random invocations so tests can prove the PRNG was never touched. */
function spyMathRandom(): { calls: () => number; restore: () => void } {
  const original = Math.random;
  let count = 0;
  Math.random = () => {
    count++;
    return original();
  };
  return {
    calls: () => count,
    restore: () => {
      Math.random = original;
    },
  };
}

test('generateUUID returns an RFC 4122 v4 UUID on the default runtime', () => {
  const value = generateUUID();
  assert.match(value, V4_UUID_PATTERN);
});

test('generateUUID produces unique values across many calls', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    seen.add(generateUUID());
  }
  assert.equal(seen.size, 500);
});

test('with randomUUID absent, generateUUID fills v4 via getRandomValues and never calls Math.random', () => {
  const random = spyMathRandom();
  let requestedLength = -1;
  const cryptoLike = {
    getRandomValues: (array: Uint8Array) => {
      requestedLength = array.length;
      // Deterministic pseudo-fill (xorshift) so the shape assertions below
      // depend on the version/variant bit manipulation, not on real entropy.
      let state = 0x2545f491;
      for (let i = 0; i < array.length; i++) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        array[i] = state & 0xff;
      }
      return array;
    },
  };

  try {
    let value = '';
    withCryptoGlobal(cryptoLike, () => {
      value = generateUUID();
    });

    assert.equal(requestedLength, 16, 'fallback must request exactly 16 random bytes');
    assert.match(value, V4_UUID_PATTERN);
    assert.equal(random.calls(), 0, 'Math.random must not be used for identity tokens');
  } finally {
    random.restore();
  }
});

test('fallback applies RFC 4122 version and variant bits exactly', () => {
  const cryptoLike = {
    getRandomValues: (array: Uint8Array) => {
      array.fill(0);
      return array;
    },
  };

  let value = '';
  withCryptoGlobal(cryptoLike, () => {
    value = generateUUID();
  });

  // All-zero entropy with v4 bits applied: version nibble "4", variant "10xx" -> "8".
  assert.equal(value, '00000000-0000-4000-8000-000000000000');
});

test('with neither randomUUID nor getRandomValues, generateUUID fails explicitly instead of using Math.random', () => {
  const random = spyMathRandom();

  try {
    withCryptoGlobal({}, () => {
      assert.throws(
        () => generateUUID(),
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /cryptographically secure/);
          assert.match(err.message, /Math\.random/);
          return true;
        }
      );
    });

    // Also covers the "no crypto global at all" shape (older Hermes runtimes).
    withCryptoGlobal(undefined, () => {
      assert.throws(() => generateUUID(), /cryptographically secure/);
    });

    assert.equal(random.calls(), 0, 'Math.random must never be consulted, even on failure');
  } finally {
    random.restore();
  }
});

test('UserTokenStore still mints identity tokens through generateUUID', () => {
  const store = new UserTokenStore();
  const token = store.token;
  assert.match(token, V4_UUID_PATTERN);
});
