import { generateUUID } from '../utils/formatters';

/**
 * Interface for pluggable key-value persistence adapters used by {@link UserTokenStore}.
 *
 * @remarks
 * Compatible with `AsyncStorage`, `expo-secure-store`, MMKV, `localStorage`, or in-memory dictionaries.
 *
 * **Storage security**: The configured adapter persists the bearer identity token used to attribute
 * all SDK actions (votes, comments, feedback, user attributes). Plaintext adapters like `AsyncStorage`
 * are suitable for local development or anonymous-only identifiers, but production applications—particularly
 * those calling {@link UserTokenStore.setToken} with real user IDs—should configure an encrypted-at-rest
 * adapter (such as `expo-secure-store` in Expo or `react-native-keychain` / encrypted MMKV in bare React Native)
 * to prevent token exposure via device backups or rooted device storage.
 *
 * @example
 * Plaintext adapter (development / anonymous-only):
 * ```ts
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import { TokenStorageAdapter, UserTokenStore } from '@cupthread/react-native';
 *
 * const adapter: TokenStorageAdapter = {
 *   getItem: (key) => AsyncStorage.getItem(key),
 *   setItem: (key, val) => AsyncStorage.setItem(key, val),
 *   removeItem: (key) => AsyncStorage.removeItem(key),
 * };
 *
 * UserTokenStore.configure(adapter);
 * ```
 *
 * @example
 * Encrypted adapter using `expo-secure-store` (recommended for production & authenticated users):
 * ```ts
 * import * as SecureStore from 'expo-secure-store';
 * import { TokenStorageAdapter, UserTokenStore } from '@cupthread/react-native';
 *
 * const secureAdapter: TokenStorageAdapter = {
 *   getItem: (key) => SecureStore.getItemAsync(key),
 *   setItem: (key, value) => SecureStore.setItemAsync(key, value),
 *   removeItem: (key) => SecureStore.deleteItemAsync(key),
 * };
 *
 * UserTokenStore.configure(secureAdapter);
 * ```
 */
export interface TokenStorageAdapter {
  /**
   * Retrieves the stored string value for the given storage key.
   *
   * @param key - The unique storage identifier.
   * @returns Stored string value, `null` if not found, or a Promise resolving to it.
   */
  getItem(key: string): string | null | Promise<string | null>;

  /**
   * Persists a key-value pair into storage.
   *
   * @param key - The unique storage identifier.
   * @param value - The string payload to persist.
   */
  setItem(key: string, value: string): void | Promise<void>;

  /**
   * Optional cleanup handler to remove an entry from storage.
   *
   * @param key - The unique storage identifier to delete.
   */
  removeItem?(key: string): void | Promise<void>;
}

/**
 * Configuration options for {@link UserTokenStore}.
 */
export interface UserTokenStoreOptions {
  /**
   * Application key used to scope per-app persistent state such as seen changelog
   * versions. Without it, seen state falls back to the legacy unscoped key unless
   * an `appKey` is passed to {@link UserTokenStore.hasSeenChangelog},
   * {@link UserTokenStore.markChangelogSeen}, or
   * {@link UserTokenStore.clearSeenChangelogs}.
   */
  appKey?: string;
}

/**
 * Whether diagnostics should reach the console in development mode.
 * Checks `__DEV__` global first, falling back to `process.env.NODE_ENV !== 'production'`.
 * Falls back safely to false when neither `__DEV__` nor `process.env` is available (e.g. browser ESM, workers).
 */
function isDevMode(): boolean {
  try {
    if (typeof (globalThis as any).__DEV__ !== 'undefined') {
      return Boolean((globalThis as any).__DEV__);
    }
  } catch {
    // ignore
  }
  try {
    if (typeof process !== 'undefined' && Boolean(process.env)) {
      return process.env.NODE_ENV !== 'production';
    }
  } catch {
    // ignore
  }
  return false;
}

/**
 * Storage key used to persist the anonymous user identifier in key-value storage.
 */
const STORAGE_KEY = 'cupthread_user_token_v1';
/** One serialized write chain per adapter instance. */
const persistenceWriteLocks = new WeakMap<TokenStorageAdapter, Promise<void>>();

/** One serialized seen-changelog load chain per adapter instance. */
const seenChangelogLoadLocks = new WeakMap<TokenStorageAdapter, Promise<unknown>>();

/**
 * Serializes seen-changelog loads per adapter so a stalled load on a retired
 * adapter cannot block lookups against a newly configured one.
 */

/**
 * Manages device-level persistent anonymous user tokens for CupThread SDK interactions.
 *
 * @remarks
 * Anonymous tokens allow users to submit feedback, upvote roadmap features, and participate
 * in discussions without requiring an upfront sign-in. The token is generated as an RFC 4122 v4 UUID
 * and can be stored across app restarts using custom storage adapters (e.g. AsyncStorage / SecureStore).
 *
 * @example
 * ```ts
 * import { UserTokenStore } from '@cupthread/react-native';
 *
 * // 1. Synchronous access to cached token
 * const token = UserTokenStore.shared.token;
 *
 * // 2. Async retrieval with persistence lookup
 * const persistentToken = await UserTokenStore.shared.getToken();
 *
 * // 3. Reset token (e.g. on user logout)
 * const freshToken = await UserTokenStore.shared.resetToken();
 * ```
 */
