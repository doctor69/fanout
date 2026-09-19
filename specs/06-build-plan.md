# 06 — Build Plan (Spec-Driven, Phased)

Work top to bottom. Do not start a phase until the previous phase's checklist
is fully checked and the app builds/runs on at least one platform (iOS or
Android simulator). Check items off in this file as you complete them, in
the same commit as the work.

## Phase 0 — Project setup

- [x] Initialize Expo (TypeScript template) app under `/app`.
- [x] Initialize `/packages/core-posting` as a standalone TS package (no RN
      deps), wired into the app via workspace linking (npm/yarn/pnpm
      workspaces).
- [x] Confirm `/packages/core-posting` builds and runs its own unit tests in
      plain Node (proves the no-RN-dependency rule from the start).
- [x] Add `expo-auth-session`, `expo-secure-store`, `expo-image-picker` (or
      equivalent media picker) to `/app`.
- [x] Stub out the type definitions from `01-architecture.md`
      (`Platform`, `Account`, `PostContent`, `PostResult`, `PlatformAdapter`,
      `TokenStore`) in `/packages/core-posting/src/types.ts`.

## Phase 1 — Connections screen + one platform end-to-end (YouTube)

Pick YouTube first: PKCE only, no server hop, proves the whole chain works
before tackling platforms that need the serverless function.

- [x] Implement `SecureStoreTokenStore` (`TokenStore` interface).
- [x] Implement YouTube OAuth connect flow via `expo-auth-session` PKCE.
- [x] Build `ConnectionsScreen` with the 6-row list; only YouTube is
      functional, other 5 show "Connect" but can no-op/alert for now.
- [x] Implement `youtubeAdapter.publish()` (resumable upload via Data API)
      and `refreshTokenIfNeeded()`.
- [ ] Manually verify: connect YouTube, see checkmark, disconnect, checkmark
      disappears. **Blocked on Doctor:** needs a Google Cloud OAuth client
      (installed-app type, YouTube Data API v3 enabled) in `app/.env` as
      `EXPO_PUBLIC_GOOGLE_CLIENT_ID`, with `fanout:/oauth/youtube` registered
      as its redirect URI, plus a dev build — Expo Go uses its own scheme, so
      the custom-scheme redirect won't come back to the app there.

## Phase 2 — Composer + fan-out logic (still YouTube-only target)

- [x] Build `ComposerScreen`: media picker, caption field, platform chip row
      (only YouTube will appear as a chip at this point).
- [x] Implement `fanOutPost` in `/packages/core-posting` exactly per the
      pseudocode in `01-architecture.md`.
- [x] Wire the Post button to `fanOutPost`, show per-platform result state
      per `04-posting-flow.md`.
- [ ] Manually verify: post a real short video, see it land on YouTube,
      see success state in-app. **Blocked on Doctor:** same credentials and
      dev build as Phase 1's manual check.

## Phase 3 — Remaining PKCE/no-server platforms (X)

- [x] Confirm current X OAuth 2.0 PKCE scopes/requirements against X's
      developer docs (they change) before implementing. *(docs.x.com is
      blocked by this environment's egress proxy, so endpoints and scopes
      were confirmed against the current source of a maintained X API client
      plus search results: authorize at `x.com/i/oauth2/authorize`, token at
      `api.x.com/2/oauth2/token`, chunked media at
      `/2/media/upload/{initialize,append,finalize}` — the old
      `command=INIT|APPEND|FINALIZE` form protocol is gone — and scopes
      `tweet.read tweet.write media.write users.read offline.access`.
      Worth a re-check against the docs when they're reachable.)*
- [x] Implement `xAdapter` (media upload + post) and its OAuth connect flow.
- [x] Add X to the Connections and Composer screens. *(Both are driven by the
      platform list and the connected-account list, so X appears as soon as
      it has a connect flow and an adapter.)*
- [ ] Re-verify fan-out with 2 platforms connected, including one platform
      opted out of a post. **Blocked on Doctor:** needs both accounts on a
      device. The opt-out path itself is covered by an automated test in
      `fanOutPost`.

## Phase 4 — TikTok

- [ ] Register a TikTok developer app, confirm current mobile PKCE
      requirements for Login Kit (flag to Doctor if a server hop turns out
      to be required — see open question in `03-auth-and-oauth.md`).
- [ ] Implement `tiktokAdapter` against the sandbox first (posts will be
      private-only pre-audit — this is expected, not a bug).
- [ ] Add to Connections/Composer screens.
- [ ] Flag to Doctor: app audit submission needed before TikTok posts can be
      public (requires privacy policy URL + demo video — manual step, not
      something Claude Code can do alone).

## Phase 5 — Serverless token-exchange function

- [ ] Set up `/functions/token-exchange` (Cloudflare Worker or Vercel Edge
      Function — pick whichever has simpler local dev/deploy for this repo).
- [ ] Deploy to the platform's free tier; confirm it's reachable from the
      Expo app in dev.
- [ ] Store Meta and LinkedIn client secrets as environment variables on the
      function only — never commit them, never reference them from `/app`.

## Phase 6 — Instagram + Facebook (Meta Graph API)

- [ ] Register Meta app, set up a test Facebook Page + linked Instagram
      Business/Creator account for development.
- [ ] Implement connect flow: app gets auth code → sends to
      `/functions/token-exchange` → receives tokens → stores via
      `SecureStoreTokenStore`.
- [ ] Implement `instagramAdapter` and `facebookAdapter`.
- [ ] Add both to Connections/Composer screens.
- [ ] Flag to Doctor: Meta App Review needed before this works for real
      end users beyond test accounts — manual step.

## Phase 7 — LinkedIn

- [ ] Register LinkedIn developer app.
- [ ] Same token-exchange-function pattern as Phase 6.
- [ ] Implement `linkedinAdapter`.
- [ ] Add to Connections/Composer screens — all 6 platforms now present.

## Phase 8 — Hardening

- [ ] Token refresh tested for every platform (force-expire and confirm
      silent refresh works before a post).
- [ ] "Reconnect" deep-link flow tested for a fully revoked/expired refresh
      token on each platform.
- [ ] Confirm no client secret or token ever appears in logs (grep build
      output / console for accidental leaks).
- [ ] Confirm one platform failing during fan-out never blocks or delays the
      others' success state.
- [ ] Run through `00-product-overview.md`'s success criteria end to end.

## Phase 9 — iOS port verification

- [ ] Full pass on iOS simulator/device: OAuth redirect URIs, secure store,
      media picker, all 6 adapters — since Expo gives one codebase, this
      should mostly be verification, not new implementation. Log any
      platform-specific fixes needed back into the relevant adapter/spec.
