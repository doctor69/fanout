# 01 — Architecture

## Guiding principle

**The posting engine must not know it's running inside a mobile app.**
Everything that isn't UI (auth token management, platform API calls, fan-out
orchestration, retry/result handling) lives in `/packages/core-posting`, a
plain TypeScript package with no React Native or Expo imports. This is what
makes v2 (a paid hosted API) possible later without rewriting the logic — v2
just puts an HTTP layer, an API-key auth layer, and a token store adapter in
front of the same package.

```
                    ┌────────────────────────┐
   v1: Mobile app   │   /app (Expo/RN, UI)    │
                    └───────────┬─────────────┘
                                │ calls
                    ┌───────────▼─────────────┐
                    │  /packages/core-posting  │ ← platform-agnostic
                    │  - PostOrchestrator       │
                    │  - PlatformAdapter (x6)   │
                    │  - TokenStore interface   │
                    └───────────┬─────────────┘
                                │ implements TokenStore via
                    ┌───────────▼─────────────┐
   v1: on-device    │  SecureStoreTokenStore   │ (expo-secure-store)
                    └──────────────────────────┘

                    ┌──────────────────────────┐
   v2 (future):     │  /api (Fastify/Express)  │ ← thin HTTP wrapper
                    │  same core-posting import │
                    └───────────┬──────────────┘
                                │ implements TokenStore via
                    ┌───────────▼──────────────┐
                    │  DatabaseTokenStore        │ (Postgres, per API key)
                    └───────────────────────────┘
```

## Core interfaces (`/packages/core-posting/src/types.ts`)

```ts
type Platform = 'youtube' | 'tiktok' | 'instagram' | 'facebook' | 'x' | 'linkedin';

interface PostContent {
  caption: string;
  mediaUri: string;      // local file path (mobile) or URL/buffer (server, v2)
  mediaType: 'video' | 'image';
}

interface Account {
  platform: Platform;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;      // epoch ms
  externalUserId: string;
  displayName?: string;
}

interface PostResult {
  platform: Platform;
  status: 'success' | 'failure';
  platformPostId?: string;
  error?: string;
}

interface PlatformAdapter {
  platform: Platform;
  refreshTokenIfNeeded(account: Account): Promise<Account>;
  publish(account: Account, content: PostContent): Promise<PostResult>;
}

interface TokenStore {
  getAccounts(ownerId: string): Promise<Account[]>;
  saveAccount(ownerId: string, account: Account): Promise<void>;
  removeAccount(ownerId: string, platform: Platform): Promise<void>;
}
```

## PostOrchestrator

Single entry point both v1 UI and (later) v2 API call:

```ts
async function fanOutPost(
  ownerId: string,
  content: PostContent,
  targetPlatforms: Platform[],   // connected accounts minus any opted out
  tokenStore: TokenStore,
  adapters: Record<Platform, PlatformAdapter>
): Promise<PostResult[]> {
  const accounts = await tokenStore.getAccounts(ownerId);
  const targets = accounts.filter(a => targetPlatforms.includes(a.platform));

  const results = await Promise.allSettled(
    targets.map(async (account) => {
      const adapter = adapters[account.platform];
      const fresh = await adapter.refreshTokenIfNeeded(account);
      if (fresh !== account) await tokenStore.saveAccount(ownerId, fresh);
      return adapter.publish(fresh, content);
    })
  );

  return results.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { platform: targets[i].platform, status: 'failure', error: String(r.reason) }
  );
}
```

Rules for every `PlatformAdapter` implementation:
- Never throws out of `publish()` for expected failures (auth expired,
  platform rejected content, rate limit) — always resolve a `PostResult`
  with `status: 'failure'` and a human-readable `error`. Let unexpected
  errors throw; the orchestrator's `allSettled` catches them either way.
- `refreshTokenIfNeeded` returns the *same* account object (reference
  equality) if no refresh was needed, so the orchestrator knows not to
  re-save it.
- One adapter file per platform under
  `/packages/core-posting/src/adapters/<platform>.ts`. No shared mutable
  state between adapters.

## Where each platform's adapter needs a server hop (v1)

Only for the OAuth token-exchange step (not for posting itself, once a valid
token exists) — see `03-auth-and-oauth.md` for exact detail:
- YouTube (Google), X: PKCE, no server hop needed at all.
- TikTok: Login Kit works client-side; token exchange can be done via PKCE
  for native apps per TikTok's mobile guidance — confirm current requirement
  during Phase 2 of the build plan before assuming client-only.
- Instagram/Facebook (Meta Graph API), LinkedIn: token exchange requires a
  client secret → routed through `/functions/token-exchange` (the one small
  serverless function in this repo).

## App-layer structure (`/app`)

```
/app
  /screens
    ConnectionsScreen.tsx     -- list of 6 platforms, connect/disconnect, checkmarks
    ComposerScreen.tsx        -- media + caption + per-post opt-out toggles + Post button
    PostResultScreen.tsx      -- per-platform success/fail summary after posting
  /state
    accountsStore.ts          -- thin wrapper around core-posting's TokenStore for UI reads
  /services
    secureStoreTokenStore.ts  -- TokenStore implementation using expo-secure-store
```

Screens call into `/packages/core-posting` only through `accountsStore` and
`fanOutPost` — never import a platform SDK directly in a screen component.
