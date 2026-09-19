/**
 * Per-platform token exchange. Everything here runs on the Worker and nowhere
 * else, because each of these platforms requires a client secret to turn an
 * authorization code into a token — which is the entire reason this function
 * exists (specs/03-auth-and-oauth.md).
 */

export type ExchangePlatform = 'tiktok' | 'instagram' | 'facebook' | 'linkedin';

export const EXCHANGE_PLATFORMS: ExchangePlatform[] = [
  'tiktok',
  'instagram',
  'facebook',
  'linkedin',
];

export interface Env {
  TIKTOK_CLIENT_KEY?: string;
  TIKTOK_CLIENT_SECRET?: string;
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
}

/** What the app gets back. Never includes anything derived from the secret. */
export interface ExchangeResult {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms. */
  expiresAt: number;
  grantedScopes?: string[];
  /** The platform's own user id, where the token response carries it. */
  externalUserId?: string;
}

export class ExchangeError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ExchangeError';
  }
}

function credentials(env: Env, platform: ExchangePlatform): { id: string; secret: string } {
  const pairs: Record<ExchangePlatform, [string | undefined, string | undefined, string]> = {
    tiktok: [env.TIKTOK_CLIENT_KEY, env.TIKTOK_CLIENT_SECRET, 'TIKTOK_CLIENT_KEY/SECRET'],
    instagram: [env.META_APP_ID, env.META_APP_SECRET, 'META_APP_ID/SECRET'],
    facebook: [env.META_APP_ID, env.META_APP_SECRET, 'META_APP_ID/SECRET'],
    linkedin: [env.LINKEDIN_CLIENT_ID, env.LINKEDIN_CLIENT_SECRET, 'LINKEDIN_CLIENT_ID/SECRET'],
  };

  const [id, secret, names] = pairs[platform];
  if (!id || !secret) {
    // Names the missing variable, never any value.
    throw new ExchangeError(500, `${names} is not configured on this function.`);
  }
  return { id, secret };
}

/** Reads an error out of a platform response without ever echoing our request. */
async function describe(response: Response): Promise<string> {
  let body = '';
  try {
    body = await response.text();
  } catch {
    // Fall through to the status line.
  }
  try {
    const parsed = JSON.parse(body) as {
      error?: string | { message?: string };
      error_description?: string;
      message?: string;
    };
    if (typeof parsed.error === 'object' && parsed.error?.message) return parsed.error.message;
    if (parsed.error_description) return parsed.error_description;
    if (typeof parsed.error === 'string') return parsed.error;
    if (parsed.message) return parsed.message;
  } catch {
    // Not JSON.
  }
  return body.slice(0, 300).trim() || `HTTP ${response.status}`;
}

async function postForm(
  url: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<Record<string, unknown>> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });

  if (!response.ok) {
    throw new ExchangeError(502, await describe(response));
  }
  return (await response.json()) as Record<string, unknown>;
}

function seconds(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function scopes(value: unknown): string[] | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  // TikTok comma-separates; everyone else uses spaces.
  return value.split(/[,\s]+/).filter(Boolean);
}

export interface ExchangeRequest {
  platform: ExchangePlatform;
  env: Env;
  code?: string;
  codeVerifier?: string;
  redirectUri?: string;
  refreshToken?: string;
  now: number;
  fetchImpl: typeof fetch;
}

const META_GRAPH = 'https://graph.facebook.com/v21.0/oauth/access_token';
const TIKTOK_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const LINKEDIN_TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken';

/**
 * Turns an authorization code into tokens.
 *
 * Meta is the odd one: the code buys a short-lived token (about an hour), so
 * it's immediately traded for a long-lived one (about 60 days). Meta issues no
 * refresh token — refreshing means re-trading a still-valid long-lived token,
 * which is what refreshToken() does below.
 */