export class UserTokenStore {
  /**
   * Shared singleton instance for the process.
   */
  private static _shared: UserTokenStore | null = null;

  /**
   * In-memory cached token string.
   */
  private cachedToken: string | null = null;

  /**
   * Custom pluggable storage adapter.
   */
  private storage: TokenStorageAdapter | null = null;

  /**
   * Whether the configured storage adapter returns promises (async).
   */
  private isAsyncStorage: boolean = false;

  /**
   * In-flight token resolution promise to deduplicate concurrent calls.
   */
  private pendingGetToken: Promise<string> | null = null;
  /**
   * Epoch of the currently configured storage adapter. {@link UserTokenStore.configure}
   * bumps it so reads that were already in flight against the previous adapter
   * cannot adopt an identity or mark state on the new one.
   */
  private storageEpoch: number = 0;

  /**
   * Storage epoch that {@link UserTokenStore.pendingGetToken} was started for.
   */
  private pendingGetTokenEpoch: number = -1;
  /**
   * Epoch of token writes issued through {@link UserTokenStore.persistToken}.
   * Explicit identity switches bump it so a slow provisional persist started by
   * {@link UserTokenStore.configure} cannot revert storage after
   * {@link UserTokenStore.setToken}.
   */
  private persistenceEpoch: number = 0;

  /**
   * Whether an explicit identity was installed via {@link UserTokenStore.setToken}
   * or {@link UserTokenStore.resetToken}. Once set, the constructor's initial
   * storage read must never overwrite the cached token when it resolves late,
   * and {@link UserTokenStore.getToken} must never adopt a stale persisted
   * value over it — including a re-read whose storage lookup was already in
   * flight when the explicit identity was installed.
   */
  private identityLocked: boolean = false;

  /**
   * Whether the most recent storage read failed, leaving the persisted token
   * unknown. While set, the store never writes over storage it could not
   * verify: a token minted in this window is provisional, and a later read
   * either adopts the persisted identity or persists the provisional one once
   * storage is verified empty.
   */
  private storageReadUnverified: boolean = false;

  /**
   * Subscribers notified whenever the active identity changes (setToken /
   * resetToken / getToken adoption). Lets reactive consumers such as
   * `<CupThreadProvider>` follow explicit login/logout identity switches.
   */
  private listeners: Set<() => void> = new Set();

  /**
   * Application key used to scope per-app persistent state such as seen changelog versions.
   */
  private appKey: string | null = null;

  /**
   * In-memory cache of seen changelog versions/IDs, keyed by the resolved storage key.
   */
  private seenChangelogsCache: Map<string, Set<string>> = new Map();

  /**
   * Seen changelog entries captured from a previous configuration so a late
   * `configure()` reconciles them with whatever the new adapter already holds
   * rather than discarding them.
   */
  private staleSeenChangelogCache: Map<string, Set<string>> = new Map();

  /**
   * In-flight seen changelog loads, keyed by storage key, so concurrent reads and
   * legacy migration resolve only once.
   */
  private pendingSeenChangelogLoads: Map<string, Promise<Set<string>>> = new Map();
  /**
   * Storage key that older SDK versions used to persist seen changelog versions
   * without an app scope.
   */
  private static readonly LEGACY_CHANGELOG_SEEN_KEY = 'cupthread_seen_changelogs_v1';

  /**
   * Maximum number of seen changelog versions/IDs retained per app scope.
   * Oldest entries are evicted first so storage cannot grow without bound.
   */
  public static readonly MAX_SEEN_CHANGELOGS = 50;

  /**
   * Tracks whether a warning about unpersisted changelog seen-status has already been logged.
   */
  private hasWarnedTransientSeen = false;

  /**
   * Indicates whether this store instance is backed by a persistent storage adapter.
   *
   * @remarks
   * When `false`, user tokens and changelog seen sets exist in memory only
   * and will not survive application restarts. Call {@link UserTokenStore.configure}
   * or provide a custom {@link TokenStorageAdapter} to the constructor to enable
   * durable cross-session persistence.
   */
  public get isPersistent(): boolean {
    return this.storage !== null;
  }

  /**
   * Emits a one-time console warning in development mode if the store is not backed
   * by a persistent storage adapter when changelog seen-status is inspected or marked.
   */
  public warnUnpersistedChangelogSeen(): void {
    if (this.storage !== null || this.hasWarnedTransientSeen) {
      return;
    }
    if (isDevMode()) {
      this.hasWarnedTransientSeen = true;
      console.warn(
        '[CupThread] Changelog seen-status will not survive app restarts because no persistent storage adapter is configured. ' +
          'Call UserTokenStore.configure(adapter) with an AsyncStorage adapter (or pass a persistent tokenStore) to prevent the changelog overlay from appearing on every launch.'
      );
    }
  }

  /**
   * Resets the dev warning flag for test environments.
   */
  public resetWarningForTests(): void {
    this.hasWarnedTransientSeen = false;
  }

  /**
   * Whether diagnostics should reach the console in development mode.
   *
   * @internal
   */
  public static isDevMode(): boolean {
    return isDevMode();
  }

  /**
   * Resets the shared singleton instance for test isolation.
   */
  public static resetSharedForTests(): void {
    this._shared = null;
  }

