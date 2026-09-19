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
} from '../types';

const PLATFORM = 'youtube' as const;

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const TOKENINFO_ENDPOINT = 'https://oauth2.googleapis.com/tokeninfo';
const UPLOAD_ENDPOINT =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet%2Cstatus';

/**
 * The grant a YouTube upload needs. A user can finish the Google consent
 * screen with this box unticked, which yields a perfectly valid token that
 * cannot post — which is exactly what verifyConnection exists to catch.
 */
export const YOUTUBE_UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

/** Refresh this long before expiry rather than at it (specs/03-auth-and-oauth.md). */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** YouTube's own limits on the fields we populate from the caption. */
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 5000;

export interface YouTubeAdapterConfig {
  /**
   * Google OAuth client id for an installed-app client. There is no client
   * secret for this client type, which is why YouTube needs no server hop
   * (specs/03-auth-and-oauth.md).
   */
  clientId: string;
  /**
   * Defaults to 'public'. Note that a Google API project which hasn't passed
   * YouTube's API audit has uploads forced to private regardless of what is
   * sent here — that's a project status, not a bug in this adapter.
   */
  privacyStatus?: 'public' | 'unlisted' | 'private';
  readMedia?: MediaReader;
  fetch?: FetchLike;
  /** Injectable clock, so expiry logic is testable. */
  now?: () => number;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  error?: string;
  error_description?: string;
}

/** Pulls the most useful message out of a Google API error body. */
async function describeFailure(response: Response): Promise<string> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    // Body already consumed or unreadable — fall through to the status line.
  }

  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string } | string;
      error_description?: string;
    };
    if (typeof parsed.error === 'object' && parsed.error?.message) return parsed.error.message;
    if (typeof parsed.error === 'string') {
      return parsed.error_description ? `${parsed.error}: ${parsed.error_description}` : parsed.error;
    }
  } catch {
    // Not JSON.
  }

  return body.trim() || `HTTP ${response.status}`;
}

/** Caption in, YouTube's title/description fields out. */
function captionToVideoFields(caption: string): { title: string; description: string } {
  const firstLine = caption.split('\n', 1)[0]?.trim() ?? '';
  const title = firstLine.length > 0 ? firstLine.slice(0, MAX_TITLE_LENGTH) : 'Untitled';
  return { title, description: caption.slice(0, MAX_DESCRIPTION_LENGTH) };
}

export function createYouTubeAdapter(config: YouTubeAdapterConfig): PlatformAdapter {
  const doFetch: FetchLike = config.fetch ?? globalThis.fetch;
  const readMedia: MediaReader = config.readMedia ?? createFetchMediaReader(doFetch);
  const now = config.now ?? (() => Date.now());
  const privacyStatus = config.privacyStatus ?? 'public';

  async function refreshTokenIfNeeded(account: Account): Promise<Account> {
    if (account.expiresAt - now() > REFRESH_MARGIN_MS) {
      // Same reference back: tells the orchestrator there is nothing to re-save.
      return account;
    }
    if (!account.refreshToken) {
      throw new ReconnectRequiredError(PLATFORM, 'no refresh token stored');
    }

    const response = await doFetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        refresh_token: account.refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      throw new ReconnectRequiredError(PLATFORM, await describeFailure(response));
    }

    const token = (await response.json()) as TokenResponse;
    if (!token.access_token) {
      throw new ReconnectRequiredError(PLATFORM, 'token endpoint returned no access token');
    }

    return {
      ...account,
      accessToken: token.access_token,
      // Google only re-issues a refresh token occasionally; keep the old one otherwise.
      refreshToken: token.refresh_token ?? account.refreshToken,
      expiresAt: now() + (token.expires_in ?? 3600) * 1000,
    };
  }

  /** Opens a resumable session and returns its upload URL. */
  async function openUploadSession(
    account: Account,
    content: PostContent,
    contentType: string,
    size: number,
  ): Promise<string> {
    const { title, description } = captionToVideoFields(content.caption);

    const response = await doFetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': contentType,
        'X-Upload-Content-Length': String(size),
      },
      body: JSON.stringify({
        snippet: { title, description },
        status: { privacyStatus, selfDeclaredMadeForKids: false },
      }),
    });

    if (response.status === 401) {
      throw new ReconnectRequiredError(PLATFORM, 'YouTube rejected the access token');
    }
    if (!response.ok) {
      throw new PlatformRejectedError(PLATFORM, await describeFailure(response));
    }

    const uploadUrl = response.headers.get('location');
    if (!uploadUrl) {
      throw new PlatformRejectedError(PLATFORM, 'YouTube did not return an upload URL');
    }
    return uploadUrl;
  }

  /**
   * Asks Google what this access token actually is: whether it is still live,
   * and which scopes were granted. Both answers come from one call, and it
   * needs no scope of its own.
   */
  async function verifyConnection(account: Account): Promise<ConnectionVerification> {
    let response: Response;
    try {
      response = await doFetch(
        `${TOKENINFO_ENDPOINT}?access_token=${encodeURIComponent(account.accessToken)}`,
      );
    } catch {
      return {
        verified: false,
        error: "Couldn't reach YouTube to check the connection. Check your network and try again.",
      };
    }

    if (!response.ok) {
      return {
        verified: false,
        needsReconnect: true,
        error: `YouTube didn't accept the sign-in (${await describeFailure(response)}). Try connecting again.`,
      };
    }

    const info = (await response.json()) as { scope?: string };
    const grantedScopes = info.scope ? info.scope.split(' ').filter(Boolean) : [];

    if (!grantedScopes.includes(YOUTUBE_UPLOAD_SCOPE)) {
      return {
        verified: false,
        grantedScopes,
        needsReconnect: true,
        error:
          'YouTube signed you in but did not grant permission to upload videos. ' +
          'Connect again and leave the upload permission ticked.',
      };
    }

    return { verified: true, grantedScopes };
  }

  async function publish(account: Account, content: PostContent): Promise<PostResult> {
    try {
      if (content.mediaType !== 'video') {
        throw new UnsupportedMediaError(PLATFORM, 'unsupported media type, videos only');
      }

      const media = await readMedia(content);
      const uploadUrl = await openUploadSession(account, content, media.contentType, media.size);

      const upload = await doFetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': media.contentType,
          'Content-Length': String(media.size),
        },
        body: media.data,
      });

      if (upload.status === 401) {
        throw new ReconnectRequiredError(PLATFORM, 'YouTube rejected the access token');
      }
      if (!upload.ok) {
        return { platform: PLATFORM, status: 'failure', error: await describeFailure(upload) };
      }

      const video = (await upload.json()) as { id?: string };
      if (!video.id) {
        return {
          platform: PLATFORM,
          status: 'failure',
          error: 'YouTube accepted the upload but returned no video id',
        };
      }

      return { platform: PLATFORM, status: 'success', platformPostId: video.id };
    } catch (error) {
      if (error instanceof ReconnectRequiredError) {
        return {
          platform: PLATFORM,
          status: 'failure',
          error: error.message,
          needsReconnect: true,
        };
      }
      if (error instanceof UnsupportedMediaError || error instanceof PlatformRejectedError) {
        return { platform: PLATFORM, status: 'failure', error: error.message };
      }
      throw error;
    }
  }

  return { platform: PLATFORM, refreshTokenIfNeeded, publish, verifyConnection };
}
