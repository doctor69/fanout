import type { Platform } from './types';
import { PLATFORM_LABELS } from './platforms';

/**
 * Thrown when a token can no longer be refreshed (refresh token revoked or
 * expired). The UI turns this into a "Reconnect <platform>" action that
 * deep-links to the Connections screen (specs/04-posting-flow.md), rather
 * than a generic retry.
 */
export class ReconnectRequiredError extends Error {
  readonly platform: Platform;

  constructor(platform: Platform, detail?: string) {
    super(
      detail
        ? `Reconnect ${PLATFORM_LABELS[platform]} — ${detail}`
        : `Reconnect ${PLATFORM_LABELS[platform]}`,
    );
    this.name = 'ReconnectRequiredError';
    this.platform = platform;
  }
}

/** Media the target platform can't accept (specs/04-posting-flow.md). */
export class UnsupportedMediaError extends Error {
  constructor(platform: Platform, detail: string) {
    super(`${PLATFORM_LABELS[platform]} can't post this: ${detail}`);
    this.name = 'UnsupportedMediaError';
  }
}

/**
 * The platform's API answered, and said no — bad metadata, rate limit, content
 * rejected. specs/01-architecture.md requires these to surface as a failed
 * PostResult rather than an exception out of publish().
 */
export class PlatformRejectedError extends Error {
  readonly platform: Platform;

  constructor(platform: Platform, detail: string) {
    super(detail);
    this.name = 'PlatformRejectedError';
    this.platform = platform;
  }
}
