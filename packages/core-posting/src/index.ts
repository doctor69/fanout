export type {
  Account,
  ConnectionVerification,
  FetchLike,
  MediaFile,
  MediaReader,
  ServerTokenRefresher,
  ServerTokenSet,
  PlatformAdapter,
  Platform,
  PostAttempt,
  PostContent,
  PostResult,
  TokenStore,
} from './types';

export { PLATFORMS, PLATFORM_LABELS, isPlatform } from './platforms';
export { PlatformRejectedError, ReconnectRequiredError, UnsupportedMediaError } from './errors';
export { createFetchMediaReader } from './media';
export { createYouTubeAdapter, YOUTUBE_UPLOAD_SCOPE } from './adapters/youtube';
export { createXAdapter, X_SCOPES, X_POSTING_SCOPES } from './adapters/x';
export { createTikTokAdapter, TIKTOK_SCOPES, TIKTOK_POSTING_SCOPE } from './adapters/tiktok';
export type { TikTokAdapterConfig } from './adapters/tiktok';
export type { XAdapterConfig } from './adapters/x';
export { buildMultipartBody } from './multipart';
export type { YouTubeAdapterConfig } from './adapters/youtube';
export { fanOutPost } from './orchestrator';
export type { FanOutOptions } from './orchestrator';
