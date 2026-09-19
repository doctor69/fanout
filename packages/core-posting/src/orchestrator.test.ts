import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ReconnectRequiredError } from './errors';
import { fanOutPost } from './orchestrator';
import type {
  Account,
  Platform,
  PlatformAdapter,
  PostContent,
  PostResult,
  TokenStore,
} from './types';

const OWNER = 'device';

const CONTENT: PostContent = {
  caption: 'one caption, everywhere',
  mediaUri: 'file:///tmp/clip.mp4',
  mediaType: 'video',
};

function account(platform: Platform): Account {
  return {
    platform,
    accessToken: `${platform}-token`,
    refreshToken: `${platform}-refresh`,
    expiresAt: Date.now() + 3_600_000,
    externalUserId: `${platform}-user`,
    verifiedAt: Date.now(),
  };
}

/** The TokenStore v1 and v2 both satisfy — here, backed by a Map. */
class MemoryTokenStore implements TokenStore {
  readonly saved: Account[] = [];
  private readonly accounts: Account[];

  constructor(accounts: Account[]) {
    this.accounts = [...accounts];
  }

  async getAccounts(): Promise<Account[]> {
    return [...this.accounts];
  }

  async saveAccount(_ownerId: string, updated: Account): Promise<void> {
    this.saved.push(updated);
  }

  async removeAccount(): Promise<void> {}
}

interface FakeAdapterOptions {
  publish?: (account: Account) => Promise<PostResult>;
  refresh?: (account: Account) => Promise<Account>;
}

function fakeAdapter(platform: Platform, options: FakeAdapterOptions = {}): PlatformAdapter {
  return {
    platform,
    refreshTokenIfNeeded: options.refresh ?? (async (account) => account),
    publish:
      options.publish ??
      (async () => ({ platform, status: 'success', platformPostId: `${platform}-post` })),
    verifyConnection: async () => ({ verified: true }),
  };
}

test('posts to every connected account and returns one result each', async () => {
  const store = new MemoryTokenStore([account('youtube'), account('x')]);

  const results = await fanOutPost(OWNER, CONTENT, ['youtube', 'x'], store, {
    youtube: fakeAdapter('youtube'),
    x: fakeAdapter('x'),
  });

  assert.deepEqual(
    results.map((result) => [result.platform, result.status, result.platformPostId]),
    [
      ['youtube', 'success', 'youtube-post'],
      ['x', 'success', 'x-post'],
    ],
  );
});

test('honours a per-post opt-out', async () => {
  const store = new MemoryTokenStore([account('youtube'), account('x')]);
  let xCalled = false;

  const results = await fanOutPost(OWNER, CONTENT, ['youtube'], store, {
    youtube: fakeAdapter('youtube'),
    x: fakeAdapter('x', {
      publish: async () => {
        xCalled = true;
        return { platform: 'x', status: 'success' };
      },
    }),
  });

  assert.equal(results.length, 1);
  assert.equal(results[0]?.platform, 'youtube');
  assert.equal(xCalled, false, 'an opted-out platform must not be posted to');
});

test('one platform failing never blocks the others', async () => {
  const store = new MemoryTokenStore([account('youtube'), account('x'), account('linkedin')]);
  let youtubeResolved = false;

  const results = await fanOutPost(OWNER, CONTENT, ['youtube', 'x', 'linkedin'], store, {
    youtube: fakeAdapter('youtube', {
      publish: async () => {
        youtubeResolved = true;
        return { platform: 'youtube', status: 'success', platformPostId: 'yt1' };
      },
    }),
    // Resolves a failure, as a well-behaved adapter does.
    x: fakeAdapter('x', {
      publish: async () => ({ platform: 'x', status: 'failure', error: 'Tweet too long.' }),
    }),
    // Throws outright, as an adapter hitting something unexpected does.
    linkedin: fakeAdapter('linkedin', {
      publish: async () => {
        throw new Error('socket hang up');
      },
    }),
  });

  assert.equal(youtubeResolved, true);
  assert.deepEqual(
    results.map((result) => [result.platform, result.status]),
    [
      ['youtube', 'success'],
      ['x', 'failure'],
      ['linkedin', 'failure'],
    ],
  );
  assert.equal(results[1]?.error, 'Tweet too long.');
  assert.equal(results[2]?.error, 'socket hang up');
});

test('a dead grant comes back as a reconnect, not a generic failure', async () => {
  const store = new MemoryTokenStore([account('youtube')]);

  const [result] = await fanOutPost(OWNER, CONTENT, ['youtube'], store, {
    youtube: fakeAdapter('youtube', {
      refresh: async () => {
        throw new ReconnectRequiredError('youtube', 'refresh token revoked');
      },
    }),
  });

  assert.equal(result?.status, 'failure');
  assert.equal(result?.needsReconnect, true);
  assert.match(result?.error ?? '', /Reconnect YouTube/);
});

test('saves a refreshed token once, and leaves an unrefreshed one alone', async () => {
  const youtube = account('youtube');
  const x = account('x');
  const store = new MemoryTokenStore([youtube, x]);

  await fanOutPost(OWNER, CONTENT, ['youtube', 'x'], store, {
    youtube: fakeAdapter('youtube', {
      refresh: async (current) => ({ ...current, accessToken: 'rotated' }),
    }),
    // Same reference back: nothing to save.
    x: fakeAdapter('x'),
  });

  assert.equal(store.saved.length, 1);
  assert.equal(store.saved[0]?.platform, 'youtube');
  assert.equal(store.saved[0]?.accessToken, 'rotated');
});

test('reports each platform as it resolves, not only at the end', async () => {
  const store = new MemoryTokenStore([account('youtube'), account('x')]);
  const seen: string[] = [];

  let releaseYoutube: (() => void) | undefined;
  const youtubeBlocked = new Promise<void>((resolve) => {
    releaseYoutube = resolve;
  });

  const posting = fanOutPost(
    OWNER,
    CONTENT,
    ['youtube', 'x'],
    store,
    {
      youtube: fakeAdapter('youtube', {
        publish: async () => {
          await youtubeBlocked;
          return { platform: 'youtube', status: 'success' };
        },
      }),
      x: fakeAdapter('x'),
    },
    { onResult: (result) => seen.push(result.platform) },
  );

  // X finishes while YouTube is still uploading.
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(seen, ['x']);

  releaseYoutube?.();
  await posting;
  assert.deepEqual(seen, ['x', 'youtube']);
});

test('reports a platform with no adapter instead of throwing out of fanOutPost', async () => {
  const store = new MemoryTokenStore([account('tiktok')]);

  const [result] = await fanOutPost(OWNER, CONTENT, ['tiktok'], store, {});

  assert.equal(result?.status, 'failure');
  assert.match(result?.error ?? '', /No adapter registered for TikTok/);
});

test('posting with nothing connected resolves to no results', async () => {
  const store = new MemoryTokenStore([]);

  assert.deepEqual(await fanOutPost(OWNER, CONTENT, ['youtube'], store, {}), []);
});
