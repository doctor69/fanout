import { PlatformRejectedError, ReconnectRequiredError, UnsupportedMediaError } from '../errors';
import { createFetchMediaReader } from '../media';
import { buildMultipartBody } from '../multipart';
import type {
  Account,
  ConnectionVerification,
  FetchLike,
  MediaFile,
  MediaReader,
  PlatformAdapter,
  PostContent,
  PostResult,
} from '../types';

const PLATFORM = 'x' as const;

const API = 'https://api.x.com/2';
const TOKEN_ENDPOINT = `${API}/oauth2/token`;
const ME_ENDPOINT = `${API}/users/me`;
const MEDIA_ENDPOINT = `${API}/media/upload`;
const TWEETS_ENDPOINT = `${API}/tweets`;

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * Scopes a post needs. X reports granted scopes on the token response rather
 * than from an introspection endpoint, so they're stored on the Account at
 * connect time and checked from there (see Account.grantedScopes).
 */
export const X_POSTING_SCOPES = ['tweet.write', 'media.write'] as const;
export const X_SCOPES = [
  'tweet.read',
  'tweet.write',
  'media.write',
  'users.read',
  // Without this X issues no refresh token, and the connection dies in hours.
  'offline.access',
] as const;

/** X accepts at most 5MB per append call; 1MB keeps retries cheap on mobile. */
const CHUNK_BYTES = 1024 * 1024;
/** Video transcoding is asynchronous; give up rather than poll forever. */
const MAX_PROCESSING_WAIT_MS = 5 * 60 * 1000;

export interface XAdapterConfig {
  /** OAuth 2.0 client id. X native/SPA clients are public — no secret. */
  clientId: string;
  readMedia?: MediaReader;
  fetch?: FetchLike;
  now?: () => number;
  /** Injectable so the processing-poll loop is testable without real delays. */
  sleep?: (ms: number) => Promise<void>;
}

interface MediaUploadResponse {
  data?: {
    id?: string;
    processing_info?: {
      state?: 'pending' | 'in_progress' | 'succeeded' | 'failed';
      check_after_secs?: number;
      error?: { message?: string };
    };
  };
}

/** Pulls the most useful message out of an X API error body. */
async function describeFailure(response: Response): Promise<string> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    // Unreadable body — fall through to the status line.
  }

  try {
    const parsed = JSON.parse(body) as {
      detail?: string;
      title?: string;
      error_description?: string;
      errors?: { message?: string; detail?: string }[];
    };
    const firstError = parsed.errors?.[0];
    const message =
      parsed.detail ??
      parsed.error_description ??
      firstError?.detail ??
      firstError?.message ??
      parsed.title;
    if (message) return message;
  } catch {
    // Not JSON.
  }

  return body.trim() || `HTTP ${response.status}`;
}

function mediaCategory(media: MediaFile, content: PostContent): string {
  if (media.contentType.includes('gif')) return 'tweet_gif';
  return content.mediaType === 'video' ? 'tweet_video' : 'tweet_image';
}

