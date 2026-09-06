import test from 'node:test';
import assert from 'node:assert/strict';
import { UserTokenStore } from '../src/client/UserTokenStore';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** Flush pending microtasks so a resolved storage read can run its adoption handler. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

const TOKEN_KEY = 'cupthread_user_token_v1';

test('UserTokenStore generates valid UUID', () => {
  const store = new UserTokenStore();
  const token = store.token;
  assert.ok(token);
  assert.match(token, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('UserTokenStore caches token', () => {
  const store = new UserTokenStore();
  const token1 = store.token;
  const token2 = store.token;
  assert.equal(token1, token2);
});

test('UserTokenStore resetToken generates new UUID', async () => {
  const store = new UserTokenStore();
  const token1 = store.token;
  const token2 = await store.resetToken();
  assert.notEqual(token1, token2);
  assert.equal(store.token, token2);
});

test('UserTokenStore uses custom storage adapter', async () => {
  const mem: Record<string, string> = {};
  const adapter = {
    getItem: (key: string) => mem[key] || null,
    setItem: (key: string, val: string) => {
      mem[key] = val;
    },
  };
  const store = new UserTokenStore(adapter);
  const token = await store.getToken();
  assert.ok(token);
  assert.equal(mem['cupthread_user_token_v1'], token);
});

test('UserTokenStore recovers existing token from async storage without overwriting', async () => {
  const EXISTING_TOKEN = 'persisted-uuid-from-async-storage-789';
  const mem: Record<string, string> = {
    'cupthread_user_token_v1': EXISTING_TOKEN,
  };

  let setItemCallCount = 0;
  // Simulated AsyncStorage adapter (all methods return Promises)
  const asyncAdapter = {
    getItem: async (key: string) => {
      // Simulate microtask async latency
      await new Promise((resolve) => setTimeout(resolve, 5));
      return mem[key] || null;
    },
    setItem: async (key: string, val: string) => {
      setItemCallCount++;
      await new Promise((resolve) => setTimeout(resolve, 5));
      mem[key] = val;
    },
  };

  // 1. Create store with async adapter: MUST NOT overwrite existing token on construction!
  const store = new UserTokenStore(asyncAdapter);
  assert.equal(mem['cupthread_user_token_v1'], EXISTING_TOKEN);
  assert.equal(setItemCallCount, 0, 'setItem should not be called in constructor for async adapter');

  // 2. Await getToken(): MUST recover existing token
  const retrieved = await store.getToken();
  assert.equal(retrieved, EXISTING_TOKEN, 'Should recover pre-existing token');
  assert.equal(mem['cupthread_user_token_v1'], EXISTING_TOKEN);
  assert.equal(setItemCallCount, 0, 'Should not have overwritten existing token in storage');
});

test('UserTokenStore persists new token to async storage when initially empty', async () => {
  const mem: Record<string, string> = {};
  const asyncAdapter = {
    getItem: async (key: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return mem[key] || null;
    },
    setItem: async (key: string, val: string) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      mem[key] = val;
    },
  };

  const store = new UserTokenStore(asyncAdapter);
  const token = await store.getToken();
  assert.ok(token);
  assert.equal(mem['cupthread_user_token_v1'], token);

  // Subsequent call returns identical token
  const token2 = await store.getToken();
  assert.equal(token2, token);
});

test('UserTokenStore: setToken wins over late-resolving initial storage read', async () => {
  const read1 = deferred<string | null>();
  const writes: Array<[string, string]> = [];
  const adapter = {
    getItem: (key: string) => (key === TOKEN_KEY ? read1.promise : Promise.resolve(null)),
    setItem: (key: string, val: string) => {
      writes.push([key, val]);
      return Promise.resolve();
    },
  };

  // Constructor issues a pending storage read R1.
  const store = new UserTokenStore(adapter);
  // Host restores auth while R1 is still in flight; the write lands in storage.
  await store.setToken('token-explicit-new-user');
  // R1 resolves LAST, carrying the stale previous identity.
  read1.resolve('token-old-user');
  await flushMicrotasks();

  assert.equal(
    store.token,
    'token-explicit-new-user',
    'the explicit setToken() must not be reverted by the late initial read',
  );
  const lastTokenWrite = [...writes].reverse().find(([key]) => key === TOKEN_KEY);
  assert.equal(lastTokenWrite?.[1], 'token-explicit-new-user', 'storage must keep the explicit token');
});

test('UserTokenStore: resetToken wins over late-resolving initial storage read', async () => {
  const read1 = deferred<string | null>();
  const writes: Array<[string, string]> = [];
  const adapter = {
    getItem: (key: string) => (key === TOKEN_KEY ? read1.promise : Promise.resolve(null)),
    setItem: (key: string, val: string) => {
      writes.push([key, val]);
      return Promise.resolve();
    },
  };

  const store = new UserTokenStore(adapter);
  const fresh = await store.resetToken();
  read1.resolve('token-old-user');
  await flushMicrotasks();

  assert.notEqual(fresh, 'token-old-user');
  assert.match(fresh, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(store.token, fresh, 'the reset identity must not be reverted by the late initial read');
  const lastTokenWrite = [...writes].reverse().find(([key]) => key === TOKEN_KEY);
  assert.equal(lastTokenWrite?.[1], fresh, 'storage must keep the reset token');
});

test('UserTokenStore: initial read still adopts persisted token when no interim call happens', async () => {
  const read1 = deferred<string | null>();
  const adapter = {
    getItem: () => read1.promise,
    setItem: () => Promise.resolve(),
  };

  const store = new UserTokenStore(adapter);
  read1.resolve('persisted-token');
  await flushMicrotasks();

  assert.equal(store.token, 'persisted-token', 'a still-empty cache must adopt the persisted token');
});

test('UserTokenStore: throwaway .token mint during pending load is replaced by the persisted token', async () => {
  const read1 = deferred<string | null>();
  const adapter = {
    getItem: () => read1.promise,
    setItem: () => Promise.resolve(),
  };

  const store = new UserTokenStore(adapter);
  const throwaway = store.token; // sync access mints a throwaway in-memory UUID
  assert.notEqual(throwaway, 'persisted-token');
  read1.resolve('persisted-token');
  await flushMicrotasks();

  assert.equal(
    store.token,
    'persisted-token',
    'a throwaway .token mint must still be replaced once storage resolves',
  );
});

test('UserTokenStore: getToken() in-flight read does not revert an interim setToken identity', async () => {
  const read = deferred<string | null>();
  const adapter = {
    getItem: (key: string) => (key === TOKEN_KEY ? read.promise : Promise.resolve(null)),
    setItem: () => Promise.resolve(),
  };

  const store = new UserTokenStore(adapter); // constructor read pending
  const pending = store.getToken(); // getToken()'s own storage read pending
  await store.setToken('token-explicit'); // explicit identity lands mid-read
  read.resolve('token-old-user'); // stale persisted value arrives last

  const resolved = await pending;
  assert.equal(
    resolved,
    'token-explicit',
    'a getToken() whose storage read was in flight during setToken() must resolve the explicit identity',
  );
  assert.equal(store.token, 'token-explicit', 'the cache must keep the explicit identity');
  assert.equal(await store.getToken(), 'token-explicit', 'later getToken() calls must keep the explicit identity');
});

test('UserTokenStore: getToken() in-flight read does not revert an interim resetToken identity', async () => {
  const read = deferred<string | null>();
  const adapter = {
    getItem: (key: string) => (key === TOKEN_KEY ? read.promise : Promise.resolve(null)),
    setItem: () => Promise.resolve(),
  };

  const store = new UserTokenStore(adapter);
  const pending = store.getToken();
  const fresh = await store.resetToken(); // explicit reset lands mid-read
  read.resolve('token-old-user');

  const resolved = await pending;
  assert.notEqual(fresh, 'token-old-user');
  assert.equal(resolved, fresh, 'a getToken() racing resetToken() must resolve the reset identity');
  assert.equal(store.token, fresh, 'the cache must keep the reset identity');
});

test('UserTokenStore: getToken() keeps the explicit identity after a failed storage write', async () => {
  const stored: Record<string, string> = { [TOKEN_KEY]: 'token-old-user' };
  const adapter = {
    getItem: (key: string) => Promise.resolve(stored[key] ?? null),
    setItem: () => Promise.reject(new Error('quota exceeded')), // persistence keeps failing
  };

  const store = new UserTokenStore(adapter);
  await store.setToken('token-explicit'); // write fails silently; cache holds the explicit token
  assert.equal(store.token, 'token-explicit');

  const retrieved = await store.getToken();
  assert.equal(retrieved, 'token-explicit', 'getToken() must not re-adopt the stale persisted token');
  assert.equal(store.token, 'token-explicit', 'the identity must not be permanently reverted');

  const again = await store.getToken();
  assert.equal(again, 'token-explicit', 'repeated getToken() calls must keep the explicit identity');
});

test('UserTokenStore manages changelog seen status with persistence', async () => {
  const mem: Record<string, string> = {};
  const asyncAdapter = {
    getItem: async (key: string) => mem[key] || null,
    setItem: async (key: string, val: string) => {
      mem[key] = val;
    },
    removeItem: async (key: string) => {
      delete mem[key];
    },
  };

  const store1 = new UserTokenStore(asyncAdapter);
  assert.equal(await store1.hasSeenChangelog('1.0.0'), false);
  assert.equal(await store1.hasSeenChangelog('2.0.0'), false);

  // Mark 1.0.0 as seen
  await store1.markChangelogSeen('1.0.0');
  assert.equal(await store1.hasSeenChangelog('1.0.0'), true);
  assert.equal(await store1.hasSeenChangelog('2.0.0'), false);

  // Verify stored payload in storage
  assert.ok(mem['cupthread_seen_changelogs_v1']);
  assert.match(mem['cupthread_seen_changelogs_v1'], /1\.0\.0/);

  // Create new store instance with same storage to verify cross-session recovery
  const store2 = new UserTokenStore(asyncAdapter);
  assert.equal(await store2.hasSeenChangelog('1.0.0'), true);
  assert.equal(await store2.hasSeenChangelog('2.0.0'), false);

  // Clear seen changelogs
  await store2.clearSeenChangelogs();
  assert.equal(await store2.hasSeenChangelog('1.0.0'), false);
});
