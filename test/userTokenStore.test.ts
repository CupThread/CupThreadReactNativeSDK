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
    cupthread_user_token_v1: EXISTING_TOKEN,
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
  assert.equal(
    setItemCallCount,
    0,
    'setItem should not be called in constructor for async adapter'
  );

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
    'the explicit setToken() must not be reverted by the late initial read'
  );
  const lastTokenWrite = [...writes].reverse().find(([key]) => key === TOKEN_KEY);
  assert.equal(
    lastTokenWrite?.[1],
    'token-explicit-new-user',
    'storage must keep the explicit token'
  );
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
  assert.equal(
    store.token,
    fresh,
    'the reset identity must not be reverted by the late initial read'
  );
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

  assert.equal(
    store.token,
    'persisted-token',
    'a still-empty cache must adopt the persisted token'
  );
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
    'a throwaway .token mint must still be replaced once storage resolves'
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
    'a getToken() whose storage read was in flight during setToken() must resolve the explicit identity'
  );
  assert.equal(store.token, 'token-explicit', 'the cache must keep the explicit identity');
  assert.equal(
    await store.getToken(),
    'token-explicit',
    'later getToken() calls must keep the explicit identity'
  );
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
  assert.equal(
    retrieved,
    'token-explicit',
    'getToken() must not re-adopt the stale persisted token'
  );
  assert.equal(store.token, 'token-explicit', 'the identity must not be permanently reverted');

  const again = await store.getToken();
  assert.equal(
    again,
    'token-explicit',
    'repeated getToken() calls must keep the explicit identity'
  );
});

test('UserTokenStore notifies subscribers on explicit identity switches', async () => {
  const store = new UserTokenStore();
  let changes = 0;
  const unsubscribe = store.subscribe(() => {
    changes++;
  });

  await store.setToken('identity-a');
  assert.equal(changes, 1, 'setToken with a new identity must notify');

  await store.setToken('identity-a');
  assert.equal(changes, 1, 'setting the identical token must not notify');

  const fresh = await store.resetToken();
  assert.equal(changes, 2, 'resetToken must notify');
  assert.equal(store.token, fresh);

  unsubscribe();
  unsubscribe(); // idempotent
  await store.setToken('identity-b');
  assert.equal(changes, 2, 'unsubscribed listeners stop receiving notifications');
});

test('UserTokenStore getToken notifies only on identity change', async () => {
  const EXISTING_TOKEN = 'persisted-identity-token';
  const mem: Record<string, string> = { [TOKEN_KEY]: EXISTING_TOKEN };
  // Keep the constructor's initial storage read pending so the cache is still
  // empty when getToken() runs and its adoption is observable.
  const firstRead = deferred<string | null>();
  let getItemCalls = 0;
  const adapter = {
    getItem: (key: string) => {
      getItemCalls++;
      if (getItemCalls === 1) return firstRead.promise;
      return Promise.resolve(mem[key] ?? null);
    },
    setItem: async (key: string, val: string) => {
      mem[key] = val;
    },
  };

  const store = new UserTokenStore(adapter);
  let changes = 0;
  store.subscribe(() => {
    changes++;
  });

  await store.getToken();
  assert.equal(changes, 1, 'recovering a persisted token into an empty cache must notify');

  await store.getToken();
  assert.equal(changes, 1, 're-resolving the same identity must not notify');

  firstRead.resolve(EXISTING_TOKEN);
  await flushMicrotasks();
  assert.equal(changes, 1, 'the late initial read must not double-notify');
});

