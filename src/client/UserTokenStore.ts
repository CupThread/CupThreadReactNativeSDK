import { generateUUID } from '../utils/formatters';

/**
 * Interface for pluggable key-value persistence adapters used by {@link UserTokenStore}.
 *
 * @remarks
 * Compatible with `AsyncStorage`, `expo-secure-store`, MMKV, `localStorage`, or in-memory dictionaries.
 *
 * @example
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
 * Storage key used to persist the anonymous user identifier in key-value storage.
 */
const STORAGE_KEY = 'cupthread_user_token_v1';

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
   * In-memory cache of seen changelog versions/IDs.
   */
  private seenChangelogsCache: Set<string> | null = null;

  /**
   * Storage key used to persist seen changelog versions.
   */
  private static readonly CHANGELOG_SEEN_KEY = 'cupthread_seen_changelogs_v1';

  /**
   * Creates a new `UserTokenStore` instance.
   *
   * @param storage - Optional custom storage adapter conforming to {@link TokenStorageAdapter}.
   *
   * @example
   * ```ts
   * const store = new UserTokenStore(customStorageAdapter);
   * ```
   */
  constructor(storage?: TokenStorageAdapter) {
    this.storage = storage || null;
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
   * Reconfigures the shared singleton with a custom storage adapter.
   *
   * @param storage - Storage adapter instance.
   * @returns The configured singleton `UserTokenStore`.
   *
   * @example
   * ```ts
   * UserTokenStore.configure({
   *   getItem: (key) => localStorage.getItem(key),
   *   setItem: (key, val) => localStorage.setItem(key, val),
   * });
   * ```
   */
  public static configure(storage: TokenStorageAdapter): UserTokenStore {
    this._shared = new UserTokenStore(storage);
    return this._shared;
  }

  /**
   * Initializes token loading during instance construction without overwriting asynchronous storage.
   */
  private initToken(): void {
    if (!this.storage) {
      if (!this.cachedToken) {
        this.cachedToken = generateUUID();
      }
      return;
    }

    try {
      const item = this.storage.getItem(STORAGE_KEY);
      // Check if adapter is asynchronous (returns a Promise)
      if (item && typeof (item as any).then === 'function') {
        this.isAsyncStorage = true;
        // DO NOT generate a UUID or call setItem here!
        // Doing so would overwrite the existing persistent token in storage.
        (item as Promise<string | null>)
          .then((resolved) => {
            if (resolved && typeof resolved === 'string' && resolved.trim().length > 0) {
              this.cachedToken = resolved.trim();
            }
          })
          .catch(() => {});
        return;
      }

      // Synchronous adapter
      if (typeof item === 'string' && item.trim().length > 0) {
        this.cachedToken = item.trim();
      } else {
        this.cachedToken = generateUUID();
        try {
          this.storage.setItem(STORAGE_KEY, this.cachedToken);
        } catch {
          // ignore
        }
      }
    } catch {
      // Fallback
    }
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
   * @example
   * ```ts
   * const userToken = UserTokenStore.shared.token;
   * ```
   */
  public get token(): string {
    if (!this.cachedToken) {
      const fresh = generateUUID();
      this.cachedToken = fresh;
      // Only write synchronously if storage is synchronous to prevent corrupting async adapters
      if (this.storage && !this.isAsyncStorage) {
        try {
          this.storage.setItem(STORAGE_KEY, fresh);
        } catch {}
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
   *
   * @returns A promise resolving to the user token string.
   *
   * @example
   * ```ts
   * const token = await UserTokenStore.shared.getToken();
   * ```
   */
  public async getToken(): Promise<string> {
    if (this.pendingGetToken) {
      return this.pendingGetToken;
    }

    this.pendingGetToken = (async () => {
      // 1. First, check persistent storage adapter if available
      if (this.storage) {
        try {
          const stored = await this.storage.getItem(STORAGE_KEY);
          if (stored && typeof stored === 'string' && stored.trim().length > 0) {
            this.cachedToken = stored.trim();
            return this.cachedToken;
          }
        } catch {
          // If storage lookup fails, fall through to fallback
        }
      }

      // 2. If storage is empty, check if we already have an in-memory token
      if (this.cachedToken) {
        if (this.storage) {
          try {
            await this.storage.setItem(STORAGE_KEY, this.cachedToken);
          } catch {
            // ignore
          }
        }
        return this.cachedToken;
      }

      // 3. Storage is truly empty: generate new UUID and persist it
      const newToken = generateUUID();
      this.cachedToken = newToken;
      if (this.storage) {
        try {
          await this.storage.setItem(STORAGE_KEY, newToken);
        } catch {
          // ignore
        }
      }
      return newToken;
    })().finally(() => {
      this.pendingGetToken = null;
    });

    return this.pendingGetToken;
  }

  /**
   * Overrides the current user token with an explicit identifier (e.g. from your auth service).
   *
   * @param token - Custom user identifier or token string.
   *
   * @example
   * ```ts
   * await UserTokenStore.shared.setToken(user.id);
   * ```
   */
  public async setToken(token: string): Promise<void> {
    this.cachedToken = token;
    if (this.storage) {
      try {
        await this.storage.setItem(STORAGE_KEY, token);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Resets the active user token and generates a brand new UUID in memory and storage.
   *
   * @returns The newly generated user token.
   *
   * @example
   * ```ts
   * const newToken = await UserTokenStore.shared.resetToken();
   * console.log(`New session token: ${newToken}`);
   * ```
   */
  public async resetToken(): Promise<string> {
    const newToken = generateUUID();
    this.cachedToken = newToken;
    if (this.storage) {
      try {
        await this.storage.setItem(STORAGE_KEY, newToken);
      } catch {
        // ignore
      }
    }
    return newToken;
  }

  /**
   * Checks whether a changelog release version or entry ID has already been marked as seen.
   *
   * @param versionOrId - Changelog version label (e.g. `'1.2.0'`) or entry ID.
   * @returns Promise resolving to `true` if seen, `false` otherwise.
   *
   * @example
   * ```ts
   * const hasSeen = await UserTokenStore.shared.hasSeenChangelog('1.2.0');
   * ```
   */
  public async hasSeenChangelog(versionOrId: string): Promise<boolean> {
    if (!versionOrId) return false;
    const seenSet = await this.getSeenChangelogs();
    return seenSet.has(versionOrId);
  }

  /**
   * Marks a changelog release version or entry ID as seen and persists it.
   *
   * @param versionOrId - Changelog version label (e.g. `'1.2.0'`) or entry ID.
   *
   * @example
   * ```ts
   * await UserTokenStore.shared.markChangelogSeen('1.2.0');
   * ```
   */
  public async markChangelogSeen(versionOrId: string): Promise<void> {
    if (!versionOrId) return;
    const seenSet = await this.getSeenChangelogs();
    if (seenSet.has(versionOrId)) return;

    seenSet.add(versionOrId);
    if (this.storage) {
      try {
        const payload = JSON.stringify(Array.from(seenSet));
        await this.storage.setItem(UserTokenStore.CHANGELOG_SEEN_KEY, payload);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Clears all recorded seen changelog entries from memory and storage.
   *
   * @example
   * ```ts
   * await UserTokenStore.shared.clearSeenChangelogs();
   * ```
   */
  public async clearSeenChangelogs(): Promise<void> {
    this.seenChangelogsCache = new Set<string>();
    if (this.storage) {
      try {
        if (this.storage.removeItem) {
          await this.storage.removeItem(UserTokenStore.CHANGELOG_SEEN_KEY);
        } else {
          await this.storage.setItem(UserTokenStore.CHANGELOG_SEEN_KEY, '[]');
        }
      } catch {
        // ignore
      }
    }
  }

  /**
   * Internal helper to load the set of seen changelog identifiers from storage or cache.
   */
  private async getSeenChangelogs(): Promise<Set<string>> {
    if (this.seenChangelogsCache) {
      return this.seenChangelogsCache;
    }

    let raw: string | null = null;
    if (this.storage) {
      try {
        raw = await this.storage.getItem(UserTokenStore.CHANGELOG_SEEN_KEY);
      } catch {
        // ignore
      }
    }

    const set = new Set<string>();
    if (raw && typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((item) => {
            if (typeof item === 'string') set.add(item);
          });
        }
      } catch {
        raw.split(',').forEach((s) => {
          const t = s.trim();
          if (t) set.add(t);
        });
      }
    }

    this.seenChangelogsCache = set;
    return set;
  }
}