export async function exchangeCode(request: ExchangeRequest): Promise<ExchangeResult> {
  const { platform, code, codeVerifier, redirectUri, now, fetchImpl } = request;
  if (!code) throw new ExchangeError(400, 'code is required');

  const { id, secret } = credentials(request.env, platform);

  if (platform === 'tiktok') {
    if (!redirectUri) throw new ExchangeError(400, 'redirectUri is required for tiktok');
    const token = await postForm(
      TIKTOK_TOKEN,
      {
        client_key: id,
        client_secret: secret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      },
      fetchImpl,
    );
    return {
      accessToken: String(token.access_token ?? ''),
      ...(token.refresh_token ? { refreshToken: String(token.refresh_token) } : {}),
      expiresAt: now + seconds(token.expires_in, 86_400) * 1000,
      ...(scopes(token.scope) ? { grantedScopes: scopes(token.scope) } : {}),
      ...(token.open_id ? { externalUserId: String(token.open_id) } : {}),
    };
  }

  if (platform === 'linkedin') {
    if (!redirectUri) throw new ExchangeError(400, 'redirectUri is required for linkedin');
    const token = await postForm(
      LINKEDIN_TOKEN,
      {
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: id,
        client_secret: secret,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
      },
      fetchImpl,
    );
    return {
      accessToken: String(token.access_token ?? ''),
      ...(token.refresh_token ? { refreshToken: String(token.refresh_token) } : {}),
      expiresAt: now + seconds(token.expires_in, 5_184_000) * 1000,
      ...(scopes(token.scope) ? { grantedScopes: scopes(token.scope) } : {}),
    };
  }

  // Meta: Facebook and Instagram share one app and one token endpoint.
  if (!redirectUri) throw new ExchangeError(400, `redirectUri is required for ${platform}`);
  const shortLived = await postForm(
    META_GRAPH,
    { client_id: id, client_secret: secret, redirect_uri: redirectUri, code },
    fetchImpl,
  );
  const shortToken = String(shortLived.access_token ?? '');
  if (!shortToken) throw new ExchangeError(502, 'Meta returned no access token');

  const longLived = await postForm(
    META_GRAPH,
    {
      grant_type: 'fb_exchange_token',
      client_id: id,
      client_secret: secret,
      fb_exchange_token: shortToken,
    },
    fetchImpl,
  );

  return {
    accessToken: String(longLived.access_token ?? shortToken),
    expiresAt: now + seconds(longLived.expires_in, 5_184_000) * 1000,
  };
}

/**
 * Renews a token that is still valid but nearing expiry. Only the platforms
 * needing a secret come through here; the PKCE platforms refresh on-device.
 */
export async function refreshAccessToken(request: ExchangeRequest): Promise<ExchangeResult> {
  const { platform, refreshToken, now, fetchImpl } = request;
  const { id, secret } = credentials(request.env, platform);

  if (platform === 'tiktok') {
    if (!refreshToken) throw new ExchangeError(400, 'refreshToken is required');
    const token = await postForm(
      TIKTOK_TOKEN,
      {
        client_key: id,
        client_secret: secret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      },
      fetchImpl,
    );
    return {
      accessToken: String(token.access_token ?? ''),
      // TikTok rotates refresh tokens.
      ...(token.refresh_token ? { refreshToken: String(token.refresh_token) } : {}),
      expiresAt: now + seconds(token.expires_in, 86_400) * 1000,
      ...(scopes(token.scope) ? { grantedScopes: scopes(token.scope) } : {}),
    };
  }

  if (platform === 'linkedin') {
    if (!refreshToken) throw new ExchangeError(400, 'refreshToken is required');
    const token = await postForm(
      LINKEDIN_TOKEN,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: id,
        client_secret: secret,
      },
      fetchImpl,
    );
    return {
      accessToken: String(token.access_token ?? ''),
      ...(token.refresh_token ? { refreshToken: String(token.refresh_token) } : {}),
      expiresAt: now + seconds(token.expires_in, 5_184_000) * 1000,
    };
  }

  // Meta has no refresh token: a long-lived token is re-exchanged for another
  // one while it is still valid. The app sends its current access token as
  // refreshToken for this call.
  if (!refreshToken) throw new ExchangeError(400, 'refreshToken (the current token) is required');
  const token = await postForm(
    META_GRAPH,
    {
      grant_type: 'fb_exchange_token',
      client_id: id,
      client_secret: secret,
      fb_exchange_token: refreshToken,
    },
    fetchImpl,
  );
  return {
    accessToken: String(token.access_token ?? ''),
    expiresAt: now + seconds(token.expires_in, 5_184_000) * 1000,
  };
}
