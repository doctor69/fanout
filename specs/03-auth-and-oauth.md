# 03 — Auth & OAuth Per Platform

All flows use `expo-auth-session` (native browser tab, not embedded WebView)
so tokens never pass through app-controlled JS context unnecessarily, and so
each platform sees the flow as coming from a legitimate installed app.

For every platform: on successful connect, **verify the connection before
storing anything**. Call the adapter's `verifyConnection` (see
`01-architecture.md`) to confirm the token is live and the posting scope was
actually granted; only then write an `Account` record (see
`02-data-model.md`, including `verifiedAt`) to secure storage, navigate back
to `ConnectionsScreen`, and show the checkmark.

A sign-in that fails verification is **not** stored and **never** shows a
checkmark — the user sees the platform's own reason (e.g. "signed you in but
did not grant permission to upload videos") and can run the flow again. The
checkmark is the app's promise that this account can be posted to, so it is
never shown on the strength of a completed browser flow alone.

## No server hop needed (PKCE, public client)

- **YouTube / Google** — OAuth 2.0 with PKCE, installed-app client type.
  Scope: `https://www.googleapis.com/auth/youtube.upload`. No client secret
  required for this client type.
- **X (Twitter)** — OAuth 2.0 with PKCE, public client. Scopes:
  `tweet.write`, `users.read`, `media.write` (or current equivalents —
  confirm against X's developer docs at implementation time, this changes).

## Confirm before building — may or may not need a server hop

- **TikTok** — Login Kit supports PKCE for mobile apps. The Content Posting
  API itself is free, but a new app posts as **private-only until it passes
  TikTok's app audit** (submission requires a privacy policy URL and a demo
  video of the full OAuth + upload flow; approval typically takes one to two
  weeks). Build against the sandbox first; flag to Doctor when the app is
  ready for audit submission — this is a manual step outside Claude Code's
  control. Posting is capped at 6 requests/minute per user token.

## Needs a server hop (client secret can't ship in the app)

- **Instagram + Facebook (Meta Graph API)** — requires a Facebook Page and,
  for Instagram, a Business or Creator account linked to that Page. Needs
  Meta App Review for production use beyond your own test accounts. The
  code-for-token exchange step requires the app secret.
- **LinkedIn** — same pattern: authorization code exchange requires a client
  secret.

For both, `/functions/token-exchange` (a single serverless function —
Cloudflare Worker or Vercel Edge Function, free tier) does only this:

```
POST /token-exchange
body: { platform: 'instagram' | 'facebook' | 'linkedin', code: string, codeVerifier?: string }
→ exchanges code for access/refresh token using the platform's client secret
  (stored as an environment variable on the function, never in the app)
→ returns { accessToken, refreshToken?, expiresAt }
```

The app calls this function only during the initial connect and during token
refresh for these two platforms; the actual `publish()` calls in the
adapters still happen directly from the app once a valid token is held.

## Token refresh

`refreshTokenIfNeeded(account)` in each adapter checks `expiresAt` against
now (with a safety margin, e.g. refresh if expiring within 5 minutes) before
every `publish()` call. Refreshed tokens are written back to secure storage
by the orchestrator, not by the adapter directly (keeps adapters free of
storage side effects — see `01-architecture.md`).

## Security rules (non-negotiable, also stated in CLAUDE.md)

- No client secret in the mobile app bundle, ever — Meta and LinkedIn secrets
  live only as environment variables on `/functions`.
- Tokens stored via `expo-secure-store` only.
- Tokens never logged, including in dev/debug builds.
- Disconnecting a platform must delete its secure-store entry, not just hide
  it in the UI.
