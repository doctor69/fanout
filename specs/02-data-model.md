# 02 — Data Model

Applies to v1 (on-device) storage. v2's server-side schema will mirror this
per-API-key instead of per-device, but is out of scope for this repo — see
`05-v2-monetization-api.md`.

## Account (one per connected platform)

| field           | type                | notes                                           |
|-----------------|---------------------|--------------------------------------------------|
| platform        | Platform enum        | youtube / tiktok / instagram / facebook / x / linkedin |
| accessToken     | string (encrypted)   | stored via expo-secure-store, never plain        |
| refreshToken    | string? (encrypted)  | not all platforms issue one                      |
| expiresAt       | number (epoch ms)    | used to trigger silent refresh before posting     |
| externalUserId  | string                | platform's own user/account id                    |
| displayName     | string?               | shown in Connections screen                       |
| avatarUrl       | string?               | shown in Connections screen                       |
| connectedAt     | number (epoch ms)    | for display only                                  |
| verifiedAt      | number (epoch ms)    | last successful `verifyConnection`; only verified accounts are stored, so its presence is what earns the checkmark |

Stored as one secure-store entry per platform, keyed `account_<platform>`.

Note the underscore. `expo-secure-store` keys may contain only alphanumerics,
`.`, `-` and `_`; it throws `Invalid key provided to SecureStore` on anything
else. This spec originally said `account:<platform>`, and that colon made every
read and save fail — the Connections screen showed the error instead of the
six rows. Found the first time the app ran on a device.
The Connections screen reads all 6 possible keys and renders a checkmark for
whichever resolve.

## PostContent (ephemeral, not persisted in v1)

| field      | type                | notes                                  |
|------------|---------------------|------------------------------------------|
| caption    | string               | single caption applied to all platforms in v1 |
| mediaUri   | string               | local file URI from picker/camera        |
| mediaType  | 'video' \| 'image'   |                                            |

## PostAttempt (in-memory for the result screen; not persisted in v1)

| field          | type                          | notes                              |
|----------------|-------------------------------|----------------------------------------|
| platform       | Platform enum                  |                                          |
| status         | 'pending' \| 'success' \| 'failure' |                                    |
| platformPostId | string?                        | returned by the platform on success     |
| error          | string?                        | human-readable failure reason           |

## PostRecord (persisted — the home feed)

Post history **is** kept, added after v1's first device builds. One record per
fan-out, newest first.

| field      | type                    | notes                                        |
|------------|-------------------------|----------------------------------------------|
| id         | string                   | local id; a per-platform retry updates the record in place rather than adding a second one |
| postedAt   | number (epoch ms)        |                                                |
| caption    | string                   |                                                |
| mediaUri   | string?                  | the local URI as picked. The OS may clear its cache, so the feed must render when this no longer resolves |
| mediaType  | 'video' \| 'image'      |                                                |
| results    | PostRecordResult[]       | platform, status, platformPostId?, error?      |

Stored as one capped JSON list under `post_history_v1` in **AsyncStorage**,
holding the most recent **50** posts; older ones fall off the end. AsyncStorage
rather than secure storage because this is plain content — no field on a
PostRecord is a token, and tokens remain in `expo-secure-store` only.

Still no SQLite. A fixed-length, reverse-chronological list needs no querying,
so the earlier warning stands for anything beyond this: don't add a database
unless a feature genuinely needs one.