test('UserTokenStore subscriber errors never break token resolution', async () => {
  const store = new UserTokenStore();
  store.subscribe(() => {
    throw new Error('subscriber boom');
  });
  let notified = 0;
  store.subscribe(() => {
    notified++;
  });

  const fresh = await store.resetToken();
  assert.equal(notified, 1, 'listeners after a throwing one must still run');
  assert.equal(store.token, fresh, 'token resolution must complete');
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

test('UserTokenStore: changelog seen persistence across cold start with storage adapter', async () => {
  const mem: Record<string, string> = {};
  const adapter = {
    getItem: async (key: string) => mem[key] || null,
    setItem: async (key: string, val: string) => {
      mem[key] = val;
    },
  };

  const storeA = new UserTokenStore(adapter);
  assert.equal(storeA.isPersistent, true);
  await storeA.markChangelogSeen('1.2.0');
  assert.equal(await storeA.hasSeenChangelog('1.2.0'), true);

  // Construct store B over the same adapter (simulating a cold start)
  const storeB = new UserTokenStore(adapter);
  assert.equal(storeB.isPersistent, true);
  assert.equal(await storeB.hasSeenChangelog('1.2.0'), true);
});

test('UserTokenStore: in-memory degradation without adapter emits dev console.warn and resets on cold start', async () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: any[]) => {
    warnings.push(args.map(String).join(' '));
  };

  try {
    const storeA = new UserTokenStore(); // no storage adapter
    assert.equal(storeA.isPersistent, false);

    // Marking seen in-memory emits the dev warning
    await storeA.markChangelogSeen('1.2.0');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Changelog seen-status will not survive/i);
    assert.match(warnings[0], /UserTokenStore\.configure/);

    // Seen in memory on the current instance
    assert.equal(await storeA.hasSeenChangelog('1.2.0'), true);

    // Subsequent call does not spam warnings
    await storeA.markChangelogSeen('1.2.1');
    assert.equal(warnings.length, 1);

    // Fresh instance simulating process restart / cold start
    const storeB = new UserTokenStore();
    assert.equal(storeB.isPersistent, false);
    assert.equal(await storeB.hasSeenChangelog('1.2.0'), false);
    assert.equal(await storeB.hasSeenChangelog('1.2.1'), false);
  } finally {
    console.warn = originalWarn;
  }
});

