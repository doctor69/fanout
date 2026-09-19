import type { Account, ServerTokenSet } from '@fanout/core-posting';

import { requireTokenExchangeUrl } from '../../config';

/**
 * Client for /functions/token-exchange — the one server hop v1 has
 * (specs/03-auth-and-oauth.md).
 *
 * TikTok, Instagram, Facebook and LinkedIn all require a client secret to turn
 * a code into a token, and that secret must never be in the app bundle. So the
 * app sends the code out and gets tokens back; the secret stays on the Worker.
 * Everything after this — the actual posting — happens straight from the app.
 */

export type ExchangePlatform = 'tiktok' | 'instagram' | 'facebook' | 'linkedin';

interface ExchangeResponse extends ServerTokenSet {
  externalUserId?: string;
}

async function call(path: string, body: Record<string, unknown>): Promise<ExchangeResponse> {
  const base = requireTokenExchangeUrl().replace(/\/$/, '');

  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const result = (await response.json().catch(() => ({}))) as ExchangeResponse & { error?: string };

  if (!response.ok) {
    throw new Error(result.error ?? `Token exchange failed (HTTP ${response.status}).`);
  }
  if (!result.accessToken) {
    throw new Error('Token exchange returned no access token.');
  }
  return result;
}

export function exchangeCodeOnServer(params: {
  platform: ExchangePlatform;
  code: string;
  codeVerifier?: string;
  redirectUri: string;
}): Promise<ExchangeResponse> {
  return call('/token-exchange', params);
}

/** Passed to the adapters that can't refresh on-device. */
export function refreshOnServer(platform: ExchangePlatform) {
  return async (account: Account): Promise<ServerTokenSet> =>
    call('/token-refresh', {
      platform,
      // Meta issues no refresh token: it re-exchanges the current access token.
      refreshToken: account.refreshToken ?? account.accessToken,
    });
}
