import {
  EXCHANGE_PLATFORMS,
  ExchangeError,
  exchangeCode,
  refreshAccessToken,
  type Env,
  type ExchangePlatform,
  type ExchangeResult,
} from './platforms';

/**
 * The one small serverless function this repo needs (specs/03-auth-and-oauth.md).
 *
 * It does exactly one job: trade an authorization code — or a refresh token —
 * for an access token, using a client secret that must never ship inside the
 * app bundle. It stores nothing, and it logs neither tokens nor secrets.
 *
 *   POST /token-exchange  { platform, code, codeVerifier?, redirectUri }
 *   POST /token-refresh   { platform, refreshToken }
 *   → { accessToken, refreshToken?, expiresAt, grantedScopes?, externalUserId? }
 */

interface RequestBody {
  platform?: string;
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
  refreshToken?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function isExchangePlatform(value: unknown): value is ExchangePlatform {
  return typeof value === 'string' && (EXCHANGE_PLATFORMS as string[]).includes(value);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname !== '/token-exchange' && pathname !== '/token-refresh') {
      return json({ error: 'Not found' }, 404);
    }
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    let body: RequestBody;
    try {
      body = (await request.json()) as RequestBody;
    } catch {
      return json({ error: 'Body must be JSON' }, 400);
    }

    if (!isExchangePlatform(body.platform)) {
      return json(
        { error: `platform must be one of: ${EXCHANGE_PLATFORMS.join(', ')}` },
        400,
      );
    }

    try {
      const shared = {
        platform: body.platform,
        env,
        now: Date.now(),
        fetchImpl: fetch,
        ...(body.code ? { code: body.code } : {}),
        ...(body.codeVerifier ? { codeVerifier: body.codeVerifier } : {}),
        ...(body.redirectUri ? { redirectUri: body.redirectUri } : {}),
        ...(body.refreshToken ? { refreshToken: body.refreshToken } : {}),
      };

      const result: ExchangeResult =
        pathname === '/token-exchange'
          ? await exchangeCode(shared)
          : await refreshAccessToken(shared);

      if (!result.accessToken) {
        return json({ error: 'The platform returned no access token' }, 502);
      }

      return json(result);
    } catch (error) {
      if (error instanceof ExchangeError) {
        return json({ error: error.message }, error.status);
      }
      // Deliberately vague: an unexpected error must not leak request detail,
      // and nothing here is logged, because everything here is a credential.
      return json({ error: 'Token exchange failed' }, 502);
    }
  },
};
