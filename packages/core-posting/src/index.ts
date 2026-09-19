export type {
  Account,
  ConnectionVerification,
  FetchLike,
  MediaFile,
  MediaReader,
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
export type { YouTubeAdapterConfig } from './adapters/youtube';
export { fanOutPost } from './orchestrator';
export type { FanOutOptions } from './orchestrator';
