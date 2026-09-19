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
