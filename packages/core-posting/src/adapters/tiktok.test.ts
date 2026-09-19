import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ReconnectRequiredError } from '../errors';
import type { Account, MediaFile, PostContent, ServerTokenSet } from '../types';
import { createTikTokAdapter } from './tiktok';

const NOW = 1_700_000_000_000;

function account(overrides: Partial<Account> = {}): Account {
  return {
    platform: 'tiktok',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: NOW + 24 * 60 * 60 * 1000,
    externalUserId: 'open-1',
    grantedScopes: ['user.info.basic', 'video.publish'],
    ...overrides,
  };
}

const VIDEO: PostContent = {
  caption: 'dancing badly',
  mediaUri: 'file:///tmp/clip.mp4',
  mediaType: 'video',
};

function media(size: number): MediaFile {
  return { data: new Blob(['x'.repeat(Math.min(size, 1000))]), contentType: 'video/mp4', size };
}

interface Call {
  url: string;
  init: RequestInit;
}

function adapter(
  responses: Response[],
  options: { media?: MediaFile; refresh?: () => Promise<ServerTokenSet> } = {},
) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request to ${String(input)}`);
    return next;
  }) as unknown as typeof globalThis.fetch;

  return {
    calls,
    adapter: createTikTokAdapter({
      fetch: fetchImpl,
      readMedia: async () => options.media ?? media(1000),
      now: () => NOW,
      sleep: async () => {},
      refreshViaServer:
        options.refresh ??
        (async () => ({ accessToken: 'server-access', refreshToken: 'server-refresh', expiresAt: NOW + 86_400_000 })),
    }),
  };
}

const ok = (data: unknown) => Response.json({ data, error: { code: 'ok' } });
const creatorInfo = (options: string[]) => ok({ privacy_level_options: options });
const initOk = () => ok({ publish_id: 'pub-1', upload_url: 'https://upload.tiktok/session' });
const uploadOk = () => new Response(null, { status: 201 });

test('publish uploads the video and waits for TikTok to finish publishing', async () => {
  const { adapter: tiktok, calls } = adapter([
    creatorInfo(['PUBLIC_TO_EVERYONE', 'SELF_ONLY']),
    initOk(),
    uploadOk(),
    ok({ status: 'PROCESSING_UPLOAD' }),
    ok({ status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['post-9'] }),
  ]);

  const result = await tiktok.publish(account(), VIDEO);

  assert.deepEqual(result, { platform: 'tiktok', status: 'success', platformPostId: 'post-9' });

  const init = JSON.parse(String(calls[1]?.init.body)) as {
    post_info: { title: string; privacy_level: string };
    source_info: { source: string; video_size: number; total_chunk_count: number };
  };
  assert.equal(init.post_info.title, 'dancing badly');
  assert.equal(init.post_info.privacy_level, 'PUBLIC_TO_EVERYONE');
  assert.equal(init.source_info.source, 'FILE_UPLOAD');
  assert.equal(init.source_info.total_chunk_count, 1);

  const upload = calls[2];
  assert.equal(upload?.init.method, 'PUT');
  assert.equal(
    (upload?.init.headers as Record<string, string>)['Content-Range'],
    'bytes 0-999/1000',
  );
});

test('publish falls back to the only privacy level an unaudited app is offered', async () => {
  const { adapter: tiktok, calls } = adapter([
    creatorInfo(['SELF_ONLY']),
    initOk(),
    uploadOk(),
    ok({ status: 'PUBLISH_COMPLETE' }),
  ]);

  const result = await tiktok.publish(account(), VIDEO);

  assert.equal(result.status, 'success');
  // Private-only pre-audit is expected, not a failure.
  const init = JSON.parse(String(calls[1]?.init.body)) as { post_info: { privacy_level: string } };
  assert.equal(init.post_info.privacy_level, 'SELF_ONLY');
});

test('publish chunks a video too big for one request', async () => {
  const big = media(100 * 1024 * 1024);
  const { adapter: tiktok, calls } = adapter(
    [
      creatorInfo(['PUBLIC_TO_EVERYONE']),
      initOk(),
      ...Array.from({ length: 10 }, uploadOk),
      ok({ status: 'PUBLISH_COMPLETE' }),
    ],
    { media: big },
  );

  const result = await tiktok.publish(account(), VIDEO);

  assert.equal(result.status, 'success');
  const uploads = calls.filter((call) => call.init.method === 'PUT');
  assert.equal(uploads.length, 10);
  // The last chunk carries the remainder, so the ranges cover the whole file.
  assert.equal(
    (uploads.at(-1)?.init.headers as Record<string, string>)['Content-Range'],
    `bytes ${9 * 10 * 1024 * 1024}-${100 * 1024 * 1024 - 1}/${100 * 1024 * 1024}`,
  );
});

test('publish refuses a photo, because TikTok photo posts need a public URL', async () => {
  const { adapter: tiktok, calls } = adapter([]);

  const result = await tiktok.publish(account(), {
    ...VIDEO,
    mediaType: 'image',
    mediaUri: 'file:///tmp/photo.jpg',
  });

  assert.equal(result.status, 'failure');
  assert.match(result.error ?? '', /unsupported media type/);
  assert.equal(calls.length, 0);
});

test('publish reports a publish TikTok failed', async () => {
  const { adapter: tiktok } = adapter([
    creatorInfo(['SELF_ONLY']),
    initOk(),
    uploadOk(),
    ok({ status: 'FAILED', fail_reason: 'video_format_check_failed' }),
  ]);

  const result = await tiktok.publish(account(), VIDEO);

  assert.equal(result.status, 'failure');
  assert.equal(result.error, 'video_format_check_failed');
});

test('publish treats an error envelope on a 200 as a failure', async () => {
  const { adapter: tiktok } = adapter([
    Response.json({ error: { code: 'spam_risk_too_many_posts', message: 'Daily post cap reached' } }),
  ]);

  const result = await tiktok.publish(account(), VIDEO);

  assert.equal(result.status, 'failure');
  assert.equal(result.error, 'Daily post cap reached');
});

test('publish turns a rejected token into a reconnect failure', async () => {
  const { adapter: tiktok } = adapter([
    Response.json({ error: { code: 'access_token_invalid', message: 'expired' } }, { status: 401 }),
  ]);

  const result = await tiktok.publish(account(), VIDEO);

  assert.equal(result.status, 'failure');
  assert.equal(result.needsReconnect, true);
});

test('refreshTokenIfNeeded goes through the server and keeps the rotated token', async () => {
  let asked = 0;
  const { adapter: tiktok } = adapter([], {
    refresh: async () => {
      asked += 1;
      return { accessToken: 'fresh', refreshToken: 'rotated', expiresAt: NOW + 86_400_000 };
    },
  });

  const refreshed = await tiktok.refreshTokenIfNeeded(account({ expiresAt: NOW - 1 }));

  assert.equal(asked, 1);
  assert.equal(refreshed.accessToken, 'fresh');
  assert.equal(refreshed.refreshToken, 'rotated');
});

test('refreshTokenIfNeeded asks for a reconnect when the server refresh fails', async () => {
  const { adapter: tiktok } = adapter([], {
    refresh: async () => {
      throw new Error('Authorization code expired');
    },
  });

  await assert.rejects(
    () => tiktok.refreshTokenIfNeeded(account({ expiresAt: NOW - 1 })),
    ReconnectRequiredError,
  );
});

test('refreshTokenIfNeeded leaves a fresh token untouched', async () => {
  const { adapter: tiktok } = adapter([], {
    refresh: async () => {
      throw new Error('should not be called');
    },
  });
  const fresh = account();

  assert.equal(await tiktok.refreshTokenIfNeeded(fresh), fresh);
});

test('verifyConnection rejects a sign-in without the posting scope', async () => {
  const { adapter: tiktok, calls } = adapter([]);

  const result = await tiktok.verifyConnection(account({ grantedScopes: ['user.info.basic'] }));

  assert.equal(result.verified, false);
  assert.equal(result.needsReconnect, true);
  assert.equal(calls.length, 0);
});

test('verifyConnection passes a live token', async () => {
  const { adapter: tiktok } = adapter([ok({ user: { open_id: 'open-1' } })]);

  assert.equal((await tiktok.verifyConnection(account())).verified, true);
});
