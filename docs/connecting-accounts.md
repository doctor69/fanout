# Connecting accounts: what each platform needs from you

Tapping **Connect** and getting "Missing `EXPO_PUBLIC_…`" is the app saying it
doesn't know *which app it is*. That's a one-time developer setup step, not a
login and not a server.

## The thing being asked for is a client ID

Every OAuth platform requires the *application* to identify itself before it
will show a user a consent screen. That identifier — Google calls it a client
ID, TikTok a client key, Meta an app ID — is:

- **public**, and ships inside the app bundle by design;
- **not** a password, and **not** a user account;
- **not** a database and **not** a server;
- registered **once by you, the developer**, per platform. Your users never see
  it or supply it.

It's different for each platform because each platform issues its own.

What the app then does is exactly the intended flow: opens the platform's own
site in the system browser, the user signs in there, and the resulting token is
stored on the device via `expo-secure-store`. No database, no account system,
nothing of the user's leaves the phone.

## The one exception to "no server"

Four platforms refuse to complete the token exchange without a client
**secret**, and a secret can never ship in an app bundle — anyone can unzip an
APK. That's their rule, not a design choice here:

| Platform | Needs a server hop? |
|----------|--------------------|
| YouTube  | **No** — PKCE, on-device |
| X        | **No** — PKCE, on-device |
| TikTok   | Yes |
| Instagram| Yes |
| Facebook | Yes |
| LinkedIn | Yes |

That's the only reason `/functions/token-exchange` exists: a single stateless
function that swaps a code for a token using the secret, and stores nothing.
It's not a backend for the app, and no user data passes through it beyond that
one exchange.

**So start with YouTube.** It needs no server, no secret, and no review, and it
proves the whole chain: browser sign-in → token → secure storage → posting.

## YouTube (start here)

1. [Google Cloud Console](https://console.cloud.google.com/) → create a project.
2. **APIs & Services → Library** → enable **YouTube Data API v3**.
3. **OAuth consent screen** → External. Add your own Google account under
   **Test users** — without that, sign-in is refused while the app is unverified.
   Add the scope `https://www.googleapis.com/auth/youtube.upload`.
4. **Credentials → Create credentials → OAuth client ID → Android**:
   - Package name: `com.fanout.app`
   - SHA-1 fingerprint of the signing key. For a debug build:
     ```bash
     keytool -list -v -keystore ~/.android/debug.keystore \
       -alias androiddebugkey -storepass android -keypass android
     ```
5. **Important:** Google now disables custom URI schemes for new Android clients
   by default. Open the client's **Advanced Settings** and enable the custom URI
   scheme method, or the redirect back to `fanout:/oauth/youtube` will be
   rejected.
6. Copy the client ID into `app/.env`:
   ```
   EXPO_PUBLIC_GOOGLE_CLIENT_ID=123456789-abc.apps.googleusercontent.com
   ```
7. Restart the bundler with `--clear`. Metro caches the old inlined value
   otherwise and you'll keep seeing the same error.

If Google still refuses the redirect, the fallback is its reversed-client-ID
scheme (`com.googleusercontent.apps.<id>:/oauth2redirect`) instead of `fanout:`.
That's a small code change in `app/services/oauth/youtube.ts` plus a scheme entry
in `app/app.json` — ask and it can be done.

## X

1. [X developer portal](https://developer.x.com/) → your project → an app.
2. **User authentication settings** → OAuth 2.0, type **Native App** (public
   client, PKCE, no secret).
3. Callback URI: `fanout:/oauth/x`
4. App permissions: **Read and write** (needed for `tweet.write` and
   `media.write`).
5. Copy the **Client ID** → `app/.env` as `EXPO_PUBLIC_X_CLIENT_ID`.

## The four that need the function

Only worth doing once YouTube works end to end. Each needs its app registered
*and* the Worker deployed:

```bash
cd functions
npx wrangler secret put TIKTOK_CLIENT_SECRET   # and META_APP_SECRET, LINKEDIN_CLIENT_SECRET
npm run deploy
```

Then put the Worker's URL in `app/.env` as `EXPO_PUBLIC_TOKEN_EXCHANGE_URL`, and
each platform's public id as `EXPO_PUBLIC_TIKTOK_CLIENT_KEY`,
`EXPO_PUBLIC_META_APP_ID`, `EXPO_PUBLIC_LINKEDIN_CLIENT_ID`.

`app/.env.example` lists every variable with what each platform needs configured.
Two of these also need approval before they work for anyone but your own test
accounts: TikTok's app audit and Meta's App Review.
