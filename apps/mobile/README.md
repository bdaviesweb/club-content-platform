# Mobile App

Expo-based mobile client for the club content workflow.

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

## TestFlight Preparation

This app is now configured for EAS Build and EAS Submit.

Relevant files:

- `app.config.js`
- `eas.json`

Important environment variables:

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_CLUB_SLUG`
- `EXPO_PUBLIC_TEAM_SLUG`
- `EXPO_PUBLIC_SUBMITTER_EMAIL`
- `EXPO_PUBLIC_IOS_BUNDLE_IDENTIFIER`
- `EXPO_PUBLIC_IOS_BUILD_NUMBER`
- `EXPO_PUBLIC_EXPO_OWNER`

Suggested iOS flow:

1. Set `EXPO_PUBLIC_API_BASE_URL` to your dev VPS HTTPS URL.
2. Set a real bundle identifier, for example `com.hermes.clubcontent`.
3. Run `npm --workspace @club/mobile run testflight:build`.
4. Run `npm --workspace @club/mobile run testflight:submit`.

## Current App Store Connect State

The Expo project for this repo is `@clubhqpro/club-content` with EAS project ID
`83871f8c-a185-47d5-8f19-5e2749dc81d2`.

The weather project that was temporarily used during a later pivot is no longer wired into this repo.
`eas.json` no longer pins an App Store Connect app ID, so future iOS submission must be attached to a
dedicated `Club Content` App Store Connect app before release.

If you continue iOS distribution for this repo, create or confirm a separate Apple app identity for:

- app name: `Club Content`
- bundle ID: `com.hermes.clubcontent`
- Expo/EAS project: `@clubhqpro/club-content`

If you only want device-distributed beta builds before App Store Connect submission, use the `preview` profile in `eas.json`.

## Important Config

The app defaults to:

- `API base URL`: `http://localhost:4000`
- `clubSlug`: `demo-soccer-club`
- `teamSlug`: `u14-girls`
- `submitterEmail`: `coach@demo-club.local`

On a real phone, replace `localhost` with the dev VPS host or a LAN-reachable machine address.
