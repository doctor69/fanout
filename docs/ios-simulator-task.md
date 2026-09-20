# Task: run Fanout in the iOS Simulator

Hand this to Claude Code running **on a Mac** (`claude "follow docs/ios-simulator-task.md"`).
Xcode and the Simulator are free — no paid Apple Developer account is needed,
because a Simulator build requires no code signing.

Work on branch `claude/md-spec-files-m471h8`.

## Already verified — don't redo it

A cloud session ran `expo prebuild --platform ios` and checked the generated
`Info.plist`. These are correct, so a failure is probably *not* app config:

- `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` and
  `NSMicrophoneUsageDescription` are all present.
- `CFBundleURLSchemes` contains `fanout`, so OAuth redirects to
  `fanout:/oauth/<platform>` come back to the app.
- `NSPhotoLibraryAddUsageDescription` is absent, correctly — it's only needed to
  *save* to the photo library, and this app only reads.

## Steps

1. `npm install` at the repo root.
2. `npm test` and `npm run typecheck` — 85 tests, all should pass. If not, stop
   and report that first.
3. Xcode installed, command-line tools present (`xcode-select --install`),
   licence accepted (`sudo xcodebuild -license accept`), CocoaPods available.
4. From `app/`: `npx expo run:ios`. This prebuilds, runs `pod install`, builds,
   boots a Simulator and installs. The first `pod install` is slow — normal.
5. Confirm six rows render on the Connections screen: YouTube, TikTok,
   Instagram, Facebook, X, LinkedIn.
6. `xcrun simctl io booted screenshot /tmp/fanout-ios.png`
7. Tap a Connect button and note exactly what appears.

## Expected, not bugs

- **No credentials.** `app/.env` doesn't exist and isn't needed to build or to
  see the UI. Connect will throw a readable "Missing EXPO_PUBLIC_…" error.
  **Do not invent placeholder credentials.** `app/.env.example` documents each.
- **Nothing here has ever run on a screen.** Every adapter is tested against
  mocked HTTP only. A redbox or layout problem on first launch is ordinary new
  information. Report what you see, not what the code intends.
- `app/ios/` is generated, not committed. Native config changes go in
  `app/app.json` and then a re-prebuild — never hand-edit generated files.

## Reporting back

The cloud session that wrote this (`fanout-1a`) can't be messaged from your
machine. The branch is the only channel back.

1. Commit anything you had to change to make it build; push to
   `claude/md-spec-files-m471h8`.
2. Create and push `docs/ios-build-report.md` with: Xcode/macOS versions, the
   Simulator device and iOS version, anything you had to install, what the app
   looked like on launch (all six rows? redbox? clipping? what did Connect do?),
   any failure with **error text verbatim**, and where the screenshot is.
3. Be specific. "It worked" with no detail isn't useful, and don't report
   anything you didn't actually observe. A clear failure report is a good
   outcome.

Another session may be pushing to this branch (an Android build writing
`docs/android-build-report.md`). Different filename, as above — and
`git pull --rebase` before pushing if a push is rejected.

## Spare time

`specs/06-build-plan.md` Phase 9 is "iOS port verification" — check items off as
you confirm them, in the same commit as the work, per CLAUDE.md.
