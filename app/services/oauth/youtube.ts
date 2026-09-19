import type { Account } from '@fanout/core-posting';
import { YOUTUBE_UPLOAD_SCOPE } from '@fanout/core-posting';
import type * as AuthSession from 'expo-auth-session';

import { requireGoogleClientId } from '../../config';
import { redirectUriFor, runPkceFlow } from './pkce';

/**
 * YouTube connect flow: OAuth 2.0 + PKCE against an installed-app client, in
 * the system browser via expo-auth-session. No client secret, no server hop
 * (specs/03-auth-and-oauth.md).
 */

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
};

const SCOPES = [
  YOUTUBE_UPLOAD_SCOPE,
  // OpenID scopes only, so the Connections row can show who is connected
  // without asking for any broader YouTube read access.
  'openid',
  'profile',
];

const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export function youtubeRedirectUri(): string {
  return redirectUriFor('oauth/youtube');
}

interface UserInfo {
  sub?: string;
  name?: string;
  picture?: string;
}

async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  try {
    const response = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return {};
    return (await response.json()) as UserInfo;
  } catch {
    // Display metadata only — a failure here must not fail the connection.
    return {};
  }
}

/**
 * Runs the browser flow and returns an Account ready to hand to the TokenStore.
 * Resolves `null` if the user dismissed or cancelled the browser.
 */
export async function connectYouTube(): Promise<Account | null> {
  const clientId = requireGoogleClientId();

  const flow = await runPkceFlow({
    clientId,
    discovery,
    scopes: SCOPES,
    redirectPath: 'oauth/youtube',
    extraParams: {
      // Both are required for Google to issue a refresh token to a native app;
      // without them the connection would silently die after an hour.
      access_type: 'offline',
      prompt: 'consent',
    },
  });
  if (!flow) return null;

  const { token, grantedScopes } = flow;
  const profile = await fetchUserInfo(token.accessToken);

  return {
    platform: 'youtube',
    accessToken: token.accessToken,
    ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
    expiresAt: (token.issuedAt + (token.expiresIn ?? 3600)) * 1000,
    externalUserId: profile.sub ?? 'unknown',
    ...(profile.name ? { displayName: profile.name } : {}),
    ...(profile.picture ? { avatarUrl: profile.picture } : {}),
    ...(grantedScopes ? { grantedScopes } : {}),
    connectedAt: Date.now(),
  };
}
