import type { Account } from '@fanout/core-posting';
import { X_SCOPES } from '@fanout/core-posting';
import type * as AuthSession from 'expo-auth-session';

import { requireXClientId } from '../../config';
import { runPkceFlow } from './pkce';

/**
 * X connect flow: OAuth 2.0 + PKCE against a public client, no secret and no
 * server hop (specs/03-auth-and-oauth.md). Endpoints confirmed against X's
 * current v2 API during Phase 3.
 */

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://x.com/i/oauth2/authorize',
  tokenEndpoint: 'https://api.x.com/2/oauth2/token',
  revocationEndpoint: 'https://api.x.com/2/oauth2/revoke',
};

const ME_ENDPOINT = 'https://api.x.com/2/users/me?user.fields=profile_image_url';

interface XUser {
  data?: { id?: string; name?: string; username?: string; profile_image_url?: string };
}

async function fetchProfile(accessToken: string): Promise<XUser['data']> {
  try {
    const response = await fetch(ME_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return undefined;
    return ((await response.json()) as XUser).data;
  } catch {
    // Display metadata only — never fail a connection over it.
    return undefined;
  }
}

export async function connectX(): Promise<Account | null> {
  const clientId = requireXClientId();

  // X's docs show code_challenge_method=s256, but its authorize endpoint takes
  // the RFC 7636 spelling that expo-auth-session sends (S256), which is what
  // every working client in the wild uses.
  const flow = await runPkceFlow({
    clientId,
    discovery,
    scopes: [...X_SCOPES],
    redirectPath: 'oauth/x',
  });
  if (!flow) return null;

  const { token, grantedScopes } = flow;
  const profile = await fetchProfile(token.accessToken);

  return {
    platform: 'x',
    accessToken: token.accessToken,
    ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
    expiresAt: (token.issuedAt + (token.expiresIn ?? 7200)) * 1000,
    externalUserId: profile?.id ?? 'unknown',
    ...(profile?.username ? { displayName: `@${profile.username}` } : {}),
    ...(profile?.profile_image_url ? { avatarUrl: profile.profile_image_url } : {}),
    // X has no token-introspection endpoint, so the adapter checks posting
    // permission against what the token response reported here.
    ...(grantedScopes ? { grantedScopes } : {}),
    connectedAt: Date.now(),
  };
}
