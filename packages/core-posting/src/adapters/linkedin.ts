import { PlatformRejectedError, ReconnectRequiredError, UnsupportedMediaError } from '../errors';
import { createFetchMediaReader } from '../media';
import type {
  Account,
  ConnectionVerification,
  FetchLike,
  MediaFile,
  MediaReader,
  PlatformAdapter,
  PostContent,
  PostResult,
  ServerTokenRefresher,
} from '../types';

const PLATFORM = 'linkedin' as const;

const API = 'https://api.linkedin.com';
const USERINFO = `${API}/v2/userinfo`;
const IMAGES = `${API}/rest/images`;
const VIDEOS = `${API}/rest/videos`;
const POSTS = `${API}/rest/posts`;

const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

/**
 * LinkedIn's versioned APIs require this header, and versions age out after
 * about a year — so it's configurable and worth bumping with the rest of the
 * dependency housekeeping.
 */
export const LINKEDIN_DEFAULT_VERSION = '202606';

export const LINKEDIN_SCOPES = ['openid', 'profile', 'w_member_social'] as const;
export const LINKEDIN_POSTING_SCOPE = 'w_member_social';

export interface LinkedInAdapterConfig {
  /** LinkedIn's token exchange needs the client secret — server hop. */
  refreshViaServer: ServerTokenRefresher;
  /** LinkedIn-Version header, YYYYMM. Defaults to LINKEDIN_DEFAULT_VERSION. */
  version?: string;
  readMedia?: MediaReader;
  fetch?: FetchLike;
  now?: () => number;
}

