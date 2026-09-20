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

**Built after Phase 5, not before it** — see the first item.

- [x] Register a TikTok developer app, confirm current mobile PKCE
      requirements for Login Kit (flag to Doctor if a server hop turns out
      to be required — see open question in `03-auth-and-oauth.md`).
      **Answer: a server hop IS required.** TikTok uses PKCE for native
      apps, but still requires the client secret on the token exchange, and
      its own docs say that secret must stay server-side. So TikTok joins
      Meta and LinkedIn on `/functions/token-exchange`, and Phase 5 was
      built first. *(Registering the developer app itself is Doctor's step:
      set the redirect URI to `fanout:/oauth/tiktok`, add Login Kit and the
      Content Posting API with the `video.publish` scope, then put the
      client key in `app/.env` and the client secret on the function.)*
- [x] Implement `tiktokAdapter` against the sandbox first (posts will be
      private-only pre-audit — this is expected, not a bug). *(The adapter
      asks TikTok which privacy levels the creator may use and takes the
      most public one offered, so an unaudited app posts SELF_ONLY and the
      same code posts publicly once the audit passes — no code change.)*
- [x] Add to Connections/Composer screens.
- [ ] Flag to Doctor: app audit submission needed before TikTok posts can be
      public (requires privacy policy URL + demo video — manual step, not
      something Claude Code can do alone). **Flagged — still Doctor's to do.**
- [ ] Note for the manual pass: TikTok photo posts accept only
      `PULL_FROM_URL`, i.e. a publicly reachable image URL, which an
      on-device file isn't. The adapter returns a clear "videos only" failure
      for photos rather than attempting the call. Posting photos to TikTok
      would need somewhere to host the image first — worth a product decision
      before Phase 8.

## Phase 5 — Serverless token-exchange function

- [x] Set up `/functions/token-exchange` (Cloudflare Worker or Vercel Edge
      Function — pick whichever has simpler local dev/deploy for this repo).
      *(Cloudflare Worker: `wrangler dev` runs the real runtime locally with
      no account needed. Handles TikTok, Instagram, Facebook and LinkedIn,
      with both a `/token-exchange` and a `/token-refresh` route, since
      specs/03 routes refresh through the function too.)*
- [ ] Deploy to the platform's free tier; confirm it's reachable from the
      Expo app in dev. **Blocked on Doctor:** needs a Cloudflare account.
      `npm run deploy --workspace=@fanout/token-exchange`, then put the
      resulting URL in `app/.env` as `EXPO_PUBLIC_TOKEN_EXCHANGE_URL`.
- [x] Store Meta and LinkedIn client secrets as environment variables on the
      function only — never commit them, never reference them from `/app`.
      *(Plus TikTok's, per the Phase 4 finding. `.dev.vars` for local dev is
      gitignored; production uses `wrangler secret put`. The function names a
      missing variable in its error but never echoes a value, and logs
      neither.)*

## Phase 6 — Instagram + Facebook (Meta Graph API)

- [ ] Register Meta app, set up a test Facebook Page + linked Instagram
      Business/Creator account for development. **Doctor's step.** Add
      `fanout:/oauth/facebook` and `fanout:/oauth/instagram` to the app's
      Valid OAuth Redirect URIs, put the app id in `app/.env` and the app
      secret on the function.
- [x] Implement connect flow: app gets auth code → sends to
      `/functions/token-exchange` → receives tokens → stores via
      `SecureStoreTokenStore`. *(The function also trades the short-lived
      token for a long-lived one. What's stored is the Page access token,
      which posts, plus the long-lived user token, which is the only thing a
      new Page token can be derived from.)*
- [x] Implement `instagramAdapter` and `facebookAdapter`. *(One factory:
      they share an app, a token endpoint and a Page, and differ only in how
      they post.)*
- [x] Add both to Connections/Composer screens.
- [ ] Flag to Doctor: Meta App Review needed before this works for real
      end users beyond test accounts — manual step. **Flagged.**
- [ ] Two things for the manual pass:
      (a) Instagram photo posts accept only a public `image_url` — there is
      no binary path — so the adapter refuses photos with a clear reason and
      posts videos as Reels via the resumable endpoint. Same constraint as
      TikTok photos; worth one product decision covering both.
      (b) Meta has historically wanted https redirect URIs for the web OAuth
      dialog. If it refuses `fanout:/oauth/...`, the fix is a bridge route on
      the token-exchange Worker that 302s back to the app scheme.
- [ ] v1 connects the first eligible Page. Someone who manages several Pages
      has no way to choose — a picker isn't in the specs, so raise it before
      it bites.

## Phase 7 — LinkedIn

- [ ] Register LinkedIn developer app. **Doctor's step.** Needs the "Share on
      LinkedIn" and "Sign In with LinkedIn using OpenID Connect" products,
      with `fanout:/oauth/linkedin` as an authorized redirect URL.
