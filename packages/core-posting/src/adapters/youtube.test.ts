import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ReconnectRequiredError } from '../errors';
import type { Account, MediaFile, PostContent } from '../types';
import { createYouTubeAdapter } from './youtube';

const NOW = 1_700_000_000_000;

function account(overrides: Partial<Account> = {}): Account {
  return {
    platform: 'youtube',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: NOW + 60 * 60 * 1000,
    externalUserId: 'UC123',
    ...overrides,
  };
}

const VIDEO: PostContent = {
  caption: 'Launch day\nthe whole story',
  mediaUri: 'file:///tmp/clip.mp4',
  mediaType: 'video',
};

const MEDIA: MediaFile = { data: new Blob(['fake-bytes']), contentType: 'video/mp4', size: 10 };

interface Call {
  url: string;
  init: RequestInit;
}

/** Records requests and replies with the queued responses, in order. */
function stubFetch(responses: Response[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request to ${String(input)}`);
    return next;
  }) as unknown as typeof globalThis.fetch;

  return { calls, fetchImpl };
}

function header(call: Call, name: string): string | undefined {
  return (call.init.headers as Record<string, string> | undefined)?.[name];
}

function adapter(responses: Response[], overrides: Record<string, unknown> = {}) {
  const { calls, fetchImpl } = stubFetch(responses);
  const instance = createYouTubeAdapter({
    clientId: 'client-id.apps.googleusercontent.com',
    fetch: fetchImpl,
    readMedia: async () => MEDIA,
    now: () => NOW,
    ...overrides,
  });
  return { calls, adapter: instance };
}

test('exposes the youtube platform id', () => {
  assert.equal(adapter([]).adapter.platform, 'youtube');
});

test('refreshTokenIfNeeded returns the same object when the token is fresh', async () => {
  const { adapter: youtube, calls } = adapter([]);
  const fresh = account();

  assert.equal(await youtube.refreshTokenIfNeeded(fresh), fresh);
  assert.equal(calls.length, 0, 'a fresh token should not hit the network');
});

test('refreshTokenIfNeeded refreshes inside the 5 minute margin', async () => {
  const { adapter: youtube, calls } = adapter([
    Response.json({ access_token: 'new-token', expires_in: 3600 }),
  ]);
  const stale = account({ expiresAt: NOW + 60 * 1000 });

  const refreshed = await youtube.refreshTokenIfNeeded(stale);

  assert.notEqual(refreshed, stale, 'a refreshed account must be a new object');
  assert.equal(refreshed.accessToken, 'new-token');
  assert.equal(refreshed.expiresAt, NOW + 3600 * 1000);
  // Google usually omits refresh_token on refresh; the old one must survive.
  assert.equal(refreshed.refreshToken, 'refresh-token');
  assert.equal(refreshed.externalUserId, stale.externalUserId);

  assert.equal(calls[0]?.url, 'https://oauth2.googleapis.com/token');
  assert.match(String(calls[0]?.init.body), /grant_type=refresh_token/);
  assert.doesNotMatch(String(calls[0]?.init.body), /client_secret/);
});

test('refreshTokenIfNeeded asks for a reconnect when the refresh token is dead', async () => {
  const { adapter: youtube } = adapter([
    Response.json({ error: 'invalid_grant' }, { status: 400 }),
  ]);

  await assert.rejects(
    () => youtube.refreshTokenIfNeeded(account({ expiresAt: NOW - 1 })),
    (error: unknown) => {
      assert.ok(error instanceof ReconnectRequiredError);
      assert.match(error.message, /Reconnect YouTube/);
      return true;
    },
  );
});

test('refreshTokenIfNeeded asks for a reconnect when no refresh token was stored', async () => {
  const { adapter: youtube, calls } = adapter([]);
  const noRefresh = account({ expiresAt: NOW - 1, refreshToken: undefined });

  await assert.rejects(() => youtube.refreshTokenIfNeeded(noRefresh), ReconnectRequiredError);
  assert.equal(calls.length, 0);
});

test('publish uploads a video and returns its id', async () => {
  const { adapter: youtube, calls } = adapter([
    new Response(null, { status: 200, headers: { location: 'https://upload.example/session' } }),
    Response.json({ id: 'vid_123' }),
  ]);

  const result = await youtube.publish(account(), VIDEO);

  assert.deepEqual(result, {
    platform: 'youtube',
    status: 'success',
    platformPostId: 'vid_123',
  });

  const [session, upload] = calls;
  assert.match(session?.url ?? '', /uploadType=resumable/);
  assert.equal(header(session!, 'Authorization'), 'Bearer access-token');
  assert.equal(header(session!, 'X-Upload-Content-Length'), '10');
  assert.equal(header(session!, 'X-Upload-Content-Type'), 'video/mp4');

  const body = JSON.parse(String(session?.init.body)) as {
    snippet: { title: string; description: string };
    status: { privacyStatus: string };
  };
  // First caption line becomes the title; the whole caption is the description.
  assert.equal(body.snippet.title, 'Launch day');
  assert.equal(body.snippet.description, VIDEO.caption);
  assert.equal(body.status.privacyStatus, 'public');

  assert.equal(upload?.url, 'https://upload.example/session');
  assert.equal(upload?.init.method, 'PUT');
});

test('publish titles an untitled caption rather than sending an empty title', async () => {
  const { adapter: youtube, calls } = adapter([
    new Response(null, { status: 200, headers: { location: 'https://upload.example/session' } }),
    Response.json({ id: 'vid_124' }),
  ]);

  await youtube.publish(account(), { ...VIDEO, caption: '' });

  const body = JSON.parse(String(calls[0]?.init.body)) as { snippet: { title: string } };
  assert.equal(body.snippet.title, 'Untitled');
});

test('publish refuses an image without calling YouTube', async () => {
  const { adapter: youtube, calls } = adapter([]);

  const result = await youtube.publish(account(), {
    ...VIDEO,
    mediaType: 'image',
    mediaUri: 'file:///tmp/photo.jpg',
  });

  assert.equal(result.status, 'failure');
  assert.match(result.error ?? '', /unsupported media type/);
  assert.equal(result.needsReconnect, undefined);
  assert.equal(calls.length, 0);
});

test('publish turns a rejected token into a reconnect failure, not a throw', async () => {
  const { adapter: youtube } = adapter([Response.json({ error: 'invalid' }, { status: 401 })]);

  const result = await youtube.publish(account(), VIDEO);

  assert.equal(result.status, 'failure');
  assert.equal(result.needsReconnect, true);
  assert.match(result.error ?? '', /Reconnect YouTube/);
});

test('publish surfaces a content rejection as a readable failure', async () => {
  const { adapter: youtube } = adapter([
    Response.json(
      { error: { message: 'The request metadata specifies an invalid video title.' } },
      { status: 400 },
    ),
  ]);

  const result = await youtube.publish(account(), VIDEO);

  assert.equal(result.status, 'failure');
  assert.equal(result.error, 'The request metadata specifies an invalid video title.');
  assert.equal(result.needsReconnect, undefined);
});

test('publish reports an upload that returns no video id', async () => {
  const { adapter: youtube } = adapter([
    new Response(null, { status: 200, headers: { location: 'https://upload.example/session' } }),
    Response.json({}),
  ]);

  const result = await youtube.publish(account(), VIDEO);

  assert.equal(result.status, 'failure');
  assert.match(result.error ?? '', /no video id/);
});
