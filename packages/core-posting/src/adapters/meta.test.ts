import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ReconnectRequiredError } from '../errors';
import type { Account, MediaFile, PostContent } from '../types';
import { createMetaAdapter, type MetaPlatform } from './meta';

const NOW = 1_700_000_000_000;

function account(platform: MetaPlatform, overrides: Partial<Account> = {}): Account {
  return {
    platform,
    // The Page token posts; the user token is what a new Page token comes from.
    accessToken: 'page-token',
    refreshToken: 'long-lived-user-token',
    expiresAt: NOW + 60 * 24 * 60 * 60 * 1000,
    externalUserId: platform === 'facebook' ? 'page-1' : 'ig-1',
    ...overrides,
  };
}

const VIDEO: PostContent = {
  caption: 'new drop',
  mediaUri: 'file:///tmp/clip.mp4',
  mediaType: 'video',
};
const PHOTO: PostContent = { ...VIDEO, mediaUri: 'file:///tmp/p.jpg', mediaType: 'image' };

const MEDIA: MediaFile = { data: new Blob(['bytes']), contentType: 'video/mp4', size: 5 };

interface Call {
  url: string;
  init: RequestInit;
}

function adapter(platform: MetaPlatform, responses: Response[], refresh?: () => Promise<never>) {
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
    adapter: createMetaAdapter({
      platform,
      fetch: fetchImpl,
      readMedia: async () => MEDIA,
      now: () => NOW,
      sleep: async () => {},
      refreshViaServer:
        refresh ??
        (async () => ({ accessToken: 'fresh-user-token', expiresAt: NOW + 5_184_000_000 })),
    }),
  };
}

test('facebook posts a video to the page with the bytes attached', async () => {
  const { adapter: facebook, calls } = adapter('facebook', [Response.json({ id: 'fb-post-1' })]);

  const result = await facebook.publish(account('facebook'), VIDEO);

  assert.deepEqual(result, { platform: 'facebook', status: 'success', platformPostId: 'fb-post-1' });
  assert.equal(calls[0]?.url, 'https://graph.facebook.com/v21.0/page-1/videos');
  assert.match(
    (calls[0]?.init.headers as Record<string, string>)['Content-Type'] ?? '',
    /^multipart\/form-data; boundary=/,
  );
});

test('facebook posts a photo to the photos edge and prefers the post id', async () => {
  const { adapter: facebook, calls } = adapter('facebook', [
    Response.json({ id: 'photo-1', post_id: 'fb-post-2' }),
  ]);

  const result = await facebook.publish(account('facebook'), PHOTO);

  assert.equal(result.platformPostId, 'fb-post-2');
  assert.equal(calls[0]?.url, 'https://graph.facebook.com/v21.0/page-1/photos');
});

test('instagram creates a container, uploads, waits, then publishes', async () => {
  const { adapter: instagram, calls } = adapter('instagram', [
    Response.json({ id: 'container-1' }),
    new Response(null, { status: 200 }),
    Response.json({ status_code: 'IN_PROGRESS' }),
    Response.json({ status_code: 'FINISHED' }),
    Response.json({ id: 'ig-post-1' }),
  ]);

  const result = await instagram.publish(account('instagram'), VIDEO);

  assert.deepEqual(result, {
    platform: 'instagram',
    status: 'success',
    platformPostId: 'ig-post-1',
  });

  const container = JSON.parse(String(calls[0]?.init.body)) as Record<string, string>;
  assert.equal(container.media_type, 'REELS');
  assert.equal(container.upload_type, 'resumable');
  assert.equal(container.caption, 'new drop');

  // The upload endpoint is a different host and wants the OAuth scheme.
  assert.equal(calls[1]?.url, 'https://rupload.facebook.com/ig-api-upload/v21.0/container-1');
  const uploadHeaders = calls[1]?.init.headers as Record<string, string>;
  assert.equal(uploadHeaders.Authorization, 'OAuth page-token');
  assert.equal(uploadHeaders.file_size, '5');

  assert.equal(calls[4]?.url, 'https://graph.facebook.com/v21.0/ig-1/media_publish');
});

