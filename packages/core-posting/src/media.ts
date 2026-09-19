import type { FetchLike, MediaFile, MediaReader, PostContent } from './types';

const DEFAULT_CONTENT_TYPES: Record<PostContent['mediaType'], string> = {
  video: 'video/mp4',
  image: 'image/jpeg',
};

/**
 * Reads media through fetch. Works for http(s) URLs everywhere, and for
 * file:// URIs in the React Native runtime, where fetch keeps blob data on the
 * native side instead of pulling a whole video into JS memory.
 */
export function createFetchMediaReader(fetchImpl: FetchLike = globalThis.fetch): MediaReader {
  return async function readMedia(content: PostContent): Promise<MediaFile> {
    const response = await fetchImpl(content.mediaUri);
    if (!response.ok) {
      throw new Error(`Could not read media (HTTP ${response.status})`);
    }
    const data = await response.blob();
    const contentType =
      data.type || response.headers.get('content-type') || DEFAULT_CONTENT_TYPES[content.mediaType];

    return { data, contentType, size: data.size };
  };
}
