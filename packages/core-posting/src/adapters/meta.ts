import { PlatformRejectedError, ReconnectRequiredError, UnsupportedMediaError } from '../errors';
import { createFetchMediaReader } from '../media';
import { buildMultipartBody } from '../multipart';
import type {
  Account,
  ConnectionVerification,
  FetchLike,
  MediaReader,
  Platform,
  PlatformAdapter,
  PostContent,
  PostResult,
  ServerTokenRefresher,
} from '../types';

/**
 * Facebook Pages and Instagram share one Meta app, one OAuth flow shape and
 * one token endpoint, so they share an adapter factory — but they are two
 * platforms in the UI and two Accounts in storage.
 *
 * Account layout for both (see the connect flow in /app):
 *   accessToken     — the Page access token, which is what posts
 *   refreshToken    — the long-lived USER token, the only thing a Page token
 *                     can be re-derived from
 *   externalUserId  — the Page id (Facebook) or the IG user id (Instagram)
 */

export const META_GRAPH_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
const IG_UPLOAD = `https://rupload.facebook.com/ig-api-upload/${META_GRAPH_VERSION}`;

const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

export const FACEBOOK_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
] as const;

export const INSTAGRAM_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'pages_show_list',
  'pages_read_engagement',
] as const;

const MAX_CONTAINER_WAIT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

export type MetaPlatform = Extract<Platform, 'facebook' | 'instagram'>;

