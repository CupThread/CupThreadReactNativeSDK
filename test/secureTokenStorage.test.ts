import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserTokenStore, TokenStorageAdapter } from '../src/client/UserTokenStore';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Mock shape simulating expo-secure-store API.
 */
interface MockExpoSecureStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

function createMockSecureStore(initialStorage: Record<string, string> = {}) {
  const storage: Record<string, string> = { ...initialStorage };
  const calls: { op: 'get' | 'set' | 'delete'; key: string; value?: string }[] = [];

  const store: MockExpoSecureStore = {
    async getItemAsync(key: string): Promise<string | null> {
      calls.push({ op: 'get', key });
      return storage[key] ?? null;
    },
    async setItemAsync(key: string, value: string): Promise<void> {
      calls.push({ op: 'set', key, value });
      storage[key] = value;
    },
    async deleteItemAsync(key: string): Promise<void> {
      calls.push({ op: 'delete', key });
      delete storage[key];
    },
  };

  return { store, storage, calls };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const STORAGE_KEY = 'cupthread_user_token_v1';

test('documented expo-secure-store adapter compiles and satisfies TokenStorageAdapter', () => {
  const { store } = createMockSecureStore();

  // Exact shape documented in README and JSDoc:
  const adapter: TokenStorageAdapter = {
    getItem: (key) => store.getItemAsync(key),
    setItem: (key, value) => store.setItemAsync(key, value),
    removeItem: (key) => store.deleteItemAsync(key),
  };

  assert.equal(typeof adapter.getItem, 'function');
  assert.equal(typeof adapter.setItem, 'function');
  assert.equal(typeof adapter.removeItem, 'function');
});

test('UserTokenStore with SecureStore adapter persists initial anonymous token to encrypted storage', async () => {
  const { store, storage, calls } = createMockSecureStore();

  const adapter: TokenStorageAdapter = {
    getItem: (key) => store.getItemAsync(key),
    setItem: (key, value) => store.setItemAsync(key, value),
    removeItem: (key) => store.deleteItemAsync(key),
  };

  const userTokenStore = new UserTokenStore(adapter);
  const token = await userTokenStore.getToken();

  assert.ok(token);
  assert.match(token, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(storage[STORAGE_KEY], token);

  const getCalls = calls.filter((c) => c.op === 'get' && c.key === STORAGE_KEY);
  const setCalls = calls.filter((c) => c.op === 'set' && c.key === STORAGE_KEY);
  assert.ok(getCalls.length >= 1, 'getItemAsync should have been called');
  assert.ok(setCalls.length >= 1, 'setItemAsync should have persisted generated token');
  assert.equal(setCalls[0].value, token);
});

test('UserTokenStore with SecureStore adapter recovers existing persisted token without overwrite', async () => {
  const EXISTING_SECURE_TOKEN = 'secure-persisted-user-uuid-999';
  const { store, storage } = createMockSecureStore({
    [STORAGE_KEY]: EXISTING_SECURE_TOKEN,
  });

  const adapter: TokenStorageAdapter = {
    getItem: (key) => store.getItemAsync(key),
    setItem: (key, value) => store.setItemAsync(key, value),
    removeItem: (key) => store.deleteItemAsync(key),
  };

  const userTokenStore = new UserTokenStore(adapter);
  const resolvedToken = await userTokenStore.getToken();

  assert.equal(resolvedToken, EXISTING_SECURE_TOKEN);
  assert.equal(storage[STORAGE_KEY], EXISTING_SECURE_TOKEN);
});

test('UserTokenStore with SecureStore adapter persists authenticated user ID on setToken', async () => {
  const { store, storage, calls } = createMockSecureStore();

  const adapter: TokenStorageAdapter = {
    getItem: (key) => store.getItemAsync(key),
    setItem: (key, value) => store.setItemAsync(key, value),
    removeItem: (key) => store.deleteItemAsync(key),
  };

  const userTokenStore = new UserTokenStore(adapter);
  await userTokenStore.getToken();

  const AUTH_USER_ID = 'auth0|usr_live_8f3d12';
  await userTokenStore.setToken(AUTH_USER_ID);

  assert.equal(userTokenStore.token, AUTH_USER_ID);
  assert.equal(await userTokenStore.getToken(), AUTH_USER_ID);
  assert.equal(storage[STORAGE_KEY], AUTH_USER_ID);

  const lastSet = calls.filter((c) => c.op === 'set' && c.key === STORAGE_KEY).pop();
  assert.ok(lastSet, 'setItemAsync must be called for setToken');
  assert.equal(lastSet?.value, AUTH_USER_ID);
});

test('UserTokenStore with SecureStore adapter regenerates and persists fresh UUID on resetToken', async () => {
  const { store, storage } = createMockSecureStore();

  const adapter: TokenStorageAdapter = {
    getItem: (key) => store.getItemAsync(key),
    setItem: (key, value) => store.setItemAsync(key, value),
    removeItem: (key) => store.deleteItemAsync(key),
  };

  const userTokenStore = new UserTokenStore(adapter);
  await userTokenStore.setToken('auth-user-pre-logout');
  assert.equal(storage[STORAGE_KEY], 'auth-user-pre-logout');

  const newToken = await userTokenStore.resetToken();
  assert.ok(newToken);
  assert.notEqual(newToken, 'auth-user-pre-logout');
  assert.match(newToken, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(storage[STORAGE_KEY], newToken);
});

test('UserTokenStore with SecureStore adapter deduplicates concurrent getToken requests', async () => {
  const initialGate = deferred<string | null>();
  let getCallCount = 0;

  const adapter: TokenStorageAdapter = {
    getItem: async () => {
      getCallCount++;
      return initialGate.promise;
    },
    setItem: async () => {},
  };

  const userTokenStore = new UserTokenStore(adapter);
  // Constructor calls getItem once for async detection
  assert.equal(getCallCount, 1, 'Constructor probes storage for async detection');

  const p1 = userTokenStore.getToken();
  const p2 = userTokenStore.getToken();
  const p3 = userTokenStore.getToken();

  // The first getToken initiates a single read; subsequent concurrent calls piggyback on pendingGetToken
  assert.equal(
    getCallCount,
    2,
    'getToken initiates at most one storage read for all concurrent callers'
  );

  initialGate.resolve('deduped-secure-token-abc');

  const [t1, t2, t3] = await Promise.all([p1, p2, p3]);
  assert.equal(t1, 'deduped-secure-token-abc');
  assert.equal(t2, 'deduped-secure-token-abc');
  assert.equal(t3, 'deduped-secure-token-abc');
  assert.equal(getCallCount, 2, 'No additional getItem calls were made');
});

test('UserTokenStore with SecureStore adapter preserves explicit setToken over late initial storage read', async () => {
  const initialGate = deferred<string | null>();

  const adapter: TokenStorageAdapter = {
    getItem: async () => initialGate.promise,
    setItem: async () => {},
  };

  const userTokenStore = new UserTokenStore(adapter);

  // Authenticate user before initial read finishes:
  const loginPromise = userTokenStore.setToken('logged-in-user-priority');

  // Now resolve initial storage read with an older persisted value:
  initialGate.resolve('stale-persisted-anonymous-token');
  await loginPromise;

  const activeToken = await userTokenStore.getToken();
  assert.equal(activeToken, 'logged-in-user-priority');
});

test('README documents storage security guidance and ready-to-paste SecureStore adapter', () => {
  const readmePath = path.resolve(__dirname, '../README.md');
  const readmeContent = fs.readFileSync(readmePath, 'utf8');

  // Persistence section:
  assert.match(readmeContent, /Storage Security & Encrypted Adapters/i);
  assert.match(readmeContent, /bearer credential/i);
  assert.match(readmeContent, /expo-secure-store/);
  assert.match(readmeContent, /react-native-keychain/);
  assert.match(readmeContent, /encrypted MMKV/);
  assert.match(readmeContent, /SecureStore\.getItemAsync/);
  assert.match(readmeContent, /SecureStore\.setItemAsync/);
  assert.match(readmeContent, /SecureStore\.deleteItemAsync/);

  // Identity switching section:
  assert.match(readmeContent, /credential-storage decision/i);
  assert.match(readmeContent, /setToken\(user\.id\)/);
});

test('UserTokenStore source JSDoc contains security remarks on TokenStorageAdapter', () => {
  const sourcePath = path.resolve(__dirname, '../src/client/UserTokenStore.ts');
  const sourceContent = fs.readFileSync(sourcePath, 'utf8');

  assert.match(sourceContent, /Storage security/i);
  assert.match(sourceContent, /bearer identity token/i);
  assert.match(sourceContent, /encrypted-at-rest/i);
  assert.match(sourceContent, /expo-secure-store/);
  assert.match(sourceContent, /react-native-keychain/);
});