  /**
   * Creates a new `UserTokenStore` instance.
   *
   * @param storage - Optional custom storage adapter conforming to {@link TokenStorageAdapter}.
   * @param options - Optional configuration, including the `appKey` that scopes per-app state.
   *
   * @example
   * ```ts
   * const store = new UserTokenStore(customStorageAdapter, { appKey: 'app_live_abc123' });
   * ```
   */
  constructor(storage?: TokenStorageAdapter, options?: UserTokenStoreOptions) {
    this.storage = storage || null;
    this.appKey = normalizeAppKey(options?.appKey);
    this.initToken();
  }

  /**
   * Returns the shared singleton instance of `UserTokenStore`.
   *
   * @example
   * ```ts
   * const token = UserTokenStore.shared.token;
   * ```
   */
  public static get shared(): UserTokenStore {
    if (!this._shared) {
      this._shared = new UserTokenStore();
    }
    return this._shared;
  }

  /**
   * Reconfigures the shared singleton in place with a custom storage adapter.
   *
   * @remarks
   * The shared instance is preserved, so subscribers registered before the call
   * keep receiving identity changes and an in-memory identity is never orphaned.
   * The new adapter is read immediately: a persisted token is adopted (and
   * subscribers are notified when it differs) unless an explicit identity was
   * installed via {@link UserTokenStore.setToken} or
   * {@link UserTokenStore.resetToken}, which stays authoritative and is
   * persisted through the new adapter. A provisional in-memory token is not
   * rotated when the adapter is empty; it is persisted once the read verifies
   * that storage is empty. A failed read leaves it provisional and never
   * overwrites the unknown persisted value.
   *
   * @param storage - Storage adapter instance.
   * @param options - Optional configuration, including the `appKey` that scopes per-app state.
   * @returns The configured singleton `UserTokenStore`.
   *
   * @example
   * ```ts
   * UserTokenStore.configure(
   *   {
   *     getItem: (key) => localStorage.getItem(key),
   *     setItem: (key, val) => localStorage.setItem(key, val),
   *   },
   *   { appKey: 'app_live_abc123' }
   * );
   * ```
   */
  public static configure(
    storage: TokenStorageAdapter,
    options?: UserTokenStoreOptions
  ): UserTokenStore {
    if (!this._shared) {
      // First configuration: build directly on the adapter so an existing
      // persisted token is restored without minting a provisional UUID first.
      this._shared = new UserTokenStore(storage, options);
      return this._shared;
    }
    this._shared.applyStorageConfiguration(storage, options);
    return this._shared;
  }

  /**
   * Adopts a new adapter on this instance while preserving identity continuity:
   * the cached token, explicit-identity lock, subscribers, and changelog seen
   * caches all stay on the same object.
   */
  private applyStorageConfiguration(
    storage: TokenStorageAdapter,
    options?: UserTokenStoreOptions
  ): void {
    this.storage = storage || null;
    this.appKey = normalizeAppKey(options?.appKey);
    // Reads and failures from the previous adapter must not leak into this one.
    this.storageEpoch += 1;
    this.isAsyncStorage = false;
    this.storageReadUnverified = false;
    // Merge any previous in-memory seen sets into the stale overlay (preserving
    // entries across repeated configure() calls before a scope is read again)
    // and clear the active cache so the next lookup reads the new adapter.
    for (const [key, entries] of this.seenChangelogsCache) {
      const prior = this.staleSeenChangelogCache.get(key) ?? new Set<string>();
      for (const entry of entries) prior.add(entry);
      this.staleSeenChangelogCache.set(key, prior);
    }
    this.seenChangelogsCache.clear();
    this.pendingSeenChangelogLoads.clear();
    this.initToken(true);
    if (this.identityLocked && this.cachedToken) {
      // The new adapter must learn an explicit identity even when the initial
      // read rejects or hangs; the read path is not the only persistence gate.
      this.persistToken(this.cachedToken, this.persistenceEpoch);
    }
  }

  /**
   * Sets the application key used to scope changelog seen state when a call does
   * not pass its own `appKey`. Pass `null` to fall back to the legacy unscoped key.
   *
   * @param appKey - The application key, or `null` to unscope.
   */
  public setAppKey(appKey?: string | null): void {
    this.appKey = normalizeAppKey(appKey);
  }

  /**
   * Returns the application key this store scopes changelog seen state by, or
   * `null` when calls fall back to the legacy unscoped key.
   */
  public getAppKey(): string | null {
    return this.appKey;
  }

  /**
   * Computes the storage key used for seen changelog status within an app scope.
   *
   * @param appKey - Application key. When omitted or blank, returns the legacy
   * unscoped key.
   *
   * @example
   * ```ts
   * UserTokenStore.getSeenStorageKey('app_live_abc123');
   * // 'cupthread_seen_changelogs_v1:app_live_abc123'
   * ```
   */
  public static getSeenStorageKey(appKey?: string | null): string {
    const normalized = normalizeAppKey(appKey);
    return normalized
      ? `${UserTokenStore.LEGACY_CHANGELOG_SEEN_KEY}:${normalized}`
      : UserTokenStore.LEGACY_CHANGELOG_SEEN_KEY;
  }

