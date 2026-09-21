import { UserTokenStore } from '../client/UserTokenStore';

/**
 * Resolves the identity a write request should be attributed to.
 *
 * The context token is the empty string while the persisted token is still
 * being recovered from async storage (`isTokenReady` is `false` during that
 * window). Forwarding that sentinel to the client silently drops the
 * `X-User-Token` header and records an unattributed write, so when the
 * context token is not yet available this awaits
 * `UserTokenStore.shared.getToken()` — a write landing at the tail of the
 * bootstrap window still carries the restored identity.
 *
 * @param contextToken - Token from `useCupThreadUserToken()` (or an explicit prop).
 * @returns The context token when present, otherwise the store's token.
 *
 * @example
 * ```ts
 * const effectiveToken = await resolveEffectiveUserToken(userToken);
 * await client.subscribeToChangelog(email, effectiveToken);
 * ```
 */
export async function resolveEffectiveUserToken(
  contextToken?: string | null
): Promise<string> {
  if (contextToken) {
    return contextToken;
  }
  return UserTokenStore.shared.getToken();
}
