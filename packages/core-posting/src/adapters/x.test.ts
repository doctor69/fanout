import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ReconnectRequiredError } from '../errors';
import type { Account, MediaFile, PostContent } from '../types';
import { createXAdapter, X_POSTING_SCOPES } from './x';

const NOW = 1_700_000_000_000;

function account(overrides: Partial<Account> = {}): Account {
  return {
    platform: 'x',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: NOW + 2 * 60 * 60 * 1000,
    externalUserId: '1234',
    grantedScopes: [...X_POSTING_SCOPES, 'users.read', 'offline.access'],
    ...overrides,
  };
}

const VIDEO: PostContent = {
  caption: 'shipping today',
  mediaUri: 'file:///tmp/clip.mp4',
  mediaType: 'video',
};

function media(size: number): MediaFile {
  return { data: new Blob(['x'.repeat(size)]), contentType: 'video/mp4', size };
}

interface Call {
  url: string;
  init: RequestInit;
}

function adapter(responses: Response[], mediaFile: MediaFile = media(10)) {
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
    adapter: createXAdapter({
      clientId: 'x-client-id',
      fetch: fetchImpl,
      readMedia: async () => mediaFile,
      now: () => NOW,
      sleep: async () => {},
    }),
  };
}

const initOk = () => Response.json({ data: { id: 'media-1' } });
const appendOk = () => new Response(null, { status: 204 });
const finalizeOk = (processing?: object) =>
  Response.json({ data: { id: 'media-1', ...(processing ? { processing_info: processing } : {}) } });
const tweetOk = () => Response.json({ data: { id: 'post-1' } });

test('publish uploads media then posts, and returns the post id', async () => {
  const { adapter: x, calls } = adapter([initOk(), appendOk(), finalizeOk(), tweetOk()]);

  const result = await x.publish(account(), VIDEO);

  assert.deepEqual(result, { platform: 'x', status: 'success', platformPostId: 'post-1' });
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      'https://api.x.com/2/media/upload/initialize',
      'https://api.x.com/2/media/upload/media-1/append',
      'https://api.x.com/2/media/upload/media-1/finalize',
      'https://api.x.com/2/tweets',
    ],
  );

  const init = JSON.parse(String(calls[0]?.init.body)) as Record<string, unknown>;
  assert.deepEqual(init, { media_type: 'video/mp4', total_bytes: 10, media_category: 'tweet_video' });

  const append = calls[1];
  assert.match(
    (append?.init.headers as Record<string, string>)['Content-Type'] ?? '',
    /^multipart\/form-data; boundary=/,
  );

  const tweet = JSON.parse(String(calls[3]?.init.body)) as Record<string, unknown>;
  assert.deepEqual(tweet, { text: 'shipping today', media: { media_ids: ['media-1'] } });
});

test('publish splits media over as many append calls as it takes', async () => {
  const twoAndABitChunks = 1024 * 1024 * 2 + 5;
  const { adapter: x, calls } = adapter(
    [initOk(), appendOk(), appendOk(), appendOk(), finalizeOk(), tweetOk()],
    media(twoAndABitChunks),
  );

  const result = await x.publish(account(), VIDEO);

  assert.equal(result.status, 'success');
  const appends = calls.filter((call) => call.url.endsWith('/append'));
  assert.equal(appends.length, 3);
});

test('publish waits for transcoding before posting', async () => {
  const { adapter: x, calls } = adapter([
    initOk(),
    appendOk(),
    finalizeOk({ state: 'in_progress', check_after_secs: 1 }),
    Response.json({ data: { processing_info: { state: 'in_progress', check_after_secs: 1 } } }),
    Response.json({ data: { processing_info: { state: 'succeeded' } } }),
    tweetOk(),
  ]);

  const result = await x.publish(account(), VIDEO);

  assert.equal(result.status, 'success');
  assert.equal(calls.filter((call) => call.url.includes('command=STATUS')).length, 2);
});

