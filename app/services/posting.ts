import type { Platform, PostContent, PostResult } from '@fanout/core-posting';
import { fanOutPost } from '@fanout/core-posting';
import type { ImagePickerAsset } from 'expo-image-picker';

import { DEVICE_OWNER_ID } from '../state/accountsStore';
import { createAdapters } from './adapters';
import { assetMediaReader } from './media';
import { secureStoreTokenStore } from './secureStoreTokenStore';

/**
 * The composer's one way to post. Everything platform-specific is behind
 * fanOutPost and the adapters — this file exists only to bind the on-device
 * token store and the picked asset to that call (specs/01-architecture.md).
 */
export async function postToPlatforms(
  content: PostContent,
  targetPlatforms: Platform[],
  asset: ImagePickerAsset,
  onResult?: (result: PostResult) => void,
): Promise<PostResult[]> {
  return fanOutPost(
    DEVICE_OWNER_ID,
    content,
    targetPlatforms,
    secureStoreTokenStore,
    createAdapters(assetMediaReader(asset)),
    onResult ? { onResult } : {},
  );
}
