import { ReconnectRequiredError } from './errors';
import { PLATFORM_LABELS } from './platforms';
import type {
  Account,
  Platform,
  PlatformAdapter,
  PostContent,
  PostResult,
  TokenStore,
} from './types';

export interface FanOutOptions {
  /**
   * Called once per platform as it resolves, so the composer can update each
   * chip the moment that platform finishes instead of waiting for the slowest
   * one (specs/04-posting-flow.md). The same results come back in the array.
   */
  onResult?: (result: PostResult) => void;
}

/** Turns anything an adapter threw into a result the UI can show. */
function toFailure(platform: Platform, reason: unknown): PostResult {
  if (reason instanceof ReconnectRequiredError) {
    // specs/04: a dead grant gets "Reconnect <platform>", not a generic retry.
    return { platform, status: 'failure', error: reason.message, needsReconnect: true };
  }
  const message = reason instanceof Error ? reason.message : String(reason);
  return {
    platform,
    status: 'failure',
    error: message || `Posting to ${PLATFORM_LABELS[platform]} failed.`,
  };
}

/**
 * The single entry point the v1 composer calls, and the one v2's POST /v2/posts
 * will call (specs/01-architecture.md, specs/05-v2-monetization-api.md).
 *
 * Every platform is attempted independently: one failing must never block,
 * delay, or roll back the others, which is why this is allSettled and why a
 * refreshed token is written back per platform as it refreshes.
 */
export async function fanOutPost(
  ownerId: string,
  content: PostContent,
  targetPlatforms: Platform[],
  tokenStore: TokenStore,
  adapters: Partial<Record<Platform, PlatformAdapter>>,
  options: FanOutOptions = {},
): Promise<PostResult[]> {
  const accounts = await tokenStore.getAccounts(ownerId);
  const targets = accounts.filter((account) => targetPlatforms.includes(account.platform));

  const attempts = targets.map(async (account: Account): Promise<PostResult> => {
    const adapter = adapters[account.platform];
    if (!adapter) {
      throw new Error(`No adapter registered for ${PLATFORM_LABELS[account.platform]}.`);
    }

    const fresh = await adapter.refreshTokenIfNeeded(account);
    // Reference inequality is the adapter's signal that the token changed.
    if (fresh !== account) await tokenStore.saveAccount(ownerId, fresh);

    return adapter.publish(fresh, content);
  });

  if (options.onResult) {
    const report = options.onResult;
    attempts.forEach((attempt, index) => {
      const platform = targets[index]?.platform;
      attempt.then(
        (result) => report(result),
        (reason: unknown) => {
          if (platform) report(toFailure(platform, reason));
        },
      );
    });
  }

  const settled = await Promise.allSettled(attempts);

  return settled.map((outcome, index) => {
    if (outcome.status === 'fulfilled') return outcome.value;
    // targets[index] always exists — settled is built from attempts, 1:1 with targets.
    const platform = targets[index]?.platform ?? targetPlatforms[index];
    return toFailure(platform as Platform, outcome.reason);
  });
}
