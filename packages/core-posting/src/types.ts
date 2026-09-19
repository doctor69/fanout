/**
 * Core interfaces for the cross-posting engine.
 *
 * Source of truth: specs/01-architecture.md (interface shapes) and
 * specs/02-data-model.md (stored account fields).
 *
 * NOTHING in this package may import from react-native, expo, or any other
 * mobile-only runtime. See specs/05-v2-monetization-api.md for why.
 */

export type Platform =
  | 'youtube'
  | 'tiktok'
  | 'instagram'
  | 'facebook'
  | 'x'
  | 'linkedin';

export interface PostContent {
  caption: string;
  /** Local file path (mobile) or URL/buffer reference (server, v2). */
  mediaUri: string;
  mediaType: 'video' | 'image';
}

export interface Account {
  platform: Platform;
  accessToken: string;
  /** Not every platform issues one. */
  refreshToken?: string;
  /** Epoch ms. Drives the pre-publish silent refresh in refreshTokenIfNeeded. */
  expiresAt: number;
  /** The platform's own user/account id. */
  externalUserId: string;
  /** Display-only fields (specs/02-data-model.md); the engine never depends on them. */
  displayName?: string;
  avatarUrl?: string;
  /** Epoch ms, display only. Optional so a v2 TokenStore isn't forced to synthesize it. */
  connectedAt?: number;
}

export interface PostResult {
  platform: Platform;
  status: 'success' | 'failure';
  platformPostId?: string;
  /** Human-readable failure reason, shown verbatim in the UI. */
  error?: string;
  /**
   * Set when the failure is an unrecoverable auth problem, so the UI can offer
   * "Reconnect <platform>" instead of a plain retry (specs/04-posting-flow.md).
   */
  needsReconnect?: boolean;
}

/**
 * A piece of media resolved into bytes the adapters can upload.
 *
 * PostContent.mediaUri is a local file URI on mobile and a URL on the server
 * (specs/01-architecture.md), and this package may not import expo-file-system
 * or any other mobile API — so reading it is injected, not hardcoded. The app
 * passes a reader backed by React Native's Blob support; v2 can pass one
 * backed by S3, a stream, or whatever it stores uploads in.
 */
export interface MediaFile {
  data: Blob;
  contentType: string;
  /** Bytes. Platforms need it up front to open a resumable upload session. */
  size: number;
}

export type MediaReader = (content: PostContent) => Promise<MediaFile>;

/** Injectable fetch so adapters stay testable in plain Node. */
export type FetchLike = typeof globalThis.fetch;

export interface PlatformAdapter {
  platform: Platform;
  /**
   * Returns the SAME object reference when no refresh was needed, so the
   * orchestrator knows not to re-save it. Never writes to storage itself.
   */
  refreshTokenIfNeeded(account: Account): Promise<Account>;
  /**
   * Never throws for expected failures (auth expired, content rejected, rate
   * limited) — resolves a PostResult with status 'failure' and a readable error.
   */
  publish(account: Account, content: PostContent): Promise<PostResult>;
}

export interface TokenStore {
  getAccounts(ownerId: string): Promise<Account[]>;
  saveAccount(ownerId: string, account: Account): Promise<void>;
  removeAccount(ownerId: string, platform: Platform): Promise<void>;
}

/**
 * In-memory only in v1 (specs/02-data-model.md) — drives the composer's
 * per-platform chip state while a fan-out is in flight.
 */
export interface PostAttempt {
  platform: Platform;
  status: 'pending' | 'success' | 'failure';
  platformPostId?: string;
  error?: string;
}
