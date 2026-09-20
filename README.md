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
npm run check:leaks  # proves no secret value is compiled into the app bundle
```

### Note on adding Expo modules

`npx expo install` needs `api.expo.dev`, which is unreachable from some
sandboxed environments. The equivalent is to look the version up in
`node_modules/expo/bundledNativeModules.json` and install that exact range
with `npm install --workspace=app <pkg>@<range>` — same result, npm registry
only.

## Building an Android app

The native `android/` directory isn't committed — Expo generates it from
`app.json`, so configuration changes belong there, not in generated files.

**With EAS (no local Android SDK needed):**

```bash
npm install -g eas-cli
eas login
cd app
eas build --platform android --profile development  # dev client, for OAuth testing
eas build --platform android --profile preview      # installable APK
eas build --platform android --profile production   # .aab for Play
```

`EXPO_PUBLIC_*` values are baked in at build time, and `.env` is gitignored so
EAS won't upload it — set them as EAS environment variables (`eas env:create`)
or they'll be empty in the build.

**Locally**, with Android Studio or the command-line tools installed and
`ANDROID_HOME` set:

```bash
cd app
npx expo prebuild --platform android   # generates android/
npx expo run:android                   # builds, installs and runs
```

Use the **development** profile, not Expo Go, for anything touching OAuth:
the connect flows redirect to `fanout:/oauth/<platform>`, and Expo Go serves
its own URL scheme, so the redirect never comes back to the app.

## Status

All six platforms are implemented: YouTube, X, TikTok, Instagram, Facebook
and LinkedIn each have an adapter, a connect flow and a row in both screens.
Phases 0-7 of `specs/06-build-plan.md` are code-complete, and Phase 8's
automatable checks pass.

What's left needs credentials or a device, and is listed phase by phase in
`specs/06-build-plan.md`: registering each platform's developer app,
deploying the token-exchange function, TikTok's app audit, Meta's App
Review, and the end-to-end pass on a real device.

Two product decisions are flagged there too: neither TikTok nor Instagram
accepts a photo without a publicly reachable URL, so photos to those two
would need somewhere to host the image first; and v1 connects the first
eligible Facebook Page with no way to choose between several.

## Security

Non-negotiables are listed in `CLAUDE.md` and `specs/03-auth-and-oauth.md`:
no platform client secret ever ships in the app bundle, tokens live only in
`expo-secure-store`, and tokens are never logged. `npm run check:leaks`
enforces the first and third against a freshly built bundle.
