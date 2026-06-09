# Mobile App

Expo-based mobile client for the content review workflow.

## Current Flow

1. Pick photo or video from the device
2. Call `POST /uploads/sign`
3. Upload the file to the returned presigned URL
4. Call `POST /submissions` with the returned `objectKey`
5. Refresh or review recent submission status directly in the app
6. Follow review and publish updates from the in-app notifications list

## Run

Install mobile dependencies from the repo root, then:

- `npm --workspace @club/mobile run dev`
- `npm --workspace @club/mobile run ios`
- `npm --workspace @club/mobile run android`

## Local iPhone Build

This repo is set up to build and install the app directly to a connected iPhone without going through TestFlight.

Relevant files:

- `app.config.js`
- `ios/`

Important environment variables:

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_CLUB_SLUG`
- `EXPO_PUBLIC_TEAM_SLUG`
- `EXPO_PUBLIC_SUBMITTER_EMAIL`
- `EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER`
- `EXPO_PUBLIC_IOS_BUILD_NUMBER`
- `EXPO_PUBLIC_EXPO_OWNER`

Suggested iPhone flow:

1. Connect the iPhone by USB and trust the Mac.
2. Set `EXPO_PUBLIC_API_BASE_URL` to your dev VPS HTTPS URL.
3. Keep the bundle identifier set to `com.hermes.clubcontent`.
4. Run `npm --workspace @club/mobile run ios:device`.

If you want the simulator instead, run `npm --workspace @club/mobile run ios:simulator`.

### Simulator Guardrail

The simulator can have multiple apps installed at once. That is fine, but the content app launch
flow now checks for the correct bundle before it runs. If the wrong app is targeted, the script
fails fast instead of launching the other product by mistake.

Useful commands:

- `npm --workspace @club/mobile run sim:check`
- `npm --workspace @club/mobile run sim:list`

## Distribution Notes

The old `testflight:*` scripts have been removed from this app package so the default workflow stays local.
If you later want to ship again, you can add a separate release flow back in, but this repo now favors
direct device installs for day-to-day testing.

## Important Config

The app defaults to:

- `API base URL`: `http://localhost:4000`
- `clubSlug`: `demo-workspace`
- `teamSlug`: `content-team`
- `submitterEmail`: `submitter@demo-workspace.local`

On a real phone, replace `localhost` with the dev VPS host or a LAN-reachable machine address.