  /**
   * Resolves the storage key for a call: a per-call `appKey` wins over the
   * configured one, and `undefined` means "use the configured appKey".
   */
  private resolveSeenStorageKey(appKey?: string | null): string {
    return UserTokenStore.getSeenStorageKey(appKey === undefined ? this.appKey : appKey);
  }

  /**
   * Initializes token loading from the configured adapter without overwriting
   * an in-memory identity that storage has not verified yet.
   *
   * @param reconfigured - `true` when an already-used instance adopted a new
   * adapter through {@link UserTokenStore.configure}. The existing in-memory
   * token is then preserved (and persisted once the new adapter is verified
   * empty) instead of being replaced by the constructor's initial-read policy.
   */
  private initToken(reconfigured = false): void {
    if (!this.storage) {
      if (!this.cachedToken) {
        this.cachedToken = generateUUID();
      }
      return;
    }

    const epoch = this.storageEpoch;
    let item: string | null | Promise<string | null>;
    try {
      item = this.storage.getItem(STORAGE_KEY);
    } catch {
      // A failed read is not verification that storage is empty: keep any
      // in-memory token provisional and never write over the unknown value.
      // The next `getToken()` read retries and adopts the persisted token.
      this.storageReadUnverified = true;
      return;
    }

    // Check if adapter is asynchronous (returns a Promise). Do not mint or
    // write in that window: storage may already hold the real identity.
    if (typeof item === 'object' && item !== null) {
      this.isAsyncStorage = true;
      item
        .then((resolved) => {
          // A newer configuration owns the adapter now: this read cannot
          // describe the storage the store is actually using.
          if (epoch !== this.storageEpoch) return;
          this.applyStorageRead(resolved, reconfigured);
        })
        .catch(() => {
          if (epoch !== this.storageEpoch) return;
          this.storageReadUnverified = true;
        });
      return;
    }

    this.applyStorageRead(typeof item === 'string' ? item : null, reconfigured);
  }

