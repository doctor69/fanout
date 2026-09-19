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

Phase 0 of `specs/06-build-plan.md` is complete: workspaces, the core package
with its Node test suite, the Expo app, and the shared type definitions.
Phase 1 (Connections screen + YouTube end-to-end) is next and needs a Google
OAuth client id plus a device to verify on.

## Security

Non-negotiables are listed in `CLAUDE.md` and `specs/03-auth-and-oauth.md`:
no platform client secret ever ships in the app bundle, tokens live only in
`expo-secure-store`, and tokens are never logged.
