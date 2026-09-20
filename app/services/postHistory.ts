import type { Platform, PostContent, PostResult } from '@fanout/core-posting';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The feed's storage: the last N posts, newest first.
 *
 * specs/02-data-model.md originally kept post attempts in memory only and
 * warned off SQLite unless a spec asked for post history. A spec now does, and
 * this is the smallest thing that satisfies it: one capped JSON list. A
 * database would buy querying that a fixed-length, chronological list doesn't
 * need.
 *
 * AsyncStorage, not secure storage — this is plain content, and nothing here is
 * a token. Tokens live only in expo-secure-store (CLAUDE.md), and no field on a
 * PostRecord carries one.
 */

const STORAGE_KEY = 'post_history_v1';

/** The scroll limit: older posts fall off the end rather than growing forever. */
export const HISTORY_LIMIT = 50;

export interface PostRecordResult {
  platform: Platform;
  status: 'success' | 'failure';
  platformPostId?: string;
  error?: string;
}

export interface PostRecord {
  id: string;
  /** Epoch ms. */
  postedAt: number;
  caption: string;
  /**
   * The local URI of the media as it was picked. The OS can clear its cache,
   * so the feed must survive this no longer resolving.
   */
  mediaUri?: string;
  mediaType: 'video' | 'image';
  results: PostRecordResult[];
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function toRecordResult(result: PostResult): PostRecordResult {
  return {
    platform: result.platform,
    status: result.status,
    ...(result.platformPostId ? { platformPostId: result.platformPostId } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
}

export async function loadHistory(): Promise<PostRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // A corrupt or hand-edited entry shouldn't take the whole feed down.
    return parsed.filter(
      (entry): entry is PostRecord =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as PostRecord).id === 'string' &&
        Array.isArray((entry as PostRecord).results),
    );
  } catch {
    return [];
  }
}

async function write(records: PostRecord[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, HISTORY_LIMIT)));
  } catch {
    // A full disk shouldn't fail a post that already went out.
  }
}

/** Records a fan-out. Returns the id, so a later retry can update it in place. */
export async function recordPost(
  content: PostContent,
  results: PostResult[],
): Promise<PostRecord> {
  const record: PostRecord = {
    id: newId(),
    postedAt: Date.now(),
    caption: content.caption,
    ...(content.mediaUri ? { mediaUri: content.mediaUri } : {}),
    mediaType: content.mediaType,
    results: results.map(toRecordResult),
  };

  const history = await loadHistory();
  await write([record, ...history]);
  return record;
}

/**
 * Folds a per-platform retry into the post it belongs to, so one entry ends up
 * telling the truth rather than the feed growing a second entry for the retry.
 */
export async function updatePostResults(
  recordId: string,
  results: PostResult[],
): Promise<void> {
  const history = await loadHistory();
  const updated = history.map((record) => {
    if (record.id !== recordId) return record;

    const byPlatform = new Map(record.results.map((r) => [r.platform, r]));
    for (const result of results) byPlatform.set(result.platform, toRecordResult(result));

    return { ...record, results: [...byPlatform.values()] };
  });

  await write(updated);
}

export async function clearHistory(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do; the screen re-reads and shows what's there.
  }
}
