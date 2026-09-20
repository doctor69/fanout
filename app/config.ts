import type { Platform } from '@fanout/core-posting';

/**
 * Runtime configuration. EXPO_PUBLIC_* values are inlined at bundle time and
 * read from `.env` in development (see `.env.example`).
 *
 * Only *public* identifiers belong here. No platform client secret ever ships
 * in the app bundle — Meta's and LinkedIn's live as environment variables on
 * /functions/token-exchange (CLAUDE.md, specs/03-auth-and-oauth.md). YouTube
 * needs no secret at all: it uses an installed-app client with PKCE.
 */

export const GOOGLE_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID ?? '';
export const X_CLIENT_ID = process.env.EXPO_PUBLIC_X_CLIENT_ID ?? '';
export const TIKTOK_CLIENT_KEY = process.env.EXPO_PUBLIC_TIKTOK_CLIENT_KEY ?? '';

export const META_APP_ID = process.env.EXPO_PUBLIC_META_APP_ID ?? '';
export const LINKEDIN_CLIENT_ID = process.env.EXPO_PUBLIC_LINKEDIN_CLIENT_ID ?? '';

/**
 * Base URL of the deployed /functions/token-exchange Worker. Public by design:
 * it holds the secrets so the app doesn't have to.
 */
export const TOKEN_EXCHANGE_URL = process.env.EXPO_PUBLIC_TOKEN_EXCHANGE_URL ?? '';

function required(value: string, name: string, detail: string): string {
  if (!value) {
    throw new Error(
      `Missing ${name}. Copy .env.example to .env and set ${detail}, then restart the bundler.`,
    );
  }
  return value;
}

export function requireGoogleClientId(): string {
  return required(
    GOOGLE_CLIENT_ID,
    'EXPO_PUBLIC_GOOGLE_CLIENT_ID',
    'your Google OAuth client id (installed-app type)',
  );
}

export function requireXClientId(): string {
  return required(
    X_CLIENT_ID,
    'EXPO_PUBLIC_X_CLIENT_ID',
    "your X app's OAuth 2.0 client id (native app / public client)",
  );
}

export function requireTikTokClientKey(): string {
  return required(
    TIKTOK_CLIENT_KEY,
    'EXPO_PUBLIC_TIKTOK_CLIENT_KEY',
    "your TikTok app's client key",
  );
}

export function requireTokenExchangeUrl(): string {
  return required(
    TOKEN_EXCHANGE_URL,
    'EXPO_PUBLIC_TOKEN_EXCHANGE_URL',
    'the URL of your deployed token-exchange function',
  );
}

export function requireMetaAppId(): string {
  return required(META_APP_ID, 'EXPO_PUBLIC_META_APP_ID', 'your Meta app id');
}

export function requireLinkedInClientId(): string {
  return required(
    LINKEDIN_CLIENT_ID,
    'EXPO_PUBLIC_LINKEDIN_CLIENT_ID',
    'your LinkedIn app client id',
  );
}

/** The four platforms whose token exchange needs a secret, so a server hop. */
const NEEDS_TOKEN_EXCHANGE: Platform[] = ['tiktok', 'instagram', 'facebook', 'linkedin'];

const CLIENT_ID_VARS: Record<Platform, [value: string, name: string]> = {
  youtube: [GOOGLE_CLIENT_ID, 'EXPO_PUBLIC_GOOGLE_CLIENT_ID'],
  x: [X_CLIENT_ID, 'EXPO_PUBLIC_X_CLIENT_ID'],
  tiktok: [TIKTOK_CLIENT_KEY, 'EXPO_PUBLIC_TIKTOK_CLIENT_KEY'],
  instagram: [META_APP_ID, 'EXPO_PUBLIC_META_APP_ID'],
  facebook: [META_APP_ID, 'EXPO_PUBLIC_META_APP_ID'],
  linkedin: [LINKEDIN_CLIENT_ID, 'EXPO_PUBLIC_LINKEDIN_CLIENT_ID'],
};

/**
 * Which environment values a platform still needs before its connect flow can
 * run at all. Empty means it's ready.
 *
 * A platform nobody has registered yet isn't an error — it's a platform this
 * build wasn't set up for. The Connections screen uses this to say so calmly
 * instead of throwing a red banner at someone (see docs/connecting-accounts.md).
 */
export function missingConfigFor(platform: Platform): string[] {
  const missing: string[] = [];

  const [value, name] = CLIENT_ID_VARS[platform];
  if (!value) missing.push(name);

  if (NEEDS_TOKEN_EXCHANGE.includes(platform) && !TOKEN_EXCHANGE_URL) {
    missing.push('EXPO_PUBLIC_TOKEN_EXCHANGE_URL');
  }

  return missing;
}

export function isConfigured(platform: Platform): boolean {
  return missingConfigFor(platform).length === 0;
}
