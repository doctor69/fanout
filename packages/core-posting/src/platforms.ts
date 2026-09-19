import type { Platform } from './types';

/**
 * The fixed, ordered list the Connections screen renders as six rows
 * (specs/04-posting-flow.md). Order is presentation order, nothing else.
 */
export const PLATFORMS: readonly Platform[] = [
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
  'x',
  'linkedin',
] as const;

/** Human-readable names for UI and for error strings built in this package. */
export const PLATFORM_LABELS: Readonly<Record<Platform, string>> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  linkedin: 'LinkedIn',
};

export function isPlatform(value: unknown): value is Platform {
  return typeof value === 'string' && (PLATFORMS as readonly string[]).includes(value);
}
