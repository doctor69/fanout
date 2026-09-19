import type { Account } from '@fanout/core-posting';
import { TIKTOK_SCOPES } from '@fanout/core-posting';
import type * as AuthSession from 'expo-auth-session';

import { requireTikTokClientKey } from '../../config';
import { runAuthorizationRequest } from './pkce';
import { exchangeCodeOnServer } from './tokenExchange';

/**
 * TikTok connect flow.
 *
 * Login Kit does use PKCE for native apps, but — unlike YouTube and X —
 * TikTok still requires the client secret on the token exchange, so the code
 * goes to /functions/token-exchange rather than being exchanged on-device.
 * This was the open question flagged in specs/03-auth-and-oauth.md; the answer
 * is that TikTok needs the server hop.
 */

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://www.tiktok.com/v2/auth/authorize/',
};

const USER_INFO = 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url';

interface TikTokUser {
  data?: { user?: { open_id?: string; display_name?: string; avatar_url?: string } };
}

async function fetchProfile(accessToken: string): Promise<TikTokUser['data']> {
  try {
    const response = await fetch(USER_INFO, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return undefined;
    return ((await response.json()) as TikTokUser).data;
  } catch {
    // Display metadata only — never fail a connection over it.
    return undefined;
  }
}

export async function connectTikTok(): Promise<Account | null> {
  const clientKey = requireTikTokClientKey();

  const authorization = await runAuthorizationRequest({
    // TikTok names the public identifier client_key, so send it under both
    // names: expo-auth-session always writes client_id, and TikTok reads
    // client_key.
    clientId: clientKey,
    discovery,
    scopes: [...TIKTOK_SCOPES],
    redirectPath: 'oauth/tiktok',
    extraParams: { client_key: clientKey },
  });
  if (!authorization) return null;

  const token = await exchangeCodeOnServer({
    platform: 'tiktok',
    code: authorization.code,
    ...(authorization.codeVerifier ? { codeVerifier: authorization.codeVerifier } : {}),
    redirectUri: authorization.redirectUri,
  });

  const profile = await fetchProfile(token.accessToken);

  return {
    platform: 'tiktok',
    accessToken: token.accessToken,
    ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
    expiresAt: token.expiresAt,
    externalUserId: token.externalUserId ?? profile?.user?.open_id ?? 'unknown',
    ...(profile?.user?.display_name ? { displayName: profile.user.display_name } : {}),
    ...(profile?.user?.avatar_url ? { avatarUrl: profile.user.avatar_url } : {}),
    ...(token.grantedScopes ? { grantedScopes: token.grantedScopes } : {}),
    connectedAt: Date.now(),
  };
}
