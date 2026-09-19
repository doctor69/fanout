import type { MediaReader, Platform, PlatformAdapter } from '@fanout/core-posting';
import {
  createLinkedInAdapter,
  createMetaAdapter,
  createTikTokAdapter,
  createXAdapter,
  createYouTubeAdapter,
} from '@fanout/core-posting';

import { GOOGLE_CLIENT_ID, X_CLIENT_ID } from '../config';
import { refreshOnServer } from './oauth/tokenExchange';

export type AdapterRegistry = Partial<Record<Platform, PlatformAdapter>>;

/**
 * The app's platform adapter registry. Adapters are filled in phase by phase
 * (specs/06-build-plan.md); the composer and the connect flow look platforms
 * up here rather than branching on which platform they're dealing with.
 *
 * Built per call rather than as a singleton because each post supplies its own
 * media reader, closed over the asset the user picked.
 */
export function createAdapters(readMedia?: MediaReader): AdapterRegistry {
  return {
    youtube: createYouTubeAdapter({
      clientId: GOOGLE_CLIENT_ID,
      ...(readMedia ? { readMedia } : {}),
    }),
    x: createXAdapter({
      clientId: X_CLIENT_ID,
      ...(readMedia ? { readMedia } : {}),
    }),
    tiktok: createTikTokAdapter({
      // TikTok can't refresh on-device: its token endpoint needs the secret.
      refreshViaServer: refreshOnServer('tiktok'),
      ...(readMedia ? { readMedia } : {}),
    }),
    facebook: createMetaAdapter({
      platform: 'facebook',
      refreshViaServer: refreshOnServer('facebook'),
      ...(readMedia ? { readMedia } : {}),
    }),
    instagram: createMetaAdapter({
      platform: 'instagram',
      refreshViaServer: refreshOnServer('instagram'),
      ...(readMedia ? { readMedia } : {}),
    }),
    linkedin: createLinkedInAdapter({
      refreshViaServer: refreshOnServer('linkedin'),
      ...(readMedia ? { readMedia } : {}),
    }),
  };
}

/** Registry for everything that doesn't upload — connect-time verification. */
export const adapters: AdapterRegistry = createAdapters();

export function adapterFor(platform: Platform): PlatformAdapter {
  const adapter = adapters[platform];
  if (!adapter) throw new Error(`No adapter for ${platform} yet.`);
  return adapter;
}
