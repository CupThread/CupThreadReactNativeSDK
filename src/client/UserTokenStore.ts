import { generateUUID } from '../utils/formatters.ts';

export interface TokenStorageAdapter {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}

const STORAGE_KEY = 'cupthread_user_token_v1';

export class UserTokenStore {
  private static _shared: UserTokenStore | null = null;
  private cachedToken: string | null = null;
  private storage: TokenStorageAdapter | null = null;

  constructor(storage?: TokenStorageAdapter) {
    this.storage = storage || null;
    this.initToken();
  }

  public static get shared(): UserTokenStore {
    if (!this._shared) {
      this._shared = new UserTokenStore();
    }
    return this._shared;
  }

  public static configure(storage: TokenStorageAdapter): UserTokenStore {
    this._shared = new UserTokenStore(storage);
    return this._shared;
  }

  private initToken(): void {
    if (this.storage) {
      try {
        const item = this.storage.getItem(STORAGE_KEY);
        if (typeof item === 'string' && item.length > 0) {
          this.cachedToken = item;
          return;
        }
      } catch {
        // Fall back to memory token
      }
    }
    if (!this.cachedToken) {
      this.cachedToken = generateUUID();
      if (this.storage) {
        try {
          this.storage.setItem(STORAGE_KEY, this.cachedToken);
        } catch {
          // ignore storage error
        }
      }
    }
  }

  public get token(): string {
    if (!this.cachedToken) {
      this.initToken();
    }
    return this.cachedToken!;
  }

  public async getToken(): Promise<string> {
    if (this.cachedToken) {
      return this.cachedToken;
    }
    if (this.storage) {
      try {
        const stored = await this.storage.getItem(STORAGE_KEY);
        if (stored) {
          this.cachedToken = stored;
          return stored;
        }
      } catch {
        // Fall back to new token
      }
    }
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
}
