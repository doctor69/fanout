import type { Account, Platform, TokenStore } from '@fanout/core-posting';
import { PLATFORMS, isPlatform } from '@fanout/core-posting';
import * as SecureStore from 'expo-secure-store';

/**
 * TokenStore backed by expo-secure-store: one entry per platform, keyed
 * `account:<platform>` (specs/02-data-model.md). Tokens are encrypted at rest
 * by the OS keystore/keychain and are never logged.
 *
 * `ownerId` is part of the TokenStore interface because v2 stores accounts per
 * API key (specs/05). On-device there is exactly one owner — the device — so it
 * is accepted and ignored rather than baked into the key, which keeps the v1
 * keys exactly as specs/02 describes them.
 */

const KEY_PREFIX = 'account:';

function keyFor(platform: Platform): string {
  return `${KEY_PREFIX}${platform}`;
}

function parseAccount(raw: string, platform: Platform): Account | null {
  try {
    const parsed = JSON.parse(raw) as Partial<Account>;
    if (!isPlatform(parsed.platform) || parsed.platform !== platform) return null;
    if (typeof parsed.accessToken !== 'string' || parsed.accessToken.length === 0) return null;
    if (typeof parsed.externalUserId !== 'string') return null;
    return {
      ...parsed,
      platform,
      accessToken: parsed.accessToken,
      externalUserId: parsed.externalUserId,
      expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : 0,
    } as Account;
  } catch {
    // Corrupt or hand-edited entry — treat it as "not connected" rather than
    // crashing the Connections screen. Reconnecting overwrites it.
    return null;
  }
}

export class SecureStoreTokenStore implements TokenStore {
  async getAccounts(_ownerId: string): Promise<Account[]> {
    const entries = await Promise.all(
      PLATFORMS.map(async (platform) => {
        const raw = await SecureStore.getItemAsync(keyFor(platform));
        return raw ? parseAccount(raw, platform) : null;
      }),
    );
    // Preserves the fixed PLATFORMS order the Connections screen renders in.
    return entries.filter((account): account is Account => account !== null);
  }

  async getAccount(ownerId: string, platform: Platform): Promise<Account | null> {
    const accounts = await this.getAccounts(ownerId);
    return accounts.find((account) => account.platform === platform) ?? null;
  }

  async saveAccount(_ownerId: string, account: Account): Promise<void> {
    await SecureStore.setItemAsync(keyFor(account.platform), JSON.stringify(account));
  }

  async removeAccount(_ownerId: string, platform: Platform): Promise<void> {
    // Disconnecting deletes the entry outright — never just hides it (specs/03).
    await SecureStore.deleteItemAsync(keyFor(platform));
  }
}

export const secureStoreTokenStore = new SecureStoreTokenStore();
