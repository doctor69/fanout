import { PlatformRejectedError, ReconnectRequiredError, UnsupportedMediaError } from '../errors';
import { createFetchMediaReader } from '../media';
import type {
  Account,
  ConnectionVerification,
  FetchLike,
  MediaReader,
  PlatformAdapter,
  PostContent,
  PostResult,
  ServerTokenRefresher,
} from '../types';

const PLATFORM = 'tiktok' as const;

const API = 'https://open.tiktokapis.com/v2';
const USER_INFO = `${API}/user/info/?fields=open_id,display_name,avatar_url`;
const CREATOR_INFO = `${API}/post/publish/creator_info/query/`;
const VIDEO_INIT = `${API}/post/publish/video/init/`;
const STATUS_FETCH = `${API}/post/publish/status/fetch/`;

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Posting needs video.publish; user.info.basic is what names the account. */
export const TIKTOK_SCOPES = ['user.info.basic', 'video.publish'] as const;
export const TIKTOK_POSTING_SCOPE = 'video.publish';

/**
 * TikTok wants chunks of at least 5MB and at most 64MB, so anything that fits
 * in one chunk goes in one chunk. The final chunk of a larger upload carries
 * the remainder.
 */
const SINGLE_CHUNK_LIMIT = 64 * 1024 * 1024;
const CHUNK_BYTES = 10 * 1024 * 1024;

const MAX_PUBLISH_WAIT_MS = 5 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