export interface MetaAdapterConfig {
  platform: MetaPlatform;
  /** Meta's token exchange needs the app secret, so it goes via the function. */
  refreshViaServer: ServerTokenRefresher;
  readMedia?: MediaReader;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface GraphError {
  error?: { message?: string; type?: string; code?: number };
}

export function createMetaAdapter(config: MetaAdapterConfig): PlatformAdapter {
  const platform = config.platform;
  const doFetch: FetchLike = config.fetch ?? globalThis.fetch;
  const readMedia: MediaReader = config.readMedia ?? createFetchMediaReader(doFetch);
  const now = config.now ?? (() => Date.now());
  const sleep =
    config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const label = platform === 'facebook' ? 'Facebook' : 'Instagram';

  async function readGraph<T>(response: Response): Promise<T> {
    let body: (T & GraphError) | undefined;
    try {
      body = (await response.json()) as T & GraphError;
    } catch {
      throw new PlatformRejectedError(platform, `${label} returned HTTP ${response.status}`);
    }

    if (response.status === 401 || body?.error?.code === 190) {
      throw new ReconnectRequiredError(platform, body?.error?.message ?? 'token rejected');
    }
    if (!response.ok || body?.error) {
      throw new PlatformRejectedError(
        platform,
        body?.error?.message ?? `${label} returned HTTP ${response.status}`,
      );
    }
    return body as T;
  }

  function authHeaders(account: Account): Record<string, string> {
    return { Authorization: `Bearer ${account.accessToken}` };
  }

  /**
   * A Page access token is derived from the user token, so after the user
   * token is renewed the Page token has to be picked up again.
   */
  async function pageTokenFor(userToken: string, externalUserId: string): Promise<string> {
    const accounts = await readGraph<{
      data?: {
        id?: string;
        access_token?: string;
        instagram_business_account?: { id?: string };
      }[];
    }>(
      await doFetch(
        `${GRAPH}/me/accounts?fields=id,access_token,instagram_business_account{id}`,
        { headers: { Authorization: `Bearer ${userToken}` } },
      ),
    );

    const match = accounts.data?.find((page) =>
      platform === 'facebook'
        ? page.id === externalUserId
        : page.instagram_business_account?.id === externalUserId,
    );

    if (!match?.access_token) {
      throw new ReconnectRequiredError(
        platform,
        `${label} no longer lists the connected account on this login`,
      );
    }
    return match.access_token;
  }

  async function refreshTokenIfNeeded(account: Account): Promise<Account> {
    if (account.expiresAt - now() > REFRESH_MARGIN_MS) return account;
    if (!account.refreshToken) {
      throw new ReconnectRequiredError(platform, 'no long-lived user token stored');
    }

    let token;
    try {
      // Meta issues no refresh token: a still-valid long-lived token is
      // re-exchanged for a fresh one, which the function handles.
      token = await config.refreshViaServer(account);
    } catch (error) {
      throw new ReconnectRequiredError(
        platform,
        error instanceof Error ? error.message : String(error),
      );
    }

    const pageToken = await pageTokenFor(token.accessToken, account.externalUserId);

    return {
      ...account,
      accessToken: pageToken,
      refreshToken: token.accessToken,
      expiresAt: token.expiresAt,
    };
  }

  async function verifyConnection(account: Account): Promise<ConnectionVerification> {
    let response: Response;
    try {
      // Reading the target back with the Page token proves the token is live
      // and that it actually governs the account we intend to post to.
      const target =
        platform === 'facebook'
          ? `${GRAPH}/${account.externalUserId}?fields=id,name`
          : `${GRAPH}/${account.externalUserId}?fields=id,username`;
      response = await doFetch(target, { headers: authHeaders(account) });
    } catch {
      return {
        verified: false,
        error: `Couldn't reach ${label} to check the connection. Check your network and try again.`,
      };
    }

    try {
      await readGraph<{ id?: string }>(response);
    } catch (error) {
      if (error instanceof ReconnectRequiredError) {
        return { verified: false, needsReconnect: true, error: error.message };
      }
      return {
        verified: false,
        needsReconnect: true,
        error: `${label} didn't accept the sign-in (${
          error instanceof Error ? error.message : String(error)
        }). Try connecting again.`,
      };
    }

    return {
      verified: true,
      ...(account.grantedScopes ? { grantedScopes: account.grantedScopes } : {}),
    };
  }

  /** Facebook Pages take the bytes directly, as a multipart `source` field. */
  async function publishToFacebook(account: Account, content: PostContent): Promise<PostResult> {
    const media = await readMedia(content);
    const isVideo = content.mediaType === 'video';

    const { body, contentType } = buildMultipartBody([
      { name: isVideo ? 'description' : 'caption', value: content.caption },
      {
        name: 'source',
        value: media.data,
        filename: isVideo ? 'video.mp4' : 'photo.jpg',
        contentType: media.contentType,
      },
    ]);

    const endpoint = `${GRAPH}/${account.externalUserId}/${isVideo ? 'videos' : 'photos'}`;
    const posted = await readGraph<{ id?: string; post_id?: string }>(
      await doFetch(endpoint, {
        method: 'POST',
        headers: { ...authHeaders(account), 'Content-Type': contentType },
        body,
      }),
    );

    const id = posted.post_id ?? posted.id;
    if (!id) {
      return { platform, status: 'failure', error: 'Facebook returned no post id' };
    }
    return { platform, status: 'success', platformPostId: id };
  }

  /**
   * Instagram: create a container, upload the bytes to the resumable endpoint,
   * wait for Instagram to finish processing, then publish the container.
   */
  async function publishToInstagram(account: Account, content: PostContent): Promise<PostResult> {
    if (content.mediaType !== 'video') {
      // Instagram's image container takes only image_url — a publicly
      // reachable URL — and there is no binary path for photos.
      throw new UnsupportedMediaError(
        platform,
        'unsupported media type, videos only (Instagram photo posts need a public URL)',
      );
    }

    const media = await readMedia(content);

    const container = await readGraph<{ id?: string }>(
      await doFetch(`${GRAPH}/${account.externalUserId}/media`, {
        method: 'POST',
        headers: { ...authHeaders(account), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          media_type: 'REELS',
          upload_type: 'resumable',
          caption: content.caption,
        }),
      }),
    );
    if (!container.id) {
      throw new PlatformRejectedError(platform, 'Instagram returned no upload container');
    }

    const upload = await doFetch(`${IG_UPLOAD}/${container.id}`, {
      method: 'POST',
      headers: {
        // This endpoint wants the OAuth scheme, not Bearer.
        Authorization: `OAuth ${account.accessToken}`,
        offset: '0',
        file_size: String(media.size),
      },
      body: media.data,
    });
    if (!upload.ok) {
      throw new PlatformRejectedError(platform, `Upload failed (HTTP ${upload.status})`);
    }

    await waitForContainer(account, container.id);

    const published = await readGraph<{ id?: string }>(
      await doFetch(`${GRAPH}/${account.externalUserId}/media_publish`, {
        method: 'POST',
        headers: { ...authHeaders(account), 'Content-Type': 'application/json' },
        body: JSON.stringify({ creation_id: container.id }),
      }),
    );

    if (!published.id) {
      return { platform, status: 'failure', error: 'Instagram returned no post id' };
    }
    return { platform, status: 'success', platformPostId: published.id };
  }

  async function waitForContainer(account: Account, containerId: string): Promise<void> {
    const deadline = now() + MAX_CONTAINER_WAIT_MS;

    for (;;) {
      const status = await readGraph<{ status_code?: string; status?: string }>(
        await doFetch(`${GRAPH}/${containerId}?fields=status_code,status`, {
          headers: authHeaders(account),
        }),
      );

      if (status.status_code === 'FINISHED') return;
      if (status.status_code === 'ERROR') {
        throw new PlatformRejectedError(
          platform,
          status.status ?? 'Instagram could not process the video',
        );
      }
      if (now() >= deadline) {
        throw new PlatformRejectedError(
          platform,
          'Instagram is still processing the video — try again shortly',
        );
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async function publish(account: Account, content: PostContent): Promise<PostResult> {
    try {
      return platform === 'facebook'
        ? await publishToFacebook(account, content)
        : await publishToInstagram(account, content);
    } catch (error) {
      if (error instanceof ReconnectRequiredError) {
        return { platform, status: 'failure', error: error.message, needsReconnect: true };
      }
      if (error instanceof UnsupportedMediaError || error instanceof PlatformRejectedError) {
        return { platform, status: 'failure', error: error.message };
      }
      throw error;
    }
  }

  return { platform, refreshTokenIfNeeded, publish, verifyConnection };
}
