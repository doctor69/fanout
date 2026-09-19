import type { Account } from '@fanout/core-posting';
import { LINKEDIN_SCOPES } from '@fanout/core-posting';
import type * as AuthSession from 'expo-auth-session';

import { requireLinkedInClientId } from '../../config';
import { runAuthorizationRequest } from './pkce';
import { exchangeCodeOnServer } from './tokenExchange';

/**
 * LinkedIn connect flow. The authorization code is exchanged on
 * /functions/token-exchange because LinkedIn requires the client secret
 * (specs/03-auth-and-oauth.md).
 */

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://www.linkedin.com/oauth/v2/authorization',
};

const USERINFO = 'https://api.linkedin.com/v2/userinfo';

interface UserInfo {
  sub?: string;
  name?: string;
  picture?: string;
}

async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const response = await fetch(USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    // Unlike the other platforms this one isn't optional: the member id is
    // what a post is authored as.
    throw new Error(`LinkedIn did not return your profile (HTTP ${response.status}).`);
  }
  return (await response.json()) as UserInfo;
}

export async function connectLinkedIn(): Promise<Account | null> {
  const clientId = requireLinkedInClientId();

  const authorization = await runAuthorizationRequest({
    clientId,
    discovery,
    scopes: [...LINKEDIN_SCOPES],
    redirectPath: 'oauth/linkedin',
    // LinkedIn exchanges the code with the client secret on the function.
    usePKCE: false,
  });
  if (!authorization) return null;

  const token = await exchangeCodeOnServer({
    platform: 'linkedin',
    code: authorization.code,
    redirectUri: authorization.redirectUri,
  });

  const profile = await fetchUserInfo(token.accessToken);
  if (!profile.sub) {
    throw new Error('LinkedIn did not return a member id.');
  }

  return {
    platform: 'linkedin',
    accessToken: token.accessToken,
    ...(token.refreshToken ? { refreshToken: token.refreshToken } : {}),
    expiresAt: token.expiresAt,
    externalUserId: profile.sub,
    ...(profile.name ? { displayName: profile.name } : {}),
    ...(profile.picture ? { avatarUrl: profile.picture } : {}),
    ...(token.grantedScopes ? { grantedScopes: token.grantedScopes } : {}),
    connectedAt: Date.now(),
  };
}
