import type { MediaFile, MediaReader } from '@fanout/core-posting';
import type { ImagePickerAsset } from 'expo-image-picker';

/**
 * Turns a picked asset into bytes for the adapters.
 *
 * React Native's fetch keeps blob data on the native side, so a large video is
 * never pulled through JS memory. The picker already knows the asset's MIME
 * type and byte length, and those are more reliable than what a file:// blob
 * reports, so they win where present — platforms need an exact length up front
 * to open a resumable upload.
 */
export function assetMediaReader(asset: ImagePickerAsset): MediaReader {
  return async (content): Promise<MediaFile> => {
    const response = await fetch(content.mediaUri);
    if (!response.ok) {
      throw new Error(`Could not read the selected media (HTTP ${response.status}).`);
    }
    const data = await response.blob();

    return {
      data,
      contentType:
        asset.mimeType ?? (data.type || (content.mediaType === 'video' ? 'video/mp4' : 'image/jpeg')),
      size: asset.fileSize ?? data.size,
    };
  };
}