  /**
   * Applies one successful storage read.
   *
   * @remarks
   * An explicit identity always wins. Otherwise a persisted token is adopted
   * (and subscribers are notified when the identity changes). When the read
   * verified that storage is empty, an existing in-memory token is preserved:
   * on reconfiguration it is persisted as-is, and on a synchronous first read
   * a new identity is minted only when no token exists yet. An asynchronous
   * first read leaves minting to {@link UserTokenStore.getToken}, matching the
   * existing bootstrap contract.
   */
  private applyStorageRead(resolved: string | null, reconfigured: boolean): void {
    if (this.identityLocked) {
      // setToken()/resetToken() is authoritative; make it durable in the
      // adapter that is now configured instead of adopting the stored value.
      if (reconfigured && this.cachedToken) {
        this.persistToken(this.cachedToken);
      }
      return;
    }

    const storedToken = typeof resolved === 'string' ? resolved.trim() : '';
    if (storedToken) {
      const changed = this.cachedToken !== storedToken;
      this.cachedToken = storedToken;
      if (changed) {
        this.emitChange();
      }
      return;
    }

    if (this.cachedToken) {
      // Verified empty: keep the in-memory identity so reconfiguration cannot
      // silently rotate a provisional token, and persist it now that writing
      // cannot overwrite a persisted identity.
      if (reconfigured) {
        this.persistToken(this.cachedToken);
      }
      return;
    }

    if (!this.isAsyncStorage) {
      this.cachedToken = generateUUID();
      // Constructor-time sync adapters must persist immediately: otherwise two
      // stores constructed back-to-back over the same adapter both observe an
      // empty cache and mint different identities.
      if (reconfigured) {
        this.persistToken(this.cachedToken);
      } else {
        const storage = this.storage;
        try {
          storage?.setItem(STORAGE_KEY, this.cachedToken);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Queues a token write behind any in-flight persistence for this store.
   *
   * @remarks
   * The adapter and storage epoch are captured at enqueue time so a job
   * scheduled before {@link UserTokenStore.configure} cannot write into the new
   * adapter. At execution time the job re-checks both the persistence epoch and
   * the cached token so an explicit {@link UserTokenStore.setToken} cannot be
   * reverted by a stale provisional write.
   */
  private enqueuePersistedToken(
    token: string,
    persistenceEpoch: number,
    storageEpoch: number,
    storage: TokenStorageAdapter
  ): Promise<void> {
    return this.runWithPersistenceLock(storage, async () => {
      if (this.storageEpoch !== storageEpoch) return;
      if (this.persistenceEpoch !== persistenceEpoch || this.cachedToken !== token) return;
      try {
        await Promise.resolve(storage.setItem(STORAGE_KEY, token));
      } catch {
        // ignore
      }
      if (this.storageEpoch !== storageEpoch) return;
      const latest = this.cachedToken;
      if (!latest || latest === token) return;
      // A newer explicit identity queued its own write; do not fight it here.
      if (this.persistenceEpoch !== persistenceEpoch) return;
      try {
        await Promise.resolve(storage.setItem(STORAGE_KEY, latest));
      } catch {
        // ignore
      }
    });
  }

  /**
   * Serializes persistence work for the active identity token.
   */
  private runWithPersistenceLock<T>(
    storage: TokenStorageAdapter,
    task: () => Promise<T>
  ): Promise<T> {
    const tail = persistenceWriteLocks.get(storage) ?? Promise.resolve();
    const run = tail.then(task, task);
    persistenceWriteLocks.set(
      storage,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  }

  /**
   * Enqueues a best-effort token write through the serialized persistence lock.
   */
  private persistToken(token: string, persistenceEpoch: number = this.persistenceEpoch): void {
    const storage = this.storage;
    if (!storage) return;
    const storageEpoch = this.storageEpoch;
    void this.enqueuePersistedToken(token, persistenceEpoch, storageEpoch, storage);
  }

  /**
   * Synchronously returns the currently cached user token.
   * If not already initialized, generates and caches a new in-memory UUID.
   *
   * @remarks
   * **Warning — async storage adapters:** with AsyncStorage / SecureStore the
   * persisted token loads asynchronously, and accessing `.token` before that
   * load finishes mints and caches a *throwaway* in-memory UUID that is never
   * persisted and will be replaced once storage resolves. Any request sent in
   * that window is attributed to the throwaway identity. With async adapters
   * always `await` {@link UserTokenStore.getToken} instead (the SDK's
   * `<CupThreadProvider>` does this for you and exposes readiness through
   * `useCupThreadTokenReadiness()`). The synchronous contract is only safe for
   * synchronous adapters or no-adapter setups.
   *
   * Explicit identities installed during the async load window via
   * {@link UserTokenStore.setToken} or {@link UserTokenStore.resetToken} are
   * authoritative and are never reverted by any storage re-read (the initial
   * load or a later {@link UserTokenStore.getToken}).
   *
   * A failed storage read during construction leaves the persisted token
   * unknown: `.token` mints a provisional in-memory UUID and does not write it,
   * and the next {@link UserTokenStore.getToken} read retries and adopts the
   * stored identity instead of overwriting it.
   *
   * @example
   * ```ts
   * const userToken = UserTokenStore.shared.token;
   * ```
   */
  public get token(): string {
    if (!this.cachedToken) {
      const fresh = generateUUID();
      this.cachedToken = fresh;
      // Only write synchronously if storage is synchronous and its contents
      // were verified to be empty — never over an unreadable persisted token.
      if (this.storage && !this.isAsyncStorage && !this.storageReadUnverified) {
        this.persistToken(fresh);
      }
    }
    return this.cachedToken;
  }

  /**
   * Asynchronously retrieves the user token, prioritizing recovery of existing tokens from storage.
   *
   * @remarks
   * If storage already contains a token, it is restored into memory and returned.
   * A new UUID is generated and persisted only when storage is verified to be empty.
   * A storage read that rejects is never treated as verification that storage
   * is empty: no token is written in that window, and the next `getToken()`
   * retries the read and adopts the persisted identity once it resolves.
   *
   * Explicit identities installed via {@link UserTokenStore.setToken} or
   * {@link UserTokenStore.resetToken} are authoritative: `getToken()` never
   * re-read storage past one, and a storage read that was already in flight
   * when the explicit identity was installed cannot revert it either. This
   * also holds when the explicit identity's own persistence write failed
   * (storage keeps an older token while the cache holds the explicit one).
   *
   * @returns A promise resolving to the user token string.
   *
   * @example
   * ```ts
   * const token = await UserTokenStore.shared.getToken();
   * ```
   */
  public async getToken(): Promise<string> {
    const epoch = this.storageEpoch;
    if (this.pendingGetToken && this.pendingGetTokenEpoch === epoch) {
      return this.pendingGetToken;
    }

    const pending = (async () => {
      // An identity installed via setToken()/resetToken() is authoritative:
      // never re-read storage past it. Checked up-front for calls made after
      // the explicit identity exists, and re-checked once more after the
      // storage read below resolves, so a setToken()/resetToken() landing
      // while that read was in flight cannot be reverted by the stale value.
      if (this.identityLocked && this.cachedToken) {
        return this.cachedToken;
      }
      // 1. First, check persistent storage adapter if available
      let storageVerified = false;
      if (this.storage) {
        try {
          const stored = await this.storage.getItem(STORAGE_KEY);
          if (epoch !== this.storageEpoch) {
            // configure() replaced the adapter while this read was in flight:
            // the value describes storage this store no longer uses, so it
            // must neither be adopted nor treated as verification.
            return this.resolveInMemoryToken();
          }
          storageVerified = true;
          this.storageReadUnverified = false;
          if (this.identityLocked && this.cachedToken) {
            return this.cachedToken;
          }
          if (stored && typeof stored === 'string' && stored.trim().length > 0) {
            const storedToken = stored.trim();
            const changed = this.cachedToken !== storedToken;
            this.cachedToken = storedToken;
            if (changed) {
              this.emitChange();
            }
            return this.cachedToken;
          }
        } catch {
          // The read failed, so the persisted token is unknown: fall through
          // with `storageVerified` false and never write over that value. A
          // failure from the previous adapter is irrelevant to the new one.
          if (epoch === this.storageEpoch) {
            this.storageReadUnverified = true;
          }
        }
      }

      // 2. If storage is empty, check if we already have an in-memory token.
      // Persist it only when the read verified storage is empty; on a failed
      // read the cached token stays provisional so the next call can retry the
      // read and adopt the stored identity.
      if (this.cachedToken) {
        if (this.storage && storageVerified) {
          const storage = this.storage;
          await this.enqueuePersistedToken(this.cachedToken, this.persistenceEpoch, epoch, storage);
        }
        return this.cachedToken;
      }

      // 3. No cached token: mint one. Persist it only when the read verified
      // storage is empty; otherwise it is in-memory only.
      const newToken = generateUUID();
      this.cachedToken = newToken;
      if (this.storage && storageVerified) {
        const storage = this.storage;
        await this.enqueuePersistedToken(newToken, this.persistenceEpoch, epoch, storage);
      }
      this.emitChange();
      return newToken;
    })().finally(() => {
      if (this.pendingGetToken === pending) {
        this.pendingGetToken = null;
        this.pendingGetTokenEpoch = -1;
      }
    });

    this.pendingGetToken = pending;
    this.pendingGetTokenEpoch = epoch;
    return pending;
  }

  /**
   * Returns the in-memory identity, minting and notifying only when none exists.
   * Used when a storage read cannot be trusted because the configured adapter
   * changed while it was in flight, so it neither adopts nor persists it.
   */
  private resolveInMemoryToken(): string {
    if (this.cachedToken) return this.cachedToken;
    const newToken = generateUUID();
    this.cachedToken = newToken;
    this.emitChange();
    return newToken;
  }

  /**
   * Overrides the current user token with an explicit identifier (e.g. from your auth service).
   *
   * @param token - Custom user identifier or token string.
   *
   * @remarks
   * The explicit token is authoritative: neither the constructor's initial
   * storage read nor any later {@link UserTokenStore.getToken} re-read (async
   * adapters) can overwrite the cache or revert the identity — including
   * reads that were already in flight when `setToken()` was called, and
   * including after a failed persistence write (storage may keep an older
   * token; the in-memory identity still wins).
   *
   * Rejects empty, whitespace-only, or non-string inputs with a {@link TypeError}
   * to prevent locking the store to an empty identity, causing cache desynchronization
   * and unconstrained UUID regeneration.
   *
   * @example
   * ```ts
   * await UserTokenStore.shared.setToken(user.id);
   * ```
   */
  public async setToken(token: string): Promise<void> {
    const trimmed = typeof token === 'string' ? token.trim() : '';
    if (!trimmed) {
      throw new TypeError('Expected a non-empty string for token');
    }
    const previous = this.cachedToken;
    this.persistenceEpoch += 1;
    const persistenceEpoch = this.persistenceEpoch;
    this.identityLocked = true;
    this.cachedToken = trimmed;
    if (this.storage) {
      const storage = this.storage;
      const storageEpoch = this.storageEpoch;
      try {
        await this.enqueuePersistedToken(trimmed, persistenceEpoch, storageEpoch, storage);
      } catch {
        // ignore
      }
    }
    // Notify only after storage has settled so a re-resolving subscriber reads
    // the new value, and only on an actual identity change.
    if (previous !== trimmed) {
      this.emitChange();
    }
  }

  /**
   * Resets the active user token and generates a brand new UUID in memory and storage.
   *
   * @returns The newly generated user token.
   *
   * @remarks
   * Like {@link UserTokenStore.setToken}, the reset is authoritative: neither
   * an in-flight initial storage read nor a later {@link UserTokenStore.getToken}
   * re-read (async adapters) can overwrite the cache or revert the identity.
   *
   * @example
   * ```ts
   * const newToken = await UserTokenStore.shared.resetToken();
   * console.log(`New session token: ${newToken}`);
   * ```
   */
  public async resetToken(): Promise<string> {
    const previous = this.cachedToken;
    const newToken = generateUUID();
    this.persistenceEpoch += 1;
    const persistenceEpoch = this.persistenceEpoch;
    this.identityLocked = true;
    this.cachedToken = newToken;
    if (this.storage) {
      const storage = this.storage;
      const storageEpoch = this.storageEpoch;
      try {
        await this.enqueuePersistedToken(newToken, persistenceEpoch, storageEpoch, storage);
      } catch {
        // ignore
      }
    }
    // Notify only after storage has settled so a re-resolving subscriber reads
    // the new value.
    if (previous !== newToken) {
      this.emitChange();
    }
    return newToken;
  }

  /**
   * Subscribes a listener that is notified whenever the active identity changes.
   *
   * @remarks
   * Listeners fire after {@link UserTokenStore.setToken}, {@link UserTokenStore.resetToken},
   * or an identity-changing {@link UserTokenStore.getToken} resolution completes
   * (memory and storage both settled). Reactive consumers such as
   * `<CupThreadProvider>` use this to follow documented login/logout flows.
   *
   * @param listener - Callback invoked with no arguments on identity changes.
   * @returns An unsubscribe function; safe to call multiple times.
   *
   * @example
   * ```ts
   * const unsubscribe = UserTokenStore.shared.subscribe(() => {
   *   console.log('identity changed:', UserTokenStore.shared.token);
   * });
   * unsubscribe();
   * ```
   */
  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Notifies all subscribers of an identity change. Listener errors are
   * swallowed so token resolution can never be broken by a subscriber.
   */
  private emitChange(): void {
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // ignore
      }
    });
  }

  /**
   * Checks whether a changelog release version or entry ID has already been marked as seen.
   *
   * @param versionOrId - Changelog version label (e.g. `'1.2.0'`) or entry ID.
   * @param appKey - Application key to scope the lookup. Defaults to the configured
   * `appKey`, or the legacy unscoped set when neither is set.
   * @returns Promise resolving to `true` if seen, `false` otherwise.
   *
   * @example
   * ```ts
   * const hasSeen = await UserTokenStore.shared.hasSeenChangelog('1.2.0', 'app_live_abc123');
   * ```
   */
  public async hasSeenChangelog(versionOrId: string, appKey?: string | null): Promise<boolean> {
    const trimmed = typeof versionOrId === 'string' ? versionOrId.trim() : '';
    if (!trimmed) return false;
    const seenSet = await this.getSeenChangelogs(appKey);
    return seenSet.has(trimmed);
  }

  /**
   * Marks a changelog release version or entry ID as seen and persists it.
   *
   * @remarks
   * Each app scope keeps at most {@link UserTokenStore.MAX_SEEN_CHANGELOGS}
   * entries; the oldest ones are evicted first.
   *
   * @param versionOrId - Changelog version label (e.g. `'1.2.0'`) or entry ID.
   * @param appKey - Application key to scope the write. Defaults to the configured
   * `appKey`, or the legacy unscoped set when neither is set.
   *
   * @example
   * ```ts
   * await UserTokenStore.shared.markChangelogSeen('1.2.0', 'app_live_abc123');
   * ```
   */
  public async markChangelogSeen(versionOrId: string, appKey?: string | null): Promise<void> {
    const trimmed = typeof versionOrId === 'string' ? versionOrId.trim() : '';
    if (!trimmed) return;
    if (!this.isPersistent) {
      this.warnUnpersistedChangelogSeen();
    }
    const seenSet = await this.getSeenChangelogs(appKey);
    if (seenSet.has(trimmed)) return;

    seenSet.add(trimmed);
    this.trimSeenChangelogs(seenSet);
    await this.persistSeenChangelogs(this.resolveSeenStorageKey(appKey), seenSet);
  }

  /**
   * Clears the recorded seen changelog entries for one app scope from memory and storage.
   *
   * @param appKey - Application key whose seen set is cleared. Defaults to the
   * configured `appKey`, or the legacy unscoped set when neither is set.
   *
   * @example
   * ```ts
   * await UserTokenStore.shared.clearSeenChangelogs('app_live_abc123');
   * ```
   */
  public async clearSeenChangelogs(appKey?: string | null): Promise<void> {
    const storageKey = this.resolveSeenStorageKey(appKey);

    // A load that is already running would otherwise repopulate the cache after
    // this clear. Wait for it, then clear; a failed load still clears.
    const pending = this.pendingSeenChangelogLoads.get(storageKey);
    if (pending) {
      try {
        await pending;
      } catch {
        // ignore
      }
    }

    this.staleSeenChangelogCache.delete(storageKey);
    this.seenChangelogsCache.set(storageKey, new Set<string>());
    if (this.storage) {
      try {
        if (this.storage.removeItem) {
          await this.storage.removeItem(storageKey);
        } else {
          await this.storage.setItem(storageKey, '[]');
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * Internal helper to load the set of seen changelog identifiers for an app scope.
   */
  private async getSeenChangelogs(appKey?: string | null): Promise<Set<string>> {
    const storageKey = this.resolveSeenStorageKey(appKey);
    const cached = this.seenChangelogsCache.get(storageKey);
    if (cached) {
      return cached;
    }

    const pending = this.pendingSeenChangelogLoads.get(storageKey);
    if (pending) {
      return pending;
    }

    const loadEpoch = this.storageEpoch;
    const adapter = this.storage;
    const load = this.runWithSeenChangelogLock(adapter, () =>
      this.loadSeenChangelogs(adapter, storageKey)
    ).then(async (set) => {
      // configure() may have swapped adapters while this load ran: only the
      // configuration that started it may reconcile and publish its result.
      if (this.storageEpoch !== loadEpoch) {
        return set;
      }
      const carry = this.staleSeenChangelogCache.get(storageKey);
      if (carry && carry.size > 0) {
        let mergedNew = false;
        for (const entry of carry) {
          if (!set.has(entry)) {
            set.add(entry);
            mergedNew = true;
          }
        }
        this.trimSeenChangelogs(set);
        if (mergedNew) {
          await this.persistSeenChangelogs(storageKey, set);
        }
        if (this.storageEpoch !== loadEpoch) {
          // Another configure() happened while reconciling; keep the carried
          // entries in staleSeenChangelogCache so the new configuration
          // still merges them on its next lookup.
          return set;
        }
        this.staleSeenChangelogCache.delete(storageKey);
      }
      if (this.storageEpoch === loadEpoch) {
        this.seenChangelogsCache.set(storageKey, set);
      }
      return set;
    });
    this.pendingSeenChangelogLoads.set(storageKey, load);
    try {
      return await load;
    } finally {
      // Only the configuration that created this entry may delete it; a newer
      // pending load for the same key must survive this load's completion.
      if (
        this.storageEpoch === loadEpoch &&
        this.pendingSeenChangelogLoads.get(storageKey) === load
      ) {
        this.pendingSeenChangelogLoads.delete(storageKey);
      }
    }
  }

  /**
   * Queues one seen-set load behind the previously queued one. Every load can
   * touch the shared legacy key, so they run one at a time.
   */
  private runWithSeenChangelogLock<T>(
    adapter: TokenStorageAdapter | null,
    task: () => Promise<T>
  ): Promise<T> {
    if (!adapter) return task();
    const tail = seenChangelogLoadLocks.get(adapter) ?? Promise.resolve();
    const run = tail.then(task, task);
    seenChangelogLoadLocks.set(
      adapter,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  }

  /**
   * Reads a seen set from storage, adopting the legacy unscoped blob the first
   * time a scoped set is read on an installation that predates app scoping.
   */
  private async loadSeenChangelogs(
    adapter: TokenStorageAdapter | null,
    storageKey: string
  ): Promise<Set<string>> {
    if (!adapter) {
      return new Set<string>();
    }
    let raw = await this.readStorageFrom(adapter, storageKey);
    let migratedFromLegacy = false;

    if (raw === null && storageKey !== UserTokenStore.LEGACY_CHANGELOG_SEEN_KEY) {
      const legacyRaw = await this.readStorageFrom(
        adapter,
        UserTokenStore.LEGACY_CHANGELOG_SEEN_KEY
      );
      if (legacyRaw !== null) {
        raw = legacyRaw;
        migratedFromLegacy = true;
      }
    }

    const set = parseSeenChangelogs(raw);
    const shouldRewrite = set.size > UserTokenStore.MAX_SEEN_CHANGELOGS;
    this.trimSeenChangelogs(set);

    const persisted =
      migratedFromLegacy || shouldRewrite
        ? await this.persistSeenChangelogsTo(adapter, storageKey, set)
        : false;

    if (migratedFromLegacy && persisted) {
      // Entries cannot be attributed to an app after the fact, so the first app
      // that reads adopts them and the legacy blob is dropped to prevent bleed.
      // Keep the blob when the scoped write failed, so the data is not lost.
      try {
        if (adapter.removeItem) {
          await adapter.removeItem(UserTokenStore.LEGACY_CHANGELOG_SEEN_KEY);
        } else {
          await adapter.setItem(UserTokenStore.LEGACY_CHANGELOG_SEEN_KEY, '[]');
        }
      } catch {
        // Blank the legacy key when removal fails, so another scope cannot adopt it.
        try {
          await adapter.setItem(UserTokenStore.LEGACY_CHANGELOG_SEEN_KEY, '[]');
        } catch {
          // ignore
        }
      }
    }

    return set;
  }

  /**
   * Reads one stored string from a specific adapter, treating adapter failures
   * and non-string payloads as absent.
   */
  private async readStorageFrom(adapter: TokenStorageAdapter, key: string): Promise<string | null> {
    try {
      const value = await adapter.getItem(key);
      return typeof value === 'string' ? value : null;
    } catch {
      return null;
    }
  }

  /**
   * Persists a seen set to a specific adapter, reporting whether the write landed.
   */
  private async persistSeenChangelogsTo(
    adapter: TokenStorageAdapter,
    storageKey: string,
    seenSet: Set<string>
  ): Promise<boolean> {
    try {
      await adapter.setItem(storageKey, JSON.stringify(Array.from(seenSet)));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads one stored string, treating adapter failures and non-string payloads as absent.
   */
  private async readStorage(key: string): Promise<string | null> {
    if (!this.storage) {
      return null;
    }
    return this.readStorageFrom(this.storage, key);
  }

  /**
   * Persists a seen set, reporting whether the write landed.
   */
  private async persistSeenChangelogs(storageKey: string, seenSet: Set<string>): Promise<boolean> {
    if (!this.storage) {
      return false;
    }
    return this.persistSeenChangelogsTo(this.storage, storageKey, seenSet);
  }

  /**
   * Evicts the oldest entries until the set fits {@link UserTokenStore.MAX_SEEN_CHANGELOGS}.
   */
  private trimSeenChangelogs(seenSet: Set<string>): void {
    while (seenSet.size > UserTokenStore.MAX_SEEN_CHANGELOGS) {
      const oldest = seenSet.values().next().value;
      if (oldest === undefined) return;
      seenSet.delete(oldest);
    }
  }
}

/**
 * Normalizes a caller-supplied app key, treating blank strings and non-string
 * values as unscoped.
 */
function normalizeAppKey(appKey?: string | null): string | null {
  if (typeof appKey !== 'string') {
    return null;
  }
  const trimmed = appKey.trim();
  return trimmed ? trimmed : null;
}

/**
 * Parses a persisted seen set, accepting the JSON array format and the older
 * comma-separated format.
 */
function parseSeenChangelogs(raw: string | null): Set<string> {
  const set = new Set<string>();
  if (!raw) {
    return set;
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      parsed.forEach((item) => {
        if (typeof item === 'string') {
          const trimmed = item.trim();
          if (trimmed) set.add(trimmed);
        }
      });
    }
  } catch {
    raw.split(',').forEach((entry) => {
      const trimmed = entry.trim();
      if (trimmed) set.add(trimmed);
    });
  }

  return set;
}
