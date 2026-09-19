# CLAUDE.md — Project Context for Claude Code

This file is read by Claude Code at the start of every session in this repo.
It tells you what this project is, how it's structured, and how to work in it.

## What this project is

A free, cross-platform **mobile app** (React Native + Expo, portable to iOS and
Android from one codebase) that lets a user connect their YouTube, TikTok,
Instagram, Facebook, X, and LinkedIn accounts once, then post content
(video/photo/text) to all connected accounts at once from a single composer
screen — with per-post opt-out per platform.

**v1 (this repo, now):** free mobile app only, direct on-device posting.
**v2 (planned, do not build yet unless a spec explicitly says so):** the core
posting logic gets exposed as a paid REST API so developers/power users can
post from their own code or tools, not just the app. See
`specs/05-v2-monetization-api.md`. **This is why the architecture below
insists on a platform-agnostic core module from day one** — v2 should be an
exposure layer on top of existing code, not a rewrite.

## How to work in this repo (spec-driven development)

1. Read `specs/00-product-overview.md` first for the "why."
2. Everything you build must conform to `specs/01-architecture.md` — in
   particular, the core/UI separation. Don't put platform-posting logic
   directly in screen components.
3. Work through `specs/06-build-plan.md` phase by phase, in order. Each phase
   has a checklist. Do not start a phase until the previous phase's checklist
   is complete and the code builds/runs.
4. Before implementing a feature, re-read the relevant spec file fully. If
   something in a spec is ambiguous or conflicts with another spec file, stop
   and ask rather than guessing.
5. After finishing a phase's checklist items, update that checklist in
   `specs/06-build-plan.md` (check items off) as part of the same commit.
6. Do not add a new social platform, a new screen, or a new architectural
   layer that isn't described in a spec file without asking first.

## Tech stack (fixed — do not change without updating specs/01)

- React Native via **Expo** (managed workflow where possible; use dev client /
  prebuild only if a required native module forces it)
- `expo-auth-session` for OAuth (PKCE where the platform supports it)
- `expo-secure-store` for token storage (never AsyncStorage/plaintext for
  tokens)
- TypeScript throughout, strict mode on
- Core posting logic lives in an isolated package (`/packages/core-posting`)
  with **zero React Native imports** — it must be runnable in a plain Node
  environment too, because v2 reuses it in a server context

## Repo layout (target — create as you go per the build plan)

```
/app                     Expo app (screens, navigation, UI state)
/packages/core-posting    Platform-agnostic orchestrator + adapters (see specs/01)
/functions                 The one small serverless function needed for
                          Meta/LinkedIn token exchange (see specs/03)
/specs                     This spec set — source of truth, keep in sync with code
```

## Non-negotiables

- No platform's client secret ever ships inside the mobile app bundle.
- A failure posting to one platform must never block or roll back posts to
  the others (fan-out is independent per platform, always `allSettled`).
- All tokens encrypted at rest on-device via secure storage APIs, never
  logged, never sent anywhere except the platform's own token endpoints (or
  the one serverless function that must exist for Meta/LinkedIn).
- Every platform adapter implements the exact same interface
  (`specs/01-architecture.md`) so the composer/orchestrator never has
  platform-specific branching.