test('publish reports a video X failed to process', async () => {
  const { adapter: x } = adapter([
    initOk(),
    appendOk(),
    finalizeOk({ state: 'in_progress', check_after_secs: 1 }),
    Response.json({
      data: { processing_info: { state: 'failed', error: { message: 'InvalidMedia' } } },
    }),
  ]);

  const result = await x.publish(account(), VIDEO);

  assert.equal(result.status, 'failure');
  assert.equal(result.error, 'InvalidMedia');
  assert.equal(result.needsReconnect, undefined);
});

test('publish surfaces a rejected post without throwing', async () => {
  const { adapter: x } = adapter([
    initOk(),
    appendOk(),
    finalizeOk(),
    Response.json({ detail: 'Your Tweet text is too long.' }, { status: 400 }),
  ]);

  const result = await x.publish(account(), VIDEO);

  assert.equal(result.status, 'failure');
  assert.equal(result.error, 'Your Tweet text is too long.');
});

test('publish turns a rejected token into a reconnect failure', async () => {
  const { adapter: x } = adapter([Response.json({ title: 'Unauthorized' }, { status: 401 })]);

  const result = await x.publish(account(), VIDEO);

  assert.equal(result.status, 'failure');
  assert.equal(result.needsReconnect, true);
  assert.match(result.error ?? '', /Reconnect X/);
});

test('refreshTokenIfNeeded keeps the rotated refresh token X sends back', async () => {
  const { adapter: x, calls } = adapter([
    Response.json({
      access_token: 'new-access',
      refresh_token: 'new-refresh',
      expires_in: 7200,
      scope: 'tweet.write media.write users.read offline.access',
    }),
  ]);

  const refreshed = await x.refreshTokenIfNeeded(account({ expiresAt: NOW - 1 }));

  assert.equal(refreshed.accessToken, 'new-access');
  // X rotates refresh tokens — keeping the old one would break the next refresh.
  assert.equal(refreshed.refreshToken, 'new-refresh');
  assert.equal(refreshed.expiresAt, NOW + 7200 * 1000);
  assert.doesNotMatch(String(calls[0]?.init.body), /client_secret/);
});

test('refreshTokenIfNeeded leaves a fresh token untouched', async () => {
  const { adapter: x, calls } = adapter([]);
  const fresh = account();

  assert.equal(await x.refreshTokenIfNeeded(fresh), fresh);
  assert.equal(calls.length, 0);
});

test('refreshTokenIfNeeded asks for a reconnect when the refresh token is dead', async () => {
  const { adapter: x } = adapter([
    Response.json({ error_description: 'Invalid request' }, { status: 400 }),
  ]);

  await assert.rejects(
    () => x.refreshTokenIfNeeded(account({ expiresAt: NOW - 1 })),
    ReconnectRequiredError,
  );
});

test('verifyConnection passes a live token holding the posting scopes', async () => {
  const { adapter: x, calls } = adapter([Response.json({ data: { id: '1234', name: 'Doctor' } })]);

  const result = await x.verifyConnection(account());

  assert.equal(result.verified, true);
  assert.equal(calls[0]?.url, 'https://api.x.com/2/users/me');
});

test('verifyConnection rejects a sign-in that withheld a posting scope', async () => {
  const { adapter: x, calls } = adapter([]);

  const result = await x.verifyConnection(
    account({ grantedScopes: ['tweet.read', 'tweet.write', 'users.read'] }),
  );

  assert.equal(result.verified, false);
  assert.equal(result.needsReconnect, true);
  assert.match(result.error ?? '', /media\.write/);
  assert.equal(calls.length, 0, 'a missing scope is knowable without a network call');
});

test('verifyConnection rejects a token X no longer accepts', async () => {
  const { adapter: x } = adapter([Response.json({ title: 'Unauthorized' }, { status: 401 })]);

  const result = await x.verifyConnection(account());

  assert.equal(result.verified, false);
  assert.equal(result.needsReconnect, true);
});
