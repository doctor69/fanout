# 04 — Posting Flow (UI Behavior)

## Connections screen

- Fixed list of 6 rows: YouTube, TikTok, Instagram, Facebook, X, LinkedIn.
- Each row: platform icon, platform name, and either:
  - a **checkmark + display name** if connected (tap row → shows
    "Disconnect" confirmation), or
  - a **"Connect" button** if not connected (tap → launches that platform's
    OAuth flow per `03-auth-and-oauth.md`).
- No ordering logic needed beyond a fixed list; connected/disconnected state
  alone communicates status.

## Composer screen

- Media picker (camera or library) + single caption text field.
- Below the caption: one row of small platform icon chips, **one per
  connected account only** (unconnected platforms don't appear here at all
  — connecting is only done from the Connections screen).
- **Default state: every connected platform's chip is selected (opted in).**
- Tapping a chip toggles it to an unselected/greyed state — this is the
  per-post opt-out. This selection is local to the current post only and
  resets to "all selected" the next time the composer opens.
- "Post" button is disabled until media is attached and at least one chip is
  selected.
- On tap: call `fanOutPost(ownerId, content, selectedPlatforms, ...)` from
  `packages/core-posting`, show a loading state per platform (spinner on
  each selected chip).

## Post result screen (or inline result state on the composer)

- As each `PostResult` resolves, update that platform's chip to a
  success (checkmark) or failure (error icon) state — do not wait for all
  platforms to finish before showing any result (`Promise.allSettled`
  already lets each resolve independently; surface results as the array
  resolves, not just at the end, if the adapter layer supports progressive
  reporting — otherwise show all at once when `fanOutPost` resolves, that's
  acceptable for v1).
- On failure, show the adapter's `error` string for that platform and offer
  a "Retry this platform" action that re-calls `fanOutPost` scoped to just
  that one platform — do not require retrying platforms that already
  succeeded.

## Edge cases to handle explicitly

- Zero platforms connected: Composer screen shows an empty state pointing
  to the Connections screen instead of the chip row.
- A connected account's token can't be refreshed (refresh token itself
  expired/revoked): treat as a failure result for that platform with a
  clear "Reconnect [platform]" error rather than a generic failure, and
  deep-link that action to the Connections screen for that platform.
- Media type not supported by a given platform (e.g. a platform that's
  photo-only receiving a video): adapter should return a failure result
  with an explicit "unsupported media type" error rather than attempting
  the call.
