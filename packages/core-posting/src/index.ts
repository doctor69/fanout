export type {
  Account,
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
export { createYouTubeAdapter } from './adapters/youtube';
export type { YouTubeAdapterConfig } from './adapters/youtube';
