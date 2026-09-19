import type { Account } from '@fanout/core-posting';
import * as AuthSession from 'expo-auth-session';

import { requireGoogleClientId } from '../../config';

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
  'https://www.googleapis.com/auth/youtube.upload',
  // OpenID scopes only, so the Connections row can show who is connected
  // without asking for any broader YouTube read access.
  'openid',
  'profile',
];

const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';

export function youtubeRedirectUri(): string {
  return AuthSession.makeRedirectUri({ scheme: 'fanout', path: 'oauth/youtube' });
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
  const redirectUri = youtubeRedirectUri();

  const request = new AuthSession.AuthRequest({
    clientId,
    redirectUri,
    scopes: SCOPES,
    usePKCE: true,
    extraParams: {
      // Both are required for Google to issue a refresh token to a native app;
      // without them the connection would silently die after an hour.
      access_type: 'offline',
      prompt: 'consent',
    },
  });

  const result = await request.promptAsync(discovery);

  if (result.type === 'cancel' || result.type === 'dismiss') return null;
  if (result.type === 'error') {
    throw new Error(result.params.error_description ?? result.error?.message ?? 'YouTube sign-in failed.');
  }
  if (result.type !== 'success' || !result.params.code) {
    throw new Error('YouTube sign-in did not return an authorization code.');
  }

  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId,
      code: result.params.code,
      redirectUri,
      extraParams: request.codeVerifier ? { code_verifier: request.codeVerifier } : {},
    },
    discovery,
  );

  const profile = await fetchUserInfo(token.accessToken);

  return {
    platform: 'youtube',
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: (token.issuedAt + (token.expiresIn ?? 3600)) * 1000,
    externalUserId: profile.sub ?? 'unknown',
    displayName: profile.name,
    avatarUrl: profile.picture,
    connectedAt: Date.now(),
  };
}
