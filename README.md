# fanout

Post once, fan out to every connected social account — YouTube, TikTok,
Instagram, Facebook, X and LinkedIn — from one composer screen, with a
per-post opt-out per platform.

Free cross-platform mobile app (React Native + Expo). See `specs/` for the
full product, architecture and build plan; `specs/00-product-overview.md`
first.

## Layout

```
/app                    Expo app (screens, navigation, UI state)
/packages/core-posting  Platform-agnostic orchestrator + adapters — no RN/Expo
                        imports, runs in plain Node (see specs/01-architecture.md)
/functions              Serverless token exchange for Meta/LinkedIn (specs/03)
/specs                  Source of truth — keep in sync with the code
```

## Requirements

- Node 20+ (Node 22 used in CI/dev)
- npm 10+ (the repo uses npm workspaces)
- Expo Go on a device, or an Android/iOS simulator, to run the app

## Getting started

```bash
npm install          # installs both workspaces and links @fanout/core-posting
npm test             # builds core-posting and runs its unit tests in plain Node
npm run typecheck    # strict tsc over both workspaces
npm start            # expo start
```

### Note on adding Expo modules

`npx expo install` needs `api.expo.dev`, which is unreachable from some
sandboxed environments. The equivalent is to look the version up in
`node_modules/expo/bundledNativeModules.json` and install that exact range
with `npm install --workspace=app <pkg>@<range>` — same result, npm registry
only.

## Status

Phase 0 of `specs/06-build-plan.md` is complete, and Phase 1 is code-complete:
the Connections screen, `SecureStoreTokenStore`, the YouTube PKCE connect flow
and the YouTube adapter (resumable upload + silent refresh) are all in.

Phase 1's last checklist item — manually connecting a real YouTube account —
is blocked on credentials only: create a Google Cloud OAuth client of the
**installed app** type with the YouTube Data API v3 enabled, register
`fanout:/oauth/youtube` as its redirect URI, and put the id in `app/.env` as
`EXPO_PUBLIC_GOOGLE_CLIENT_ID` (copy `app/.env.example`). That flow needs a dev
build rather than Expo Go, since Expo Go serves its own URL scheme.

## Security

Non-negotiables are listed in `CLAUDE.md` and `specs/03-auth-and-oauth.md`:
no platform client secret ever ships in the app bundle, tokens live only in
`expo-secure-store`, and tokens are never logged.