- [x] Same token-exchange-function pattern as Phase 6.
- [x] Implement `linkedinAdapter`. *(Images and videos both upload as binary:
      images in one PUT, videos part by part with the ETags returned on
      finalize. The `LinkedIn-Version` header is configurable because
      LinkedIn's versions age out after about a year — bump it with the rest
      of the dependency housekeeping.)*
- [x] Add to Connections/Composer screens — all 6 platforms now present.

## Phase 8 — Hardening

- [ ] Token refresh tested for every platform (force-expire and confirm
      silent refresh works before a post). *(The logic is covered per adapter
      by automated tests — the refresh margin, same-reference-when-fresh,
      token rotation where the platform rotates, and re-deriving Meta's Page
      token. Confirming it against live tokens is Doctor's device pass.)*
- [ ] "Reconnect" deep-link flow tested for a fully revoked/expired refresh
      token on each platform. *(Every adapter maps a dead grant to
      needsReconnect, fanOutPost preserves it, and the composer turns it into
      a "Reconnect <platform>" action that deep-links to the highlighted
      Connections row. Live revocation is Doctor's device pass.)*
- [x] Confirm no client secret or token ever appears in logs (grep build
      output / console for accidental leaks). *(`npm run check:leaks`:
      no client-secret handling outside /functions, no console calls in
      token-handling code, and no secret VALUE from `app/.env` or
      `functions/.dev.vars` present in a freshly built bundle. It builds with
      `--clear` — Metro's cache will otherwise hand back a bundle from before
      the .env existed and the check passes on nothing. Verified by planting
      a leak and watching it fail.)*
- [x] Confirm one platform failing during fan-out never blocks or delays the
      others' success state. *(Automated: one platform resolving a failure,
      one throwing, and a third still succeeding independently — plus a test
      that each result is reported as it resolves rather than at the end.)*
- [ ] Run through `00-product-overview.md`'s success criteria end to end.
      **Doctor's device pass**, once the credentials are in place.

## Packaging (Android)

- [x] Verified `npx expo prebuild --platform android` generates a correct
      native project: the `fanout` scheme intent-filter is present, so the
      OAuth redirects come back to the app, and `MainActivity` is
      `singleTask`.
- [x] Fixed a bug prebuild surfaced: `expo-image-picker`'s config plugin adds
      `RECORD_AUDIO` but never `CAMERA`, and `launchCameraAsync` requires
      `CAMERA` to be *granted* — which Android can never do for a permission
      the manifest doesn't declare. The composer's camera button would have
      been permanently broken. Now declared via `android.permissions` in
      `app.json`.
- [x] `eas.json` with development / preview / production profiles, so an APK
      can be built without a local Android SDK.
- [ ] Before a Play release: declaring `CAMERA` makes Play infer
      `uses-feature android.hardware.camera` as **required**, which hides the
      app from camera-less devices. If that matters, add a config plugin
      setting `required="false"`.
- [ ] Actually produce a build. **Blocked in the dev container, not in the
      repo:** `dl.google.com` is blocked by the environment's network policy,
      and that one host serves the Android Gradle Plugin, the AndroidX
      artifacts and the SDK platform, so no local Gradle build can resolve
      anything. Build via EAS, or locally on a machine with the SDK.

      Maven Central is reachable but is not a way around it, so don't spend
      time there: its `com.android.tools.build:gradle` mirror stops at 2.3.0
      (2017) and we need 8.x, and every `androidx.*` artifact, `aapt2` and
      `r8` return 404. The fix is either EAS or allowing `dl.google.com` in
      the environment's network policy — that one host unblocks all three.

## Phase 10 — Home feed and theming

Added after Phases 0-8, once the app was running on real Android and iOS
builds. This is a deliberate change to v1's scope: `02-data-model.md`
previously kept post attempts in memory only.

- [x] Persist post history as a capped list (50) and render it as the app's
      home screen, showing per-platform outcomes per post.
- [x] Fold a per-platform retry into the existing record rather than creating
      a second entry for the same post.
- [x] Follow the OS light/dark setting; no in-app switch. `userInterfaceStyle`
      set to "automatic" with `expo-system-ui` installed, which is what makes
      Android honour it — it was pinned to "light" before, so dark mode could
      never have worked.
- [x] Move every screen's colour into `app/theme.ts`; no hardcoded hex values
      in screens.
- [ ] Check the feed on a device once real posts exist: the media thumbnail
      after the OS has cleared its picker cache, and both themes.

## Phase 9 — iOS port verification

- [ ] Full pass on iOS simulator/device: OAuth redirect URIs, secure store,
      media picker, all 6 adapters — since Expo gives one codebase, this
      should mostly be verification, not new implementation. Log any
      platform-specific fixes needed back into the relevant adapter/spec.
