import type { Account, Platform } from '@fanout/core-posting';
import { PLATFORM_LABELS } from '@fanout/core-posting';
import { useCallback, useEffect, useState } from 'react';

import { adapterFor } from '../services/adapters';
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

/** What a connect attempt is currently doing, for the row's busy state. */
export type ConnectPhase = 'connecting' | 'verifying' | 'disconnecting';

/**
 * Signs in, then proves the grant can actually post before storing anything.
 *
 * Signing in is not the same as being connected: a user can complete Google's
 * consent screen with the upload permission unticked and come back holding a
 * valid token that cannot post. So nothing is written to secure storage until
 * the adapter verifies the grant — which is what makes a stored account, and
 * therefore the Connections checkmark, mean "this account can post"
 * (specs/03-auth-and-oauth.md, specs/04-posting-flow.md).
 *
 * Returns false when the user backed out of the browser flow; throws with the
 * platform's own reason when verification fails.
 */
export async function connectAccount(
  platform: Platform,
  onPhase?: (phase: ConnectPhase) => void,
): Promise<boolean> {
  const flow = CONNECT_FLOWS[platform];
  if (!flow) throw new Error(`${platform} isn't connectable yet.`);

  onPhase?.('connecting');
  const account = await flow();
  if (!account) return false;

  onPhase?.('verifying');
  const verification = await adapterFor(platform).verifyConnection(account);
  if (!verification.verified) {
    throw new Error(
      verification.error ?? `Couldn't verify your ${PLATFORM_LABELS[platform]} connection.`,
    );
  }

  await secureStoreTokenStore.saveAccount(DEVICE_OWNER_ID, {
    ...account,
    verifiedAt: Date.now(),
  });
  return true;
}

/** True once the account's grant has been proven — what the checkmark reflects. */
export function isVerified(account: Account | undefined): account is Account {
  return account?.verifiedAt !== undefined;
}

export async function disconnectAccount(platform: Platform): Promise<void> {
  await secureStoreTokenStore.removeAccount(DEVICE_OWNER_ID, platform);
}

export interface AccountsState {
  accounts: Account[];
  loading: boolean;
  /** Platform whose connect/disconnect is in flight, and what it's doing. */
  busy: { platform: Platform; phase: ConnectPhase } | null;
  error: string | null;
  connect: (platform: Platform) => Promise<void>;
  disconnect: (platform: Platform) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAccounts(): AccountsState {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<{ platform: Platform; phase: ConnectPhase } | null>(null);
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
    async (platform: Platform, phase: ConnectPhase, action: () => Promise<void>) => {
      setBusy({ platform, phase });
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
      run(platform, 'connecting', async () => {
        await connectAccount(platform, (phase) => setBusy({ platform, phase }));
      }),
    [run],
  );

  const disconnect = useCallback(
    (platform: Platform) => run(platform, 'disconnecting', () => disconnectAccount(platform)),
    [run],
  );

  return { accounts, loading, busy, error, connect, disconnect, refresh };
}