test('instagram refuses a photo, which would need a public URL', async () => {
  const { adapter: instagram, calls } = adapter('instagram', []);

  const result = await instagram.publish(account('instagram'), PHOTO);

  assert.equal(result.status, 'failure');
  assert.match(result.error ?? '', /unsupported media type/);
  assert.equal(calls.length, 0);
});

test('instagram reports a video it could not process', async () => {
  const { adapter: instagram } = adapter('instagram', [
    Response.json({ id: 'container-1' }),
    new Response(null, { status: 200 }),
    Response.json({ status_code: 'ERROR', status: 'Video is too long' }),
  ]);

  const result = await instagram.publish(account('instagram'), VIDEO);

  assert.equal(result.status, 'failure');
  assert.equal(result.error, 'Video is too long');
});

test('a graph error becomes a readable failure rather than a throw', async () => {
  const { adapter: facebook } = adapter('facebook', [
    Response.json({ error: { message: 'Page does not allow posting', code: 200 } }, { status: 403 }),
  ]);

  const result = await facebook.publish(account('facebook'), VIDEO);

  assert.equal(result.status, 'failure');
  assert.equal(result.error, 'Page does not allow posting');
  assert.equal(result.needsReconnect, undefined);
});

test('an expired token (graph code 190) asks for a reconnect', async () => {
  const { adapter: facebook } = adapter('facebook', [
    Response.json({ error: { message: 'Session has expired', code: 190 } }, { status: 400 }),
  ]);

  const result = await facebook.publish(account('facebook'), VIDEO);

  assert.equal(result.status, 'failure');
  assert.equal(result.needsReconnect, true);
});

test('refresh renews the user token and re-derives the page token from it', async () => {
  const { adapter: facebook, calls } = adapter('facebook', [
    Response.json({
      data: [
        { id: 'other-page', access_token: 'wrong-token' },
        { id: 'page-1', access_token: 'new-page-token' },
      ],
    }),
  ]);

  const refreshed = await facebook.refreshTokenIfNeeded(
    account('facebook', { expiresAt: NOW + 1000 }),
  );

  assert.equal(refreshed.accessToken, 'new-page-token');
  assert.equal(refreshed.refreshToken, 'fresh-user-token');
  assert.match(calls[0]?.url ?? '', /\/me\/accounts/);
});

test('refresh picks the page by its linked instagram account for instagram', async () => {
  const { adapter: instagram } = adapter('instagram', [
    Response.json({
      data: [
        { id: 'page-9', access_token: 'nope' },
        { id: 'page-1', access_token: 'ig-page-token', instagram_business_account: { id: 'ig-1' } },
      ],
    }),
  ]);

  const refreshed = await instagram.refreshTokenIfNeeded(
    account('instagram', { expiresAt: NOW + 1000 }),
  );

  assert.equal(refreshed.accessToken, 'ig-page-token');
});

test('refresh asks for a reconnect when the account is no longer listed', async () => {
  const { adapter: facebook } = adapter('facebook', [Response.json({ data: [] })]);

  await assert.rejects(
    () => facebook.refreshTokenIfNeeded(account('facebook', { expiresAt: NOW + 1000 })),
    ReconnectRequiredError,
  );
});

test('a token with weeks left is left alone', async () => {
  const { adapter: facebook, calls } = adapter('facebook', []);
  const fresh = account('facebook');

  assert.equal(await facebook.refreshTokenIfNeeded(fresh), fresh);
  assert.equal(calls.length, 0);
});

test('verifyConnection reads the target back with the page token', async () => {
  const { adapter: instagram, calls } = adapter('instagram', [
    Response.json({ id: 'ig-1', username: 'doctor' }),
  ]);

  const result = await instagram.verifyConnection(account('instagram'));

  assert.equal(result.verified, true);
  assert.match(calls[0]?.url ?? '', /\/ig-1\?fields=id,username/);
});

test('verifyConnection fails a token Meta no longer accepts', async () => {
  const { adapter: facebook } = adapter('facebook', [
    Response.json({ error: { message: 'Session has expired', code: 190 } }, { status: 400 }),
  ]);

  const result = await facebook.verifyConnection(account('facebook'));

  assert.equal(result.verified, false);
  assert.equal(result.needsReconnect, true);
});
