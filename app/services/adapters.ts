import type { Platform, PlatformAdapter } from '@fanout/core-posting';
import { createYouTubeAdapter } from '@fanout/core-posting';

import { GOOGLE_CLIENT_ID } from '../config';

/**
 * The app's platform adapter registry. Adapters are filled in phase by phase
 * (specs/06-build-plan.md); the composer and the connect flow look platforms
 * up here rather than branching on which platform they're dealing with.
 */
export const adapters: Partial<Record<Platform, PlatformAdapter>> = {
  youtube: createYouTubeAdapter({ clientId: GOOGLE_CLIENT_ID }),
};

export function adapterFor(platform: Platform): PlatformAdapter {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`No adapter for ${platform} yet.`);
  return adapter;
}
