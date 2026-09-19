import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ReconnectRequiredError } from '../errors';
import type { Account, MediaFile, PostContent } from '../types';
import { createLinkedInAdapter, LINKEDIN_DEFAULT_VERSION } from './linkedin';

const NOW = 1_700_000_000_000;

function account(overrides: Partial<Account> = {}): Account {
  return {
    platform: 'linkedin',
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresAt: NOW + 60 * 24 * 60 * 60 * 1000,
    externalUserId: 'member-1',
    grantedScopes: ['openid', 'profile', 'w_member_social'],
    ...overrides,
  };
}

const IMAGE: PostContent = {
  caption: 'thoughts on shipping',
  mediaUri: 'file:///tmp/p.jpg',
  mediaType: 'image',
};
const VIDEO: PostContent = { ...IMAGE, mediaUri: 'file:///tmp/clip.mp4', mediaType: 'video' };

function media(size = 8, contentType = 'image/jpeg'): MediaFile {
  return { data: new Blob(['x'.repeat(size)]), contentType, size };
}

interface Call {
  url: string;
  init: RequestInit;
}

function adapter(responses: Response[], mediaFile = media(), refresh?: () => Promise<never>) {
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
    adapter: createLinkedInAdapter({
      fetch: fetchImpl,
      readMedia: async () => mediaFile,
      now: () => NOW,
      refreshViaServer:
        refresh ?? (async () => ({ accessToken: 'fresh', expiresAt: NOW + 5_184_000_000 })),
    }),
  };
}

const postedOk = () => new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:99' } });

test('publish uploads an image then creates the post', async () => {
  const { adapter: linkedin, calls } = adapter([
    Response.json({ value: { uploadUrl: 'https://upload.li/1', image: 'urn:li:image:abc' } }),
    new Response(null, { status: 201 }),
    postedOk(),
  ]);

  const result = await linkedin.publish(account(), IMAGE);

  assert.deepEqual(result, {
    platform: 'linkedin',
    status: 'success',
    platformPostId: 'urn:li:share:99',
  });

  assert.equal(calls[0]?.url, 'https://api.linkedin.com/rest/images?action=initializeUpload');
  const initHeaders = calls[0]?.init.headers as Record<string, string>;
  assert.equal(initHeaders['LinkedIn-Version'], LINKEDIN_DEFAULT_VERSION);
  assert.equal(initHeaders['X-Restli-Protocol-Version'], '2.0.0');

  const body = JSON.parse(String(calls[2]?.init.body)) as Record<string, unknown>;
  assert.equal(body.author, 'urn:li:person:member-1');
  assert.equal(body.commentary, 'thoughts on shipping');
  assert.deepEqual(body.content, { media: { id: 'urn:li:image:abc' } });
});

test('publish uploads a video part by part and returns the ETags on finalize', async () => {
  const { adapter: linkedin, calls } = adapter(
    [
      Response.json({
        value: {
          video: 'urn:li:video:xyz',
          uploadToken: 'token-1',
          uploadInstructions: [
            { uploadUrl: 'https://upload.li/part1', firstByte: 0, lastByte: 3 },
            { uploadUrl: 'https://upload.li/part2', firstByte: 4, lastByte: 7 },
          ],
        },
      }),
      new Response(null, { status: 200, headers: { etag: 'etag-1' } }),
      new Response(null, { status: 200, headers: { etag: 'etag-2' } }),
      new Response(null, { status: 200 }),
      postedOk(),
    ],
    media(8, 'video/mp4'),
  );

  const result = await linkedin.publish(account(), VIDEO);

  assert.equal(result.status, 'success');

  const finalize = JSON.parse(String(calls[3]?.init.body)) as {
    finalizeUploadRequest: { video: string; uploadToken: string; uploadedPartIds: string[] };
  };
  assert.equal(finalize.finalizeUploadRequest.video, 'urn:li:video:xyz');
  assert.equal(finalize.finalizeUploadRequest.uploadToken, 'token-1');
  assert.deepEqual(finalize.finalizeUploadRequest.uploadedPartIds, ['etag-1', 'etag-2']);
});

test('publish fails clearly when LinkedIn does not acknowledge a part', async () => {
  const { adapter: linkedin } = adapter(
    [
      Response.json({
        value: {
          video: 'urn:li:video:xyz',
          uploadToken: 'token-1',
          uploadInstructions: [{ uploadUrl: 'https://upload.li/part1', firstByte: 0, lastByte: 7 }],
        },
      }),
      new Response(null, { status: 200 }),
    ],
    media(8, 'video/mp4'),
  );

  const result = await linkedin.publish(account(), VIDEO);

  assert.equal(result.status, 'failure');
  assert.match(result.error ?? '', /did not acknowledge/);
});

test('publish surfaces a rejected post as a failure', async () => {
  const { adapter: linkedin } = adapter([
    Response.json({ value: { uploadUrl: 'https://upload.li/1', image: 'urn:li:image:abc' } }),
    new Response(null, { status: 201 }),
    Response.json({ message: 'Commentary exceeds the maximum length' }, { status: 422 }),
  ]);

  const result = await linkedin.publish(account(), IMAGE);

  assert.equal(result.status, 'failure');
  assert.equal(result.error, 'Commentary exceeds the maximum length');
});

test('publish turns a rejected token into a reconnect failure', async () => {
  const { adapter: linkedin } = adapter([new Response(null, { status: 401 })]);

  const result = await linkedin.publish(account(), IMAGE);

  assert.equal(result.status, 'failure');
  assert.equal(result.needsReconnect, true);
});

test('an author id that is already a URN is not wrapped twice', async () => {
  const { adapter: linkedin, calls } = adapter([
    Response.json({ value: { uploadUrl: 'https://upload.li/1', image: 'urn:li:image:abc' } }),
    new Response(null, { status: 201 }),
    postedOk(),
  ]);

  await linkedin.publish(account({ externalUserId: 'urn:li:person:member-1' }), IMAGE);

  const body = JSON.parse(String(calls[2]?.init.body)) as { author: string };
  assert.equal(body.author, 'urn:li:person:member-1');
});

test('refreshTokenIfNeeded goes through the server', async () => {
  const { adapter: linkedin } = adapter([]);

  const refreshed = await linkedin.refreshTokenIfNeeded(account({ expiresAt: NOW + 1000 }));

  assert.equal(refreshed.accessToken, 'fresh');
  // LinkedIn doesn't always reissue one; the stored token must survive.
  assert.equal(refreshed.refreshToken, 'refresh-token');
});

test('refreshTokenIfNeeded asks for a reconnect when no refresh token was issued', async () => {
  const { adapter: linkedin } = adapter([]);

  await assert.rejects(
    () => linkedin.refreshTokenIfNeeded(account({ expiresAt: NOW + 1000, refreshToken: undefined })),
    ReconnectRequiredError,
  );
});

test('verifyConnection rejects a sign-in without posting permission', async () => {
  const { adapter: linkedin, calls } = adapter([]);

  const result = await linkedin.verifyConnection(account({ grantedScopes: ['openid', 'profile'] }));

  assert.equal(result.verified, false);
  assert.equal(result.needsReconnect, true);
  assert.equal(calls.length, 0);
});

test('verifyConnection passes a live token', async () => {
  const { adapter: linkedin, calls } = adapter([Response.json({ sub: 'member-1' })]);

  assert.equal((await linkedin.verifyConnection(account())).verified, true);
  assert.equal(calls[0]?.url, 'https://api.linkedin.com/v2/userinfo');
});
