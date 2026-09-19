import assert from 'node:assert/strict';
import { test } from 'node:test';

import worker from './index';
import type { Env } from './platforms';

const ENV: Env = {
  TIKTOK_CLIENT_KEY: 'tiktok-key',
  TIKTOK_CLIENT_SECRET: 'tiktok-secret',
  META_APP_ID: 'meta-id',
  META_APP_SECRET: 'meta-secret',
  LINKEDIN_CLIENT_ID: 'linkedin-id',
  LINKEDIN_CLIENT_SECRET: 'linkedin-secret',
};

interface Call {
  url: string;
  body: URLSearchParams;
}

/** Swaps global fetch for the duration of one call, recording what was sent. */
async function withFetch<T>(
  responses: Response[],
  run: (calls: Call[]) => Promise<T>,
): Promise<T> {
  const calls: Call[] = [];
  const queue = [...responses];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), body: new URLSearchParams(String(init.body ?? '')) });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request to ${String(input)}`);
    return next;
  }) as typeof globalThis.fetch;

  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function post(path: string, body: unknown): Request {
  return new Request(`https://fn.example${path}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

test('exchanges a TikTok code, passing the code verifier and the secret', async () => {
  await withFetch(
    [
      Response.json({
        access_token: 'tt-access',
        refresh_token: 'tt-refresh',
        expires_in: 86400,
        scope: 'user.info.basic,video.publish',
        open_id: 'open-1',
      }),
    ],
    async (calls) => {
      const response = await worker.fetch(
        post('/token-exchange', {
          platform: 'tiktok',
          code: 'auth-code',
          codeVerifier: 'verifier',
          redirectUri: 'fanout:/oauth/tiktok',
        }),
        ENV,
      );

      assert.equal(response.status, 200);
      const result = (await response.json()) as Record<string, unknown>;
      assert.equal(result.accessToken, 'tt-access');
      assert.equal(result.refreshToken, 'tt-refresh');
      assert.equal(result.externalUserId, 'open-1');
      assert.deepEqual(result.grantedScopes, ['user.info.basic', 'video.publish']);
      assert.ok((result.expiresAt as number) > Date.now());

      const sent = calls[0];
      assert.equal(sent?.url, 'https://open.tiktokapis.com/v2/oauth/token/');
      // TikTok calls it client_key, not client_id.
      assert.equal(sent?.body.get('client_key'), 'tiktok-key');
      assert.equal(sent?.body.get('client_secret'), 'tiktok-secret');
      assert.equal(sent?.body.get('code_verifier'), 'verifier');
    },
  );
});

test('trades a Meta code for a long-lived token, not the short-lived one', async () => {
  await withFetch(
    [
      Response.json({ access_token: 'short', expires_in: 3600 }),
      Response.json({ access_token: 'long', expires_in: 5184000 }),
    ],
    async (calls) => {
      const response = await worker.fetch(
        post('/token-exchange', {
          platform: 'instagram',
          code: 'auth-code',
          redirectUri: 'fanout:/oauth/instagram',
        }),
        ENV,
      );

      const result = (await response.json()) as Record<string, unknown>;
      assert.equal(result.accessToken, 'long');
      assert.equal(calls.length, 2);
      assert.equal(calls[1]?.body.get('grant_type'), 'fb_exchange_token');
      assert.equal(calls[1]?.body.get('fb_exchange_token'), 'short');
    },
  );
});

test('refreshes a LinkedIn token', async () => {
  await withFetch(
    [Response.json({ access_token: 'li-new', refresh_token: 'li-r2', expires_in: 5184000 })],
    async (calls) => {
      const response = await worker.fetch(
        post('/token-refresh', { platform: 'linkedin', refreshToken: 'li-r1' }),
        ENV,
      );

      const result = (await response.json()) as Record<string, unknown>;
      assert.equal(result.accessToken, 'li-new');
      assert.equal(result.refreshToken, 'li-r2');
      assert.equal(calls[0]?.body.get('grant_type'), 'refresh_token');
      assert.equal(calls[0]?.body.get('client_secret'), 'linkedin-secret');
    },
  );
});

test('passes the platform error through without leaking the request', async () => {
  await withFetch(
    [Response.json({ error_description: 'Authorization code expired' }, { status: 400 })],
    async () => {
      const response = await worker.fetch(
        post('/token-exchange', {
          platform: 'tiktok',
          code: 'stale',
          redirectUri: 'fanout:/oauth/tiktok',
        }),
        ENV,
      );

      assert.equal(response.status, 502);
      const body = await response.text();
      assert.match(body, /Authorization code expired/);
      assert.doesNotMatch(body, /tiktok-secret/);
    },
  );
});

test('names a missing credential without revealing any value', async () => {
  const response = await worker.fetch(
    post('/token-exchange', {
      platform: 'linkedin',
      code: 'c',
      redirectUri: 'fanout:/oauth/linkedin',
    }),
    { ...ENV, LINKEDIN_CLIENT_SECRET: undefined },
  );

  assert.equal(response.status, 500);
  const body = await response.text();
  assert.match(body, /LINKEDIN_CLIENT_ID\/SECRET is not configured/);
  assert.doesNotMatch(body, /linkedin-id/);
});

test('rejects anything that is not a known platform', async () => {
  const response = await worker.fetch(post('/token-exchange', { platform: 'youtube' }), ENV);

  assert.equal(response.status, 400);
  // YouTube and X are PKCE-only; routing them here would be a mistake.
  assert.match(await response.text(), /platform must be one of/);
});

test('rejects non-POST and unknown paths', async () => {
  const wrongMethod = await worker.fetch(
    new Request('https://fn.example/token-exchange'),
    ENV,
  );
  assert.equal(wrongMethod.status, 405);

  const unknown = await worker.fetch(post('/anything-else', { platform: 'tiktok' }), ENV);
  assert.equal(unknown.status, 404);
});

test('rejects a body that is not JSON', async () => {
  const response = await worker.fetch(
    new Request('https://fn.example/token-exchange', { method: 'POST', body: 'not json' }),
    ENV,
  );

  assert.equal(response.status, 400);
});
