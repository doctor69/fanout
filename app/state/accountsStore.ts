import type { Account, Platform } from '@fanout/core-posting';
import { useCallback, useEffect, useState } from 'react';

import { secureStoreTokenStore } from '../services/secureStoreTokenStore';
import { connectYouTube } from '../services/oauth/youtube';

/**
 * Thin UI-facing wrapper over the TokenStore (specs/01-architecture.md).
 * Screens read connection state through here; they never touch secure storage
 * or a platform SDK directly.
 */

/**
 * v1 is single-device, single-user, so there is one owner. v2 resolves this
 * from an API key instead (specs/05-v2-monetization-api.md) — keeping the
 * parameter threaded through means nothing above this file has to change.
 */
export const DEVICE_OWNER_ID = 'device';

type ConnectFlow = () => Promise<Account | null>;

/** Filled in phase by phase as each platform's OAuth flow lands. */
const CONNECT_FLOWS: Partial<Record<Platform, ConnectFlow>> = {
  youtube: connectYouTube,
};

export function isConnectSupported(platform: Platform): boolean {
  return CONNECT_FLOWS[platform] !== undefined;
}

export async function loadAccounts(): Promise<Account[]> {
  return secureStoreTokenStore.getAccounts(DEVICE_OWNER_ID);
}

/** Returns false when the user backed out of the browser flow. */
export async function connectAccount(platform: Platform): Promise<boolean> {
  const flow = CONNECT_FLOWS[platform];
  if (!flow) throw new Error(`${platform} isn't connectable yet.`);

  const account = await flow();
  if (!account) return false;

  await secureStoreTokenStore.saveAccount(DEVICE_OWNER_ID, account);
  return true;
}

export async function disconnectAccount(platform: Platform): Promise<void> {
  await secureStoreTokenStore.removeAccount(DEVICE_OWNER_ID, platform);
}

export interface AccountsState {
  accounts: Account[];
  loading: boolean;
  /** Platform whose connect/disconnect is currently in flight, if any. */
  busy: Platform | null;
  error: string | null;
  connect: (platform: Platform) => Promise<void>;
  disconnect: (platform: Platform) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAccounts(): AccountsState {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Platform | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setAccounts(await loadAccounts());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = useCallback(
    async (platform: Platform, action: () => Promise<void>) => {
      setBusy(platform);
      setError(null);
      try {
        await action();
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const connect = useCallback(
    (platform: Platform) =>
      run(platform, async () => {
        await connectAccount(platform);
      }),
    [run],
  );

  const disconnect = useCallback(
    (platform: Platform) => run(platform, () => disconnectAccount(platform)),
    [run],
  );

  return { accounts, loading, busy, error, connect, disconnect, refresh };
}
