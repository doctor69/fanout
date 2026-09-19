# 05 — v2: Paid API (Future — Reference Only, Not Built in This Repo Yet)

This spec exists so v1 is built in a way that makes v2 cheap. **Do not start
implementing v2 unless explicitly instructed** — it's documented here purely
so architectural decisions in v1 don't foreclose it.

## Business model

- **App stays free** for end users (v1 scope, unchanged).
- **v2 product: a paid REST API** exposing the same cross-posting engine to
  developers, agencies, and tools that want to automate posting outside a
  phone UI (e.g. a CLI, a CI pipeline, another SaaS product's backend).
- Pricing model to decide later (likely usage-based: $ per post or per
  connected-account-month) — not a v1 concern.

## Why v1's architecture makes this possible

Because `/packages/core-posting` has zero UI or Expo dependencies
(`01-architecture.md`), v2 is additive:

```
/api                      NEW in v2 — thin HTTP layer
  server.ts                Fastify/Express app
  routes/posts.ts          POST /v2/posts → calls fanOutPost() from core-posting
  routes/accounts.ts       account connect/list/disconnect endpoints
  auth/apiKeyMiddleware.ts validates API key, resolves ownerId
  db/
    postgresTokenStore.ts  implements the same TokenStore interface as
                            SecureStoreTokenStore does in v1, backed by
                            Postgres instead of on-device secure storage
```

No changes needed to `PostOrchestrator` or any `PlatformAdapter` — v2 just
supplies a different `TokenStore` implementation and a different auth
context (API key → `ownerId`, instead of "the one device the app is
installed on").

## v2 scope sketch (for later, not for this repo's build plan)

- `POST /v2/posts` — body: caption, media (upload or URL), target platforms
  (defaults to all connected accounts under that API key, same "opt-out"
  semantics as the mobile composer).
- `GET /v2/accounts` — list connected accounts and their connection status
  for the authenticated API key.
- `POST /v2/accounts/:platform/connect` — server-side OAuth start/callback
  for headless connection (or a hosted connect page, TBD).
- API keys issued per developer account, rate-limited and metered for
  billing.
- Webhook or polling endpoint for post status, since some platform uploads
  (video, especially) are not instantaneous.

## What NOT to do in v1 because of this future plan

- Don't hardcode `expo-secure-store` calls anywhere inside
  `/packages/core-posting` — it must only ever talk to the `TokenStore`
  interface.
- Don't let any `PlatformAdapter` assume it's running in a mobile JS
  runtime (no RN-only APIs, no `fetch` polyfills that don't exist in Node).
- Don't couple `fanOutPost`'s signature to anything mobile-specific (e.g.
  don't pass a React Navigation object into it).