export function createLinkedInAdapter(config: LinkedInAdapterConfig): PlatformAdapter {
  const doFetch: FetchLike = config.fetch ?? globalThis.fetch;
  const readMedia: MediaReader = config.readMedia ?? createFetchMediaReader(doFetch);
  const now = config.now ?? (() => Date.now());
  const version = config.version ?? LINKEDIN_DEFAULT_VERSION;

  function headers(account: Account, extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${account.accessToken}`,
      'LinkedIn-Version': version,
      'X-Restli-Protocol-Version': '2.0.0',
      ...extra,
    };
  }

  async function readJson<T>(response: Response): Promise<T> {
    if (response.status === 401) {
      throw new ReconnectRequiredError(PLATFORM, 'LinkedIn rejected the access token');
    }
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) detail = body.message;
      } catch {
        // Not JSON — keep the status line.
      }
      throw new PlatformRejectedError(PLATFORM, detail);
    }
    return (await response.json()) as T;
  }

  function authorUrn(account: Account): string {
    return account.externalUserId.startsWith('urn:')
      ? account.externalUserId
      : `urn:li:person:${account.externalUserId}`;
  }

  async function refreshTokenIfNeeded(account: Account): Promise<Account> {
    if (account.expiresAt - now() > REFRESH_MARGIN_MS) return account;
    if (!account.refreshToken) {
      // LinkedIn only issues refresh tokens to apps approved for them; without
      // one the member simply signs in again.
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
      refreshToken: token.refreshToken ?? account.refreshToken,
      expiresAt: token.expiresAt,
    };
  }

  async function verifyConnection(account: Account): Promise<ConnectionVerification> {
    const granted = account.grantedScopes;
    if (granted && !granted.includes(LINKEDIN_POSTING_SCOPE)) {
      return {
        verified: false,
        needsReconnect: true,
        grantedScopes: granted,
        error:
          'LinkedIn signed you in but withheld permission to post. ' +
          'Connect again and accept all the requested permissions.',
      };
    }

    let response: Response;
    try {
      response = await doFetch(USERINFO, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
    } catch {
      return {
        verified: false,
        error: "Couldn't reach LinkedIn to check the connection. Check your network and try again.",
      };
    }

    if (!response.ok) {
      return {
        verified: false,
        needsReconnect: true,
        error: `LinkedIn didn't accept the sign-in (HTTP ${response.status}). Try connecting again.`,
      };
    }

    return { verified: true, ...(granted ? { grantedScopes: granted } : {}) };
  }

  /** Images: one initializeUpload, one PUT, and the image URN is the media id. */
  async function uploadImage(account: Account, media: MediaFile): Promise<string> {
    const init = await readJson<{ value?: { uploadUrl?: string; image?: string } }>(
      await doFetch(`${IMAGES}?action=initializeUpload`, {
        method: 'POST',
        headers: headers(account, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ initializeUploadRequest: { owner: authorUrn(account) } }),
      }),
    );

    const uploadUrl = init.value?.uploadUrl;
    const image = init.value?.image;
    if (!uploadUrl || !image) {
      throw new PlatformRejectedError(PLATFORM, 'LinkedIn did not return an upload URL');
    }

    const upload = await doFetch(uploadUrl, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${account.accessToken}` },
      body: media.data,
    });
    if (!upload.ok) {
      throw new PlatformRejectedError(PLATFORM, `Upload failed (HTTP ${upload.status})`);
    }

    return image;
  }

  /**
   * Videos: LinkedIn hands back a byte range per part, each PUT returns an
   * ETag, and finalizeUpload wants those ETags back in order.
   */
  async function uploadVideo(account: Account, media: MediaFile): Promise<string> {
    const init = await readJson<{
      value?: {
        video?: string;
        uploadToken?: string;
        uploadInstructions?: { uploadUrl?: string; firstByte?: number; lastByte?: number }[];
      };
    }>(
      await doFetch(`${VIDEOS}?action=initializeUpload`, {
        method: 'POST',
        headers: headers(account, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          initializeUploadRequest: {
            owner: authorUrn(account),
            fileSizeBytes: media.size,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        }),
      }),
    );

    const video = init.value?.video;
    const instructions = init.value?.uploadInstructions ?? [];
    if (!video || instructions.length === 0) {
      throw new PlatformRejectedError(PLATFORM, 'LinkedIn did not return upload instructions');
    }

    const uploadedPartIds: string[] = [];
    for (const instruction of instructions) {
      if (!instruction.uploadUrl) {
        throw new PlatformRejectedError(PLATFORM, 'LinkedIn returned an incomplete upload part');
      }
      const first = instruction.firstByte ?? 0;
      // lastByte is inclusive; Blob.slice's end is not.
      const last = instruction.lastByte ?? media.size - 1;

      const part = await doFetch(instruction.uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': media.contentType,
        },
        body: media.data.slice(first, last + 1),
      });
      if (!part.ok) {
        throw new PlatformRejectedError(PLATFORM, `Upload failed (HTTP ${part.status})`);
      }

      const etag = part.headers.get('etag');
      if (!etag) {
        throw new PlatformRejectedError(PLATFORM, 'LinkedIn did not acknowledge an uploaded part');
      }
      uploadedPartIds.push(etag);
    }

    const finalize = await doFetch(`${VIDEOS}?action=finalizeUpload`, {
      method: 'POST',
      headers: headers(account, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        finalizeUploadRequest: {
          video,
          uploadToken: init.value?.uploadToken ?? '',
          uploadedPartIds,
        },
      }),
    });
    if (!finalize.ok) {
      throw new PlatformRejectedError(PLATFORM, `LinkedIn could not finish the upload (HTTP ${finalize.status})`);
    }

    return video;
  }

  async function publish(account: Account, content: PostContent): Promise<PostResult> {
    try {
      if (content.mediaType !== 'video' && content.mediaType !== 'image') {
        throw new UnsupportedMediaError(PLATFORM, 'unsupported media type');
      }

      const media = await readMedia(content);
      const mediaUrn =
        content.mediaType === 'video'
          ? await uploadVideo(account, media)
          : await uploadImage(account, media);

      const response = await doFetch(POSTS, {
        method: 'POST',
        headers: headers(account, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          author: authorUrn(account),
          commentary: content.caption,
          visibility: 'PUBLIC',
          distribution: {
            feedDistribution: 'MAIN_FEED',
            targetEntities: [],
            thirdPartyDistributionChannels: [],
          },
          content: { media: { id: mediaUrn } },
          lifecycleState: 'PUBLISHED',
          isReshareDisabledByAuthor: false,
        }),
      });

      if (response.status === 401) {
        throw new ReconnectRequiredError(PLATFORM, 'LinkedIn rejected the access token');
      }
      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const body = (await response.json()) as { message?: string };
          if (body.message) detail = body.message;
        } catch {
          // Keep the status line.
        }
        return { platform: PLATFORM, status: 'failure', error: detail };
      }

      // The post URN comes back in a header, not the body.
      const postId = response.headers.get('x-restli-id') ?? response.headers.get('x-linkedin-id');

      return {
        platform: PLATFORM,
        status: 'success',
        ...(postId ? { platformPostId: postId } : {}),
      };
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
