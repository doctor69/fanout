# 00 — Product Overview

## Problem

Creators posting the same content to multiple social platforms currently have
to manually upload to each app, reformatting captions each time. Existing
tools that solve this (Socialync, Crosspost, OneUp, etc.) are either paid, or
free with tight caps (e.g. 10 posts/month), and none give the user their own
API to call this logic from their own code or other tools.

## v1 — Free mobile app

- Platforms: YouTube, TikTok, Instagram, Facebook, X, LinkedIn.
- User connects accounts once (OAuth). Connected accounts show a checkmark.
- User composes one post (media + caption) and it fans out to **all
  connected accounts by default**.
- On the post-composer screen, the user can opt a specific connected
  platform **out of this one post** without disconnecting it.
- No subscription, no server-side account required to use the app itself,
  beyond the minimal serverless function some platforms require for token
  exchange (see `03-auth-and-oauth.md`).
- Entirely free to the end user in v1.

## v2 — Paid API (future, not built in this repo yet)

- The same posting engine (`/packages/core-posting`) gets wrapped in a REST
  API with API keys, so a developer can call
  `POST /v2/posts` from their own script, CI pipeline, or another tool,
  instead of using the mobile app UI.
- This is the monetization path: **the app stays free; the API is the paid
  product**, aimed at developers/agencies who want to automate posting
  outside of a phone UI.
- Full detail in `05-v2-monetization-api.md`. v1's job is to make v2 cheap to
  build later by keeping the posting logic UI-agnostic from day one.

## Explicit non-goals for v1

- No scheduling/calendar (post now only).
- No analytics dashboard.
- No team/multi-user accounts.
- No AI caption generation.
- No per-platform caption customization (single caption for all platforms;
  can be a v1.1 addition, not blocking).

## Success criteria for v1

- A user can connect all 6 platforms and see 6 checkmarks.
- A user can shoot/pick a video or photo, write one caption, hit "Post," and
  have it appear on every connected platform within a few minutes, with
  clear per-platform success/failure feedback in the app.
- Disconnecting a platform and reconnecting it works without reinstalling
  the app.
