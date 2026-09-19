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
  /**
   * Scopes the platform said it granted at connect time, where the platform
   * reports them on the token response. Adapters whose API has no way to ask
   * later check posting permission against this.
   */
  grantedScopes?: string[];
  /**
   * Epoch ms of the last successful verifyConnection. Only verified accounts
   * are stored, so its presence is what earns the Connections checkmark.
   */
  verifiedAt?: number;
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

/**
 * The result of proving a stored grant can actually post.
 *
 * The Connections screen only shows a platform as connected once this comes
 * back verified (specs/04-posting-flow.md) — signing in is not the same thing
 * as being able to post, because a user can complete the browser flow while
 * declining the permission the posting call needs.
 */
export interface ConnectionVerification {
  verified: boolean;
  /** Why verification failed, phrased for display in the Connections row. */
  error?: string;
  /** The scopes the platform reports it actually granted, when it reports them. */
  grantedScopes?: string[];
  /** True when the fix is to run the OAuth flow again rather than to retry. */
  needsReconnect?: boolean;
}

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
  /**
   * Confirms the account's grant is live and covers posting. Called right
   * after a connect, before the account is stored and the checkmark shown.
   * Never throws — an unverifiable connection is a `verified: false` result
   * with a readable reason. Callers wanting to re-verify an older account
   * should run refreshTokenIfNeeded first.
   */
  verifyConnection(account: Account): Promise<ConnectionVerification>;
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