export function createXAdapter(config: XAdapterConfig): PlatformAdapter {
  const doFetch: FetchLike = config.fetch ?? globalThis.fetch;
  const readMedia: MediaReader = config.readMedia ?? createFetchMediaReader(doFetch);
  const now = config.now ?? (() => Date.now());
  const sleep =
    config.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  function authHeaders(account: Account): Record<string, string> {
    return { Authorization: `Bearer ${account.accessToken}` };
  }

  async function refreshTokenIfNeeded(account: Account): Promise<Account> {
    if (account.expiresAt - now() > REFRESH_MARGIN_MS) return account;
    if (!account.refreshToken) {
      throw new ReconnectRequiredError(PLATFORM, 'no refresh token stored');
    }

    const response = await doFetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: account.refreshToken,
        client_id: config.clientId,
      }).toString(),
    });

    if (!response.ok) {
      throw new ReconnectRequiredError(PLATFORM, await describeFailure(response));
    }

    const token = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    if (!token.access_token) {
      throw new ReconnectRequiredError(PLATFORM, 'token endpoint returned no access token');
    }

    return {
      ...account,
      accessToken: token.access_token,
      // X rotates refresh tokens: the old one stops working once it's used.
      refreshToken: token.refresh_token ?? account.refreshToken,
      expiresAt: now() + (token.expires_in ?? 7200) * 1000,
      ...(token.scope ? { grantedScopes: token.scope.split(' ').filter(Boolean) } : {}),
    };
  }

  async function verifyConnection(account: Account): Promise<ConnectionVerification> {
    const granted = account.grantedScopes;
    const missing = granted ? X_POSTING_SCOPES.filter((scope) => !granted.includes(scope)) : [];
    if (missing.length > 0) {
      return {
        verified: false,
        needsReconnect: true,
        ...(granted ? { grantedScopes: granted } : {}),
        error:
          `X signed you in but withheld ${missing.join(' and ')}, so it can't post. ` +
          'Connect again and accept all the requested permissions.',
      };
    }

    let response: Response;
    try {
      response = await doFetch(ME_ENDPOINT, { headers: authHeaders(account) });
    } catch {
      return {
        verified: false,
        error: "Couldn't reach X to check the connection. Check your network and try again.",
      };
    }

    if (!response.ok) {
      return {
        verified: false,
        needsReconnect: true,
        error: `X didn't accept the sign-in (${await describeFailure(response)}). Try connecting again.`,
      };
    }

    return { verified: true, ...(granted ? { grantedScopes: granted } : {}) };
  }

  /** INIT → APPEND per chunk → FINALIZE → poll while X transcodes. */
  async function uploadMedia(account: Account, content: PostContent): Promise<string> {
    const media = await readMedia(content);

    const initResponse = await doFetch(`${MEDIA_ENDPOINT}/initialize`, {
      method: 'POST',
      headers: { ...authHeaders(account), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: media.contentType,
        total_bytes: media.size,
        media_category: mediaCategory(media, content),
      }),
    });

    if (initResponse.status === 401) {
      throw new ReconnectRequiredError(PLATFORM, 'X rejected the access token');
    }
    if (!initResponse.ok) {
      throw new PlatformRejectedError(PLATFORM, await describeFailure(initResponse));
    }

    const mediaId = ((await initResponse.json()) as MediaUploadResponse).data?.id;
    if (!mediaId) throw new PlatformRejectedError(PLATFORM, 'X did not return a media id');

    const chunks = Math.max(1, Math.ceil(media.size / CHUNK_BYTES));
    for (let index = 0; index < chunks; index += 1) {
      // Slicing a file-backed Blob doesn't copy the bytes into JS memory.
      const chunk = media.data.slice(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
      const { body, contentType } = buildMultipartBody([
        { name: 'segment_index', value: String(index) },
        {
          name: 'media',
          value: chunk,
          filename: 'media',
          contentType: media.contentType,
        },
      ]);

      const appendResponse = await doFetch(`${MEDIA_ENDPOINT}/${mediaId}/append`, {
        method: 'POST',
        headers: { ...authHeaders(account), 'Content-Type': contentType },
        body,
      });

      if (!appendResponse.ok) {
        throw new PlatformRejectedError(
          PLATFORM,
          `Upload failed part-way through (${await describeFailure(appendResponse)})`,
        );
      }
    }

    const finalizeResponse = await doFetch(`${MEDIA_ENDPOINT}/${mediaId}/finalize`, {
      method: 'POST',
      headers: authHeaders(account),
    });
    if (!finalizeResponse.ok) {
      throw new PlatformRejectedError(PLATFORM, await describeFailure(finalizeResponse));
    }

    const finalized = (await finalizeResponse.json()) as MediaUploadResponse;
    if (finalized.data?.processing_info) {
      await waitForProcessing(account, mediaId, finalized.data.processing_info);
    }

    return mediaId;
  }

  async function waitForProcessing(
    account: Account,
    mediaId: string,
    initial: NonNullable<NonNullable<MediaUploadResponse['data']>['processing_info']>,
  ): Promise<void> {
    let info = initial;
    const deadline = now() + MAX_PROCESSING_WAIT_MS;

    while (info.state === 'pending' || info.state === 'in_progress') {
      if (now() >= deadline) {
        throw new PlatformRejectedError(PLATFORM, 'X is still processing the video — try again shortly');
      }
      await sleep(Math.max(1, info.check_after_secs ?? 1) * 1000);

      const statusResponse = await doFetch(
        `${MEDIA_ENDPOINT}?command=STATUS&media_id=${encodeURIComponent(mediaId)}`,
        { headers: authHeaders(account) },
      );
      if (!statusResponse.ok) {
        throw new PlatformRejectedError(PLATFORM, await describeFailure(statusResponse));
      }

      const next = ((await statusResponse.json()) as MediaUploadResponse).data?.processing_info;
      if (!next) return;
      info = next;
    }

    if (info.state === 'failed') {
      throw new PlatformRejectedError(
        PLATFORM,
        info.error?.message ?? 'X could not process the video',
      );
    }
  }

  async function publish(account: Account, content: PostContent): Promise<PostResult> {
    try {
      if (content.mediaType !== 'video' && content.mediaType !== 'image') {
        throw new UnsupportedMediaError(PLATFORM, 'unsupported media type');
      }

      const mediaId = await uploadMedia(account, content);

      // The caption is sent as-is: X's length limit depends on the account's
      // tier, so let X reject an over-long post with its own message rather
      // than silently truncating what the user wrote.
      const response = await doFetch(TWEETS_ENDPOINT, {
        method: 'POST',
        headers: { ...authHeaders(account), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content.caption, media: { media_ids: [mediaId] } }),
      });

      if (response.status === 401) {
        throw new ReconnectRequiredError(PLATFORM, 'X rejected the access token');
      }
      if (!response.ok) {
        return { platform: PLATFORM, status: 'failure', error: await describeFailure(response) };
      }

      const posted = (await response.json()) as { data?: { id?: string } };
      if (!posted.data?.id) {
        return {
          platform: PLATFORM,
          status: 'failure',
          error: 'X accepted the post but returned no post id',
        };
      }

      return { platform: PLATFORM, status: 'success', platformPostId: posted.data.id };
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
