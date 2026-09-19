import type { Account, MetaPlatform } from '@fanout/core-posting';
import { FACEBOOK_SCOPES, INSTAGRAM_SCOPES, META_GRAPH_VERSION } from '@fanout/core-posting';
import type * as AuthSession from 'expo-auth-session';

import { requireMetaAppId } from '../../config';
import { runAuthorizationRequest } from './pkce';
import { exchangeCodeOnServer } from './tokenExchange';

/**
 * Facebook and Instagram connect flow. One Meta app, one login, two platforms.
 *
 * The code is exchanged on /functions/token-exchange because Meta requires the
 * app secret (specs/03-auth-and-oauth.md). The function also trades the
 * short-lived token for a long-lived one; what's stored here is that long-lived
 * user token plus the Page access token that actually posts.
 */

const discovery: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
};

const ACCOUNTS_ENDPOINT =
  `https://graph.facebook.com/${META_GRAPH_VERSION}/me/accounts` +
  '?fields=id,name,access_token,instagram_business_account{id,username,profile_picture_url}';

interface Page {
  id?: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id?: string; username?: string; profile_picture_url?: string };
}

async function listPages(userToken: string): Promise<Page[]> {
  const response = await fetch(ACCOUNTS_ENDPOINT, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const body = (await response.json()) as { data?: Page[]; error?: { message?: string } };

  if (!response.ok || body.error) {
    throw new Error(body.error?.message ?? `Meta returned HTTP ${response.status}.`);
  }
  return body.data ?? [];
}

export async function connectMeta(platform: MetaPlatform): Promise<Account | null> {
  const appId = requireMetaAppId();
  const label = platform === 'facebook' ? 'Facebook' : 'Instagram';

  const authorization = await runAuthorizationRequest({
    clientId: appId,
    discovery,
    scopes: [...(platform === 'facebook' ? FACEBOOK_SCOPES : INSTAGRAM_SCOPES)],
    redirectPath: `oauth/${platform}`,
    // Meta exchanges the code with the app secret on the function.
    usePKCE: false,
  });
  if (!authorization) return null;

  const token = await exchangeCodeOnServer({
    platform,
    code: authorization.code,
    redirectUri: authorization.redirectUri,
  });

  const pages = await listPages(token.accessToken);

  // v1 takes the first eligible Page. Someone managing several would need a
  // picker, which isn't in the specs — worth raising before it bites.
  const page =
    platform === 'facebook'
      ? pages.find((candidate) => candidate.access_token)
      : pages.find((candidate) => candidate.instagram_business_account?.id);

  if (!page?.access_token) {
    throw new Error(
      platform === 'facebook'
        ? 'No Facebook Page found on this account. Fanout posts to a Page, not a personal profile.'
        : 'No Instagram Business or Creator account is linked to a Facebook Page on this login.',
    );
  }

  const instagram = page.instagram_business_account;
  const externalUserId = platform === 'facebook' ? page.id : instagram?.id;
  if (!externalUserId) {
    throw new Error(`${label} did not return an account id.`);
  }

  const displayName = platform === 'facebook' ? page.name : instagram?.username;
  const avatarUrl = platform === 'instagram' ? instagram?.profile_picture_url : undefined;

  return {
    platform,
    // The Page token posts; the long-lived user token is the only thing a new
    // Page token can be derived from later.
    accessToken: page.access_token,
    refreshToken: token.accessToken,
    expiresAt: token.expiresAt,
    externalUserId,
    ...(displayName ? { displayName } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    ...(token.grantedScopes ? { grantedScopes: token.grantedScopes } : {}),
    connectedAt: Date.now(),
  };
}

export const connectFacebook = (): Promise<Account | null> => connectMeta('facebook');
export const connectInstagram = (): Promise<Account | null> => connectMeta('instagram');