export interface TikTokAdapterConfig {
  /**
   * TikTok's token endpoint requires the client secret even for PKCE clients,
   * so refreshing goes through /functions/token-exchange rather than happening
   * on-device (specs/03-auth-and-oauth.md).
   */
  refreshViaServer: ServerTokenRefresher;
  readMedia?: MediaReader;
  fetch?: FetchLike;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

interface TikTokEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

export function createTikTokAdapter(config: TikTokAdapterConfig): PlatformAdapter {
  const doFetch: FetchLike = config.fetch ?? globalThis.fetch;
  const readMedia: MediaReader = config.readMedia ?? createFetchMediaReader(doFetch);
  const now = config.now ?? (() => Date.now());
  const sleep =
    config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  /**
   * TikTok answers 200 with an error code in the envelope as readily as it
   * answers a 4xx, so both have to be checked.
   */
  async function readEnvelope<T>(response: Response): Promise<T> {
    let envelope: TikTokEnvelope<T> = {};
    try {
      envelope = (await response.json()) as TikTokEnvelope<T>;
    } catch {
      throw new PlatformRejectedError(PLATFORM, `TikTok returned HTTP ${response.status}`);
    }

    const code = envelope.error?.code;
    if (response.status === 401 || code === 'access_token_invalid' || code === 'scope_not_authorized') {
      throw new ReconnectRequiredError(PLATFORM, envelope.error?.message ?? 'token rejected');
    }
    if (!response.ok || (code && code !== 'ok')) {
      throw new PlatformRejectedError(
        PLATFORM,
        envelope.error?.message ?? `TikTok returned HTTP ${response.status}`,
      );
    }
    if (!envelope.data) {
      throw new PlatformRejectedError(PLATFORM, 'TikTok returned an empty response');
    }
    return envelope.data;
  }

  function postJson(url: string, account: Account, body?: unknown): Promise<Response> {
    return doFetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  async function refreshTokenIfNeeded(account: Account): Promise<Account> {
    if (account.expiresAt - now() > REFRESH_MARGIN_MS) return account;
    if (!account.refreshToken) {
      throw new ReconnectRequiredError(PLATFORM, 'no refresh token stored');
    }

    let token;
    try {
      token = await config.refreshViaServer(account);
    } catch (error) {
      throw new ReconnectRequiredError(
        PLATFORM,
        error instanceof Error ? error.message : String(error),
      );
    }

    return {
      ...account,
      accessToken: token.accessToken,
      // TikTok rotates refresh tokens on every refresh.
      refreshToken: token.refreshToken ?? account.refreshToken,
      expiresAt: token.expiresAt,
      ...(token.grantedScopes ? { grantedScopes: token.grantedScopes } : {}),
    };
  }

  async function verifyConnection(account: Account): Promise<ConnectionVerification> {
    const granted = account.grantedScopes;
    if (granted && !granted.includes(TIKTOK_POSTING_SCOPE)) {
      return {
        verified: false,
        needsReconnect: true,
        grantedScopes: granted,
        error:
          'TikTok signed you in but withheld permission to post videos. ' +
          'Connect again and accept all the requested permissions.',
      };
    }

    let response: Response;
    try {
      response = await doFetch(USER_INFO, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
    } catch {
      return {
        verified: false,
        error: "Couldn't reach TikTok to check the connection. Check your network and try again.",
      };
    }

    try {
      await readEnvelope<{ user?: unknown }>(response);
    } catch (error) {
      if (error instanceof ReconnectRequiredError) {
        return { verified: false, needsReconnect: true, error: error.message };
      }
      return {
        verified: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    return { verified: true, ...(granted ? { grantedScopes: granted } : {}) };
  }

  /**
   * An app that hasn't passed TikTok's audit may only post privately, and the
   * allowed values come from TikTok rather than from us — so ask, then pick the
   * most public option offered (specs/03-auth-and-oauth.md).
   */
  async function choosePrivacyLevel(account: Account): Promise<string> {
    const info = await readEnvelope<{ privacy_level_options?: string[] }>(
      await postJson(CREATOR_INFO, account),
    );
    const options = info.privacy_level_options ?? [];
    return options.includes('PUBLIC_TO_EVERYONE')
      ? 'PUBLIC_TO_EVERYONE'
      : (options[0] ?? 'SELF_ONLY');
  }

  async function uploadVideo(account: Account, content: PostContent): Promise<string> {
    const media = await readMedia(content);
    const privacyLevel = await choosePrivacyLevel(account);

    const singleChunk = media.size <= SINGLE_CHUNK_LIMIT;
    const chunkSize = singleChunk ? media.size : CHUNK_BYTES;
    const chunkCount = singleChunk ? 1 : Math.floor(media.size / chunkSize);

    const init = await readEnvelope<{ publish_id?: string; upload_url?: string }>(
      await postJson(VIDEO_INIT, account, {
        post_info: { title: content.caption, privacy_level: privacyLevel },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: media.size,
          chunk_size: chunkSize,
          total_chunk_count: chunkCount,
        },
      }),
    );

    if (!init.publish_id || !init.upload_url) {
      throw new PlatformRejectedError(PLATFORM, 'TikTok did not return an upload URL');
    }

    for (let index = 0; index < chunkCount; index += 1) {
      const start = index * chunkSize;
      // The last chunk absorbs whatever is left over.
      const end = index === chunkCount - 1 ? media.size : start + chunkSize;
      const chunk = media.data.slice(start, end);

      const upload = await doFetch(init.upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': media.contentType,
          'Content-Range': `bytes ${start}-${end - 1}/${media.size}`,
        },
        body: chunk,
      });

      if (!upload.ok) {
        throw new PlatformRejectedError(
          PLATFORM,
          `Upload failed part-way through (HTTP ${upload.status})`,
        );
      }
    }

    return init.publish_id;
  }

  /** TikTok publishes asynchronously, so the post isn't real until it says so. */
  async function waitForPublish(account: Account, publishId: string): Promise<string> {
    const deadline = now() + MAX_PUBLISH_WAIT_MS;

    for (;;) {
      const status = await readEnvelope<{
        status?: string;
        fail_reason?: string;
        publicaly_available_post_id?: string[];
      }>(await postJson(STATUS_FETCH, account, { publish_id: publishId }));

      if (status.status === 'PUBLISH_COMPLETE' || status.status === 'SEND_TO_USER_INBOX') {
        return status.publicaly_available_post_id?.[0] ?? publishId;
      }
      if (status.status === 'FAILED') {
        throw new PlatformRejectedError(
          PLATFORM,
          status.fail_reason ?? 'TikTok could not publish the video',
        );
      }
      if (now() >= deadline) {
        // The upload landed; TikTok is just slow. Don't call it a failure.
        return publishId;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  async function publish(account: Account, content: PostContent): Promise<PostResult> {
    try {
      if (content.mediaType !== 'video') {
        // TikTok photo posts accept only PULL_FROM_URL, so they need a publicly
        // reachable URL — which a file on someone's phone is not.
        throw new UnsupportedMediaError(
          PLATFORM,
          'unsupported media type, videos only (TikTok photo posts need a public URL)',
        );
      }

      const publishId = await uploadVideo(account, content);
      const postId = await waitForPublish(account, publishId);

      return { platform: PLATFORM, status: 'success', platformPostId: postId };
    } catch (error) {
      if (error instanceof ReconnectRequiredError) {
        return { platform: PLATFORM, status: 'failure', error: error.message, needsReconnect: true };
      }
      if (error instanceof UnsupportedMediaError || error instanceof PlatformRejectedError) {
        return { platform: PLATFORM, status: 'failure', error: error.message };
      }
      throw error;
    }
  }

  return { platform: PLATFORM, refreshTokenIfNeeded, publish, verifyConnection };
}
