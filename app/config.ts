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

export function requireGoogleClientId(): string {
  if (!GOOGLE_CLIENT_ID) {
    throw new Error(
      'Missing EXPO_PUBLIC_GOOGLE_CLIENT_ID. Copy .env.example to .env and set your ' +
        'Google OAuth client id (installed-app type), then restart the bundler.',
    );
  }
  return GOOGLE_CLIENT_ID;
}