test('prepareChangelogOverlay with onlyIfUnseen suppresses seen release when backed by adapter', async () => {
  const { FeedbackClient } = await import('../src/client/FeedbackClient');
  const originalFetch = globalThis.fetch;

  let activeVersion = '1.2.0';
  globalThis.fetch = (async (url: string | URL | Request) => {
    const s = url.toString();
    if (s.includes('/api/v1/public/config/')) {
      return new Response(
        JSON.stringify({
          appKey: 'app_overlay_spec',
          sdk: {
            features: { changelog: true },
            changelogOverlay: { entryCount: 3 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (s.includes('/changelog')) {
      return new Response(
        JSON.stringify({
          entries: [
            {
              id: `entry_${activeVersion}`,
              versionLabel: activeVersion,
              title: `Release ${activeVersion}`,
              body: 'Release notes',
              publishedAt: new Date().toISOString(),
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 200 });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_overlay_spec',
    });

    const mem: Record<string, string> = {};
    const adapter = {
      getItem: async (key: string) => mem[key] || null,
      setItem: async (key: string, val: string) => {
        mem[key] = val;
      },
    };
    const store = new UserTokenStore(adapter, { appKey: 'app_overlay_spec' });

    // Call 1: Unseen version returns overlay payload
    const result1 = await client.prepareChangelogOverlay({ onlyIfUnseen: true, tokenStore: store });
    assert.ok(result1);
    assert.equal(result1?.latestKey, '1.2.0');

    // Mark 1.2.0 seen
    await store.markChangelogSeen('1.2.0');

    // Call 2: Second call returns null
    const result2 = await client.prepareChangelogOverlay({ onlyIfUnseen: true, tokenStore: store });
    assert.equal(
      result2,
      null,
      'Overlay should return null once latest version was marked as seen'
    );

    // Newer version published (1.3.0)
    activeVersion = '1.3.0';
    const result3 = await client.prepareChangelogOverlay({ onlyIfUnseen: true, tokenStore: store });
    assert.ok(result3, 'Overlay should reappear when a new version is published');
    assert.equal(result3?.latestKey, '1.3.0');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('prepareChangelogOverlay honors tokenStore prop passthrough and warns on unpersisted store', async () => {
  const { FeedbackClient } = await import('../src/client/FeedbackClient');
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: any[]) => {
    warnings.push(args.map(String).join(' '));
  };

  globalThis.fetch = (async (url: string | URL | Request) => {
    const s = url.toString();
    if (s.includes('/api/v1/public/config/')) {
      return new Response(
        JSON.stringify({
          appKey: 'app_overlay_passthrough',
          sdk: {
            features: { changelog: true },
            changelogOverlay: { entryCount: 3 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (s.includes('/changelog')) {
      return new Response(
        JSON.stringify({
          entries: [
            {
              id: 'ch_passthrough',
              versionLabel: '2.5.0',
              title: 'Release 2.5.0',
              body: 'Release notes',
              publishedAt: new Date().toISOString(),
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 200 });
  }) as any;

  try {
    const client = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_overlay_passthrough',
    });

    const mem: Record<string, string> = {};
    const adapter = {
      getItem: async (key: string) => mem[key] || null,
      setItem: async (key: string, val: string) => {
        mem[key] = val;
      },
    };

    // Store A passed as tokenStore
    const storeA = new UserTokenStore(adapter);
    const res = await client.prepareChangelogOverlay({ onlyIfUnseen: true, tokenStore: storeA });
    assert.ok(res);
    assert.equal(res?.latestKey, '2.5.0');

    // Mark seen on storeA
    await storeA.markChangelogSeen('2.5.0');

    // Second store instance sharing adapter sees the key written via storeA
    const storeB = new UserTokenStore(adapter);
    const seenByStoreB = await storeB.hasSeenChangelog('2.5.0');
    assert.equal(seenByStoreB, true, 'Second store instance with same adapter must see seen key');

    // Calling prepareChangelogOverlay with unpersisted store emits dev warning
    const unpersisted = new UserTokenStore();
    await client.prepareChangelogOverlay({ onlyIfUnseen: true, tokenStore: unpersisted });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Changelog seen-status will not survive/i);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

function memoryAdapter(): { adapter: any; mem: Record<string, string> } {
  const mem: Record<string, string> = {};
  return {
    mem,
    adapter: {
      getItem: async (key: string) => mem[key] ?? null,
      setItem: async (key: string, value: string) => {
        mem[key] = value;
      },
      removeItem: async (key: string) => {
        delete mem[key];
      },
    },
  };
}

test('UserTokenStore: scopes changelog seen state by appKey', async () => {
  const { adapter, mem } = memoryAdapter();
  const appA = new UserTokenStore(adapter, { appKey: 'app_a' });
  const appB = new UserTokenStore(adapter, { appKey: 'app_b' });

  await appA.markChangelogSeen('1.2.0');

  assert.equal(await appA.hasSeenChangelog('1.2.0'), true);
  assert.equal(await appB.hasSeenChangelog('1.2.0'), false, 'app scopes must not share seen ids');

  assert.ok(mem['cupthread_seen_changelogs_v1:app_a']);
  assert.equal(mem['cupthread_seen_changelogs_v1:app_b'], undefined);
  assert.equal(
    mem['cupthread_seen_changelogs_v1'],
    undefined,
    'scoped writes must not touch the legacy global key'
  );

  await appB.markChangelogSeen('1.2.0');
  assert.equal(await appB.hasSeenChangelog('1.2.0'), true);
  assert.equal(await appA.hasSeenChangelog('1.2.0'), true);
});

test('UserTokenStore: a per-call appKey overrides the configured scope', async () => {
  const { adapter } = memoryAdapter();
  const store = new UserTokenStore(adapter, { appKey: 'app_a' });

  await store.markChangelogSeen('2.0.0', 'app_b');

  assert.equal(await store.hasSeenChangelog('2.0.0', 'app_b'), true);
  assert.equal(await store.hasSeenChangelog('2.0.0', 'app_a'), false);
  assert.equal(await store.hasSeenChangelog('2.0.0'), false, 'configured scope stayed untouched');
});

test('UserTokenStore: getSeenStorageKey scopes keys and falls back to the legacy key', () => {
  assert.equal(
    UserTokenStore.getSeenStorageKey('app_live_abc123'),
    'cupthread_seen_changelogs_v1:app_live_abc123'
  );
  assert.equal(
    UserTokenStore.getSeenStorageKey('  app_trimmed  '),
    'cupthread_seen_changelogs_v1:app_trimmed'
  );
  assert.equal(UserTokenStore.getSeenStorageKey(''), 'cupthread_seen_changelogs_v1');
  assert.equal(UserTokenStore.getSeenStorageKey(null), 'cupthread_seen_changelogs_v1');
  assert.equal(UserTokenStore.getSeenStorageKey(undefined), 'cupthread_seen_changelogs_v1');
});

test('UserTokenStore: evicts the oldest seen changelogs once the retention cap is reached', async () => {
  const { adapter, mem } = memoryAdapter();
  const store = new UserTokenStore(adapter, { appKey: 'app_cap' });
  const total = UserTokenStore.MAX_SEEN_CHANGELOGS + 5;

  for (let i = 0; i < total; i++) {
    await store.markChangelogSeen(`1.0.${i}`);
  }

  assert.equal(await store.hasSeenChangelog('1.0.0'), false, 'oldest entry must be evicted');
  assert.equal(await store.hasSeenChangelog('1.0.4'), false, 'first five entries must be evicted');
  assert.equal(await store.hasSeenChangelog('1.0.5'), true, 'the cap keeps the newest entries');
  assert.equal(await store.hasSeenChangelog(`1.0.${total - 1}`), true);

  const persisted = JSON.parse(mem['cupthread_seen_changelogs_v1:app_cap']);
  assert.equal(persisted.length, UserTokenStore.MAX_SEEN_CHANGELOGS);
  assert.equal(persisted[0], '1.0.5', 'persisted order must start at the first retained entry');
});

test('UserTokenStore: trims an oversized persisted seen set on load', async () => {
  const { adapter, mem } = memoryAdapter();
  const oversized = Array.from(
    { length: UserTokenStore.MAX_SEEN_CHANGELOGS + 10 },
    (_, i) => `3.0.${i}`
  );
  mem['cupthread_seen_changelogs_v1:app_trim'] = JSON.stringify(oversized);

  const store = new UserTokenStore(adapter, { appKey: 'app_trim' });

  assert.equal(await store.hasSeenChangelog('3.0.0'), false);
  assert.equal(await store.hasSeenChangelog('3.0.9'), false);
  assert.equal(await store.hasSeenChangelog('3.0.10'), true);
  assert.equal(await store.hasSeenChangelog(`3.0.${oversized.length - 1}`), true);

  const rewritten = JSON.parse(mem['cupthread_seen_changelogs_v1:app_trim']);
  assert.equal(rewritten.length, UserTokenStore.MAX_SEEN_CHANGELOGS, 'load must persist the trim');
  assert.equal(rewritten[0], '3.0.10');
});

test('UserTokenStore: migrates the legacy unscoped seen set into the first app scope', async () => {
  const { adapter, mem } = memoryAdapter();
  mem['cupthread_seen_changelogs_v1'] = JSON.stringify(['1.0.0', '1.1.0']);

  const appA = new UserTokenStore(adapter, { appKey: 'app_a' });
  assert.equal(await appA.hasSeenChangelog('1.0.0'), true, 'single-app upgrade keeps seen state');
  assert.equal(await appA.hasSeenChangelog('1.1.0'), true);

  assert.equal(
    mem['cupthread_seen_changelogs_v1'],
    undefined,
    'the legacy blob must be dropped once adopted'
  );
  const migrated = JSON.parse(mem['cupthread_seen_changelogs_v1:app_a']);
  assert.deepEqual(migrated.sort(), ['1.0.0', '1.1.0']);

  const appB = new UserTokenStore(adapter, { appKey: 'app_b' });
  assert.equal(
    await appB.hasSeenChangelog('1.0.0'),
    false,
    'another app must not inherit the migrated entries'
  );
});

test('UserTokenStore: clearSeenChangelogs only clears the requested scope', async () => {
  const { adapter } = memoryAdapter();
  const store = new UserTokenStore(adapter, { appKey: 'app_a' });

  await store.markChangelogSeen('1.0.0');
  await store.markChangelogSeen('1.0.0', 'app_b');

  await store.clearSeenChangelogs('app_a');

  assert.equal(await store.hasSeenChangelog('1.0.0'), false);
  assert.equal(await store.hasSeenChangelog('1.0.0', 'app_b'), true);
});

test('prepareChangelogOverlay scopes onlyIfUnseen by the client appKey', async () => {
  const { FeedbackClient } = await import('../src/client/FeedbackClient');
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (url: string | URL | Request) => {
    const s = url.toString();
    if (s.includes('/api/v1/public/config/')) {
      return new Response(
        JSON.stringify({
          appKey: 'app_scoped_overlay',
          sdk: {
            features: { changelog: true },
            changelogOverlay: { entryCount: 3 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (s.includes('/changelog')) {
      return new Response(
        JSON.stringify({
          entries: [
            {
              id: 'entry_1.4.0',
              versionLabel: '1.4.0',
              title: 'Release 1.4.0',
              body: 'Release notes',
              publishedAt: new Date().toISOString(),
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('{}', { status: 200 });
  }) as any;

  try {
    const clientA = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_a',
    });
    const clientB = new FeedbackClient({
      baseUrl: 'https://api.cupthread.com',
      appKey: 'app_b',
    });
    const { adapter } = memoryAdapter();
    const store = new UserTokenStore(adapter);

    assert.ok(await clientA.prepareChangelogOverlay({ onlyIfUnseen: true, tokenStore: store }));

    await store.markChangelogSeen('1.4.0', 'app_a');

    assert.equal(
      await clientA.prepareChangelogOverlay({ onlyIfUnseen: true, tokenStore: store }),
      null,
      'the app that saw the release keeps the overlay hidden'
    );
    assert.ok(
      await clientB.prepareChangelogOverlay({ onlyIfUnseen: true, tokenStore: store }),
      'another app with the same version label still sees its overlay'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('UserTokenStore: setAppKey switches the default scope and null unscopes', async () => {
  const { adapter } = memoryAdapter();
  const store = new UserTokenStore(adapter, { appKey: 'app_a' });
  await store.markChangelogSeen('9.0.0');

  store.setAppKey('  app_b  ');
  assert.equal(store.getAppKey(), 'app_b');
  assert.equal(await store.hasSeenChangelog('9.0.0'), false, 'a new scope starts empty');

  store.setAppKey(null);
  assert.equal(store.getAppKey(), null);
  assert.equal(await store.hasSeenChangelog('9.0.0'), false);
});

test('UserTokenStore: keeps the legacy blob when the scoped migration write fails', async () => {
  const { adapter, mem } = memoryAdapter();
  const failingAdapter = {
    ...adapter,
    setItem: async (key: string, value: string) => {
      if (key.includes(':')) throw new Error('storage full');
      mem[key] = value;
    },
  };
  mem['cupthread_seen_changelogs_v1'] = JSON.stringify(['7.0.0']);

  const store = new UserTokenStore(failingAdapter, { appKey: 'app_a' });

  assert.equal(await store.hasSeenChangelog('7.0.0'), true, 'the read still adopts the entries');
  assert.equal(
    mem['cupthread_seen_changelogs_v1'],
    JSON.stringify(['7.0.0']),
    'a failed scoped write must not delete the only persisted copy'
  );
});

test('UserTokenStore: concurrent scoped loads adopt the legacy blob only once', async () => {
  const { adapter, mem } = memoryAdapter();
  mem['cupthread_seen_changelogs_v1'] = JSON.stringify(['5.0.0']);
  const store = new UserTokenStore(adapter);

  const [appA, appB] = await Promise.all([
    store.hasSeenChangelog('5.0.0', 'app_a'),
    store.hasSeenChangelog('5.0.0', 'app_b'),
  ]);

  assert.equal(
    [appA, appB].filter(Boolean).length,
    1,
    'exactly one app may inherit the unattributable legacy entries'
  );
  assert.equal(mem['cupthread_seen_changelogs_v1'], undefined);
});

test('UserTokenStore: clearing a scope waits for an in-flight load before emptying the cache', async () => {
  const mem: Record<string, string> = {
    'cupthread_seen_changelogs_v1:app_a': JSON.stringify(['1.0.0']),
  };
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const adapter = {
    getItem: async (key: string) => {
      const value = mem[key] ?? null;
      if (key.includes(':app_a')) await gate;
      return value;
    },
    setItem: async (key: string, value: string) => {
      mem[key] = value;
    },
    removeItem: async (key: string) => {
      delete mem[key];
    },
  };
  const store = new UserTokenStore(adapter, { appKey: 'app_a' });

  const seenPromise = store.hasSeenChangelog('1.0.0');
  const clearPromise = store.clearSeenChangelogs();
  release();

  assert.equal(await seenPromise, true);
  await clearPromise;
  assert.equal(
    await store.hasSeenChangelog('1.0.0'),
    false,
    'the load that finished after the clear request must not repopulate the cache'
  );
});

test('UserTokenStore: blanks the legacy blob when removeItem fails after migration', async () => {
  const { adapter, mem } = memoryAdapter();
  const failingRemove = {
    ...adapter,
    removeItem: async (key: string) => {
      if (key === 'cupthread_seen_changelogs_v1') throw new Error('remove failed');
      delete mem[key];
    },
  };
  mem['cupthread_seen_changelogs_v1'] = JSON.stringify(['8.0.0']);

  const appA = new UserTokenStore(failingRemove, { appKey: 'app_a' });
  assert.equal(await appA.hasSeenChangelog('8.0.0'), true);

  assert.equal(
    mem['cupthread_seen_changelogs_v1'],
    '[]',
    'a failed remove must blank the legacy key so no other scope adopts it'
  );

  const appB = new UserTokenStore(adapter, { appKey: 'app_b' });
  assert.equal(await appB.hasSeenChangelog('8.0.0'), false);
});
